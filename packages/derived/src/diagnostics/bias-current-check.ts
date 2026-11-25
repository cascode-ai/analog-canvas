import { deviceDescriptor } from "@icm/devices";
import type { CircuitProject, Instance } from "@icm/model";

import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import type { ErcDiagnostic } from "./erc.js";
import {
  VOLTAGE_SOURCE_CLASSES,
  buildTerminalLogicalNetMap,
  isSubcircuitBound,
} from "./erc-shared.js";

type Document = CircuitProject["documents"][number];
type LogicalNets = ReturnType<typeof resolveDocumentLogicalNets>;

const SPICE_SCALAR =
  /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)(meg|mil|[tgkmunpfa])?[a-zΩ]*$/iu;

const SPICE_MULTIPLIER: Readonly<Record<string, number>> = {
  t: 1e12,
  g: 1e9,
  meg: 1e6,
  k: 1e3,
  mil: 25.4e-6,
  m: 1e-3,
  u: 1e-6,
  n: 1e-9,
  p: 1e-12,
  f: 1e-15,
  a: 1e-18,
};

const MIN_BIAS_CURRENT_AMPS = 1e-3; // 1 mA
const MAX_MOS_CURRENT_DENSITY_A_PER_M = 400; // 400 uA/um
const DEFAULT_MOS_WIDTH_METERS = 1e-6; // 1 um catalog default
const SHUNT_RESISTOR_OHMS = 2e3; // 2 kOhm

function parseSpiceScalar(raw: string | undefined): number | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.includes("{") || trimmed.includes("}")) return null;
  const match = SPICE_SCALAR.exec(trimmed);
  if (!match) return null;
  const base = Number(match[1]);
  if (!Number.isFinite(base)) return null;
  const suffix = match[2]?.toLowerCase();
  const scale = suffix ? (SPICE_MULTIPLIER[suffix] ?? 1) : 1;
  const value = base * scale;
  return Number.isFinite(value) ? value : null;
}

function parameterValue(instance: Instance, key: string): string | undefined {
  const params = instance.netlist?.parameters;
  if (!params) return undefined;
  const folded = key.toLowerCase();
  for (const [name, value] of Object.entries(params)) {
    if (name.toLowerCase() === folded) return value;
  }
  return undefined;
}

/**
 * Total effective channel width `w * m * nf` for a MOSFET instance, or null
 * when `w` (or multiplier) is a parameterized expression we cannot evaluate.
 */
function effectiveMosWidthMeters(instance: Instance): number | null {
  const rawW = parameterValue(instance, "w");
  const w =
    rawW !== undefined && rawW.trim().length > 0
      ? parseSpiceScalar(rawW)
      : DEFAULT_MOS_WIDTH_METERS;
  if (w === null || w <= 0) return null;

  let factor = 1;
  for (const key of ["m", "nf"] as const) {
    const raw = parameterValue(instance, key);
    if (raw === undefined || raw.trim().length === 0) continue;
    const parsed = parseSpiceScalar(raw);
    if (parsed === null || parsed <= 0) return null;
    factor *= parsed;
  }
  return w * factor;
}

function formatCurrent(amps: number): string {
  if (amps >= 1) return `${Number(amps.toPrecision(3))} A`;
  if (amps >= 1e-3) return `${Number((amps * 1e3).toPrecision(3))} mA`;
  return `${Number((amps * 1e6).toPrecision(3))} uA`;
}

function formatWidthUm(meters: number): string {
  return `${Number((meters * 1e6).toPrecision(3))} um`;
}

/**
 * Non-blocking advisory (#2614) when an explicit >= 1 mA DC current source
 * feeds a non-supply, non-voltage-clamped MOSFET drain/source node whose
 * total effective channel width would be driven above 400 uA/um (e.g., an
 * unedited legacy `1m` default feeding `1u` IC MOSFETs).
 */
export function reportBiasCurrentOverdrive(
  document: Document,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  const instanceById = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  const groupById = new Map(
    logicalNets.groups.map((group) => [group.id, group]),
  );

  // Collect all terminals per Logical Net id.
  const terminalsByLogicalNet = new Map<
    string,
    Array<{ instance: Instance; pinName: string }>
  >();
  for (const net of document.nets) {
    const logicalId = logicalNets.byBaseNetId.get(net.id)?.id ?? net.id;
    let list = terminalsByLogicalNet.get(logicalId);
    if (!list) {
      list = [];
      terminalsByLogicalNet.set(logicalId, list);
    }
    for (const terminal of net.terminals) {
      const instance = instanceById.get(terminal.instanceId);
      if (instance) {
        list.push({ instance, pinName: terminal.pinName });
      }
    }
  }

  for (const instance of document.instances) {
    if (isSubcircuitBound(instance)) continue;
    const descriptor = deviceDescriptor(instance.symbolId);
    if (descriptor?.deviceClass !== "current-source") continue;

    // Skip time-varying waveforms; focus on DC bias current sources.
    const waveform = parameterValue(instance, "waveform")?.trim().toLowerCase();
    if (waveform && waveform !== "dc") continue;

    // Require an explicit concrete `dc` value so conceptual diagrams leaving
    // `parameters: {}` remain quiet.
    const rawDc = parameterValue(instance, "dc");
    const dcAmps = parseSpiceScalar(rawDc);
    if (dcAmps === null) continue;
    const magnitude = Math.abs(dcAmps);
    if (magnitude < MIN_BIAS_CURRENT_AMPS) continue;

    const checkedNets = new Set<string>();
    for (const pinName of ["+", "-"] as const) {
      const logicalId = netOfTerminal.get(`${instance.id}\u0000${pinName}`);
      if (!logicalId || checkedNets.has(logicalId)) continue;
      checkedNets.add(logicalId);

      const group = groupById.get(logicalId);
      if (!group || group.powerDomain !== "none") continue;

      const attached = terminalsByLogicalNet.get(logicalId) ?? [];
      let shunted = false;
      let unknownMosWidth = false;
      let totalMosWidth = 0;
      const mosInstanceIds = new Set<string>();

      for (const entry of attached) {
        if (entry.instance.id === instance.id) continue;
        if (isSubcircuitBound(entry.instance)) {
          shunted = true;
          break;
        }
        const attachedClass = deviceDescriptor(
          entry.instance.symbolId,
        )?.deviceClass;
        if (!attachedClass || attachedClass === "net-marker") continue;
        if (
          VOLTAGE_SOURCE_CLASSES.has(attachedClass) ||
          attachedClass === "bjt" ||
          attachedClass === "diode" ||
          attachedClass === "jfet"
        ) {
          shunted = true;
          break;
        }
        if (attachedClass === "resistor") {
          const resistance = parseSpiceScalar(
            parameterValue(entry.instance, "value"),
          );
          if (resistance === null || resistance <= SHUNT_RESISTOR_OHMS) {
            shunted = true;
            break;
          }
          continue;
        }
        if (
          attachedClass === "mos" &&
          (entry.pinName === "D" || entry.pinName === "S")
        ) {
          if (mosInstanceIds.has(entry.instance.id)) continue;
          const width = effectiveMosWidthMeters(entry.instance);
          if (width === null) {
            unknownMosWidth = true;
            break;
          }
          mosInstanceIds.add(entry.instance.id);
          totalMosWidth += width;
        }
      }

      if (shunted || unknownMosWidth || mosInstanceIds.size === 0) continue;
      if (magnitude / totalMosWidth < MAX_MOS_CURRENT_DENSITY_A_PER_M) continue;

      const ref = instance.reference ?? instance.id;
      const netLabel = group.name ?? logicalId;
      diagnostics.push({
        id: `erc:bias-current-overdrive:${document.id}:${instance.id}:${logicalId}`,
        domain: "erc",
        code: "ERC_BIAS_CURRENT_OVERDRIVE",
        severity: "warning",
        confidence: "medium",
        gateEligible: false,
        message: `Current source ${ref} drives ${formatCurrent(magnitude)} into Net ${netLabel}, where connected MOSFET channel width totals ${formatWidthUm(totalMosWidth)} (${Math.round(magnitude / totalMosWidth)} uA/um): reduce dc (e.g. 10u-100u) or widen the MOSFETs so they stay in saturation`,
        primary: directObjectLocator(document.id, "instance", instance.id),
        related: [
          directObjectLocator(document.id, "net", logicalId),
          ...[...mosInstanceIds]
            .sort((a, b) => a.localeCompare(b, "en"))
            .map((id) => directObjectLocator(document.id, "instance", id)),
        ],
        parameters: {
          instanceId: instance.id,
          netId: logicalId,
          currentAmps: magnitude,
          totalMosWidthMeters: totalMosWidth,
        },
      });
      // Report at most once per current source even if both pins feed narrow MOS nodes.
      break;
    }
  }
}
