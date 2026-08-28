import { resolveDocumentLogicalNets } from "@icm/derived";
import type { Instance, SchematicDocument } from "@icm/model";

import type {
  DigitalSimulationProfile,
  LogicValue,
  SimulationDiagnostic,
} from "./contract.js";

export type DigitalGateKind =
  "buffer" | "inverter" | "and" | "or" | "nand" | "nor" | "xor" | "xnor";

export interface DigitalGate {
  readonly kind: DigitalGateKind;
  readonly instanceId: string;
  readonly inputNetIds: readonly string[];
  readonly outputNetId: string;
}

export interface DigitalDff {
  readonly instanceId: string;
  readonly dNetId: string;
  readonly clockNetId: string;
  readonly qNetId: string;
  readonly qBarNetId?: string;
  readonly initialQ: LogicValue;
}

export interface DigitalPulseSource {
  readonly instanceId: string;
  readonly outputNetId: string;
  readonly referenceNetId: string;
  readonly initialValue: "0" | "1";
  readonly delayPs: number;
  readonly periodPs: number;
  readonly highTimePs: number;
}

export interface ExtractedDigitalCircuit {
  readonly logicalNets: readonly {
    readonly id: string;
    readonly baseNetIds: readonly string[];
    readonly name: string;
  }[];
  readonly logicalNetIdByBaseNetId: ReadonlyMap<string, string>;
  readonly gates: readonly DigitalGate[];
  readonly dffs: readonly DigitalDff[];
  readonly pulseSources: readonly DigitalPulseSource[];
  readonly diagnostics: readonly SimulationDiagnostic[];
}

const GATE_BY_SYMBOL_ID: Readonly<
  Record<
    string,
    { kind: DigitalGateKind; inputs: readonly string[]; output: string }
  >
> = {
  buffer: { kind: "buffer", inputs: ["A"], output: "Y" },
  inverter: { kind: "inverter", inputs: ["A"], output: "Y" },
  "and-gate": { kind: "and", inputs: ["A", "B"], output: "Y" },
  "or-gate": { kind: "or", inputs: ["A", "B"], output: "Y" },
  "nand-gate": { kind: "nand", inputs: ["A", "B"], output: "Y" },
  "nor-gate": { kind: "nor", inputs: ["A", "B"], output: "Y" },
  "xor-gate": { kind: "xor", inputs: ["A", "B"], output: "Y" },
  "xnor-gate": { kind: "xnor", inputs: ["A", "B"], output: "Y" },
};

const IGNORED_SYMBOL_IDS = new Set([
  "ground",
  "vdd-port",
  "port",
  "port-filled",
]);

function parseTimePs(
  raw: string | undefined,
  fallback: number,
  allowZero = false,
): number | null {
  if (raw === undefined || raw.trim() === "") return fallback;
  const match = /^([+]?(?:\d+(?:\.\d*)?|\.\d+))\s*(fs|ps|ns|us|ms|s)$/iu.exec(
    raw.trim(),
  );
  if (!match) return null;
  const scale: Readonly<Record<string, number>> = {
    fs: 0.001,
    ps: 1,
    ns: 1_000,
    us: 1_000_000,
    ms: 1_000_000_000,
    s: 1_000_000_000_000,
  };
  const value = Number(match[1]) * scale[match[2]!.toLowerCase()]!;
  if (
    !Number.isSafeInteger(Math.round(value)) ||
    value < 0 ||
    (!allowZero && value === 0)
  ) {
    return null;
  }
  return Math.round(value);
}

function pinNet(
  instance: Instance,
  pinName: string,
  netIdByTerminal: ReadonlyMap<string, string>,
  diagnostics: SimulationDiagnostic[],
): string | null {
  const netId = netIdByTerminal.get(`${instance.id}\u0000${pinName}`);
  if (netId) return netId;
  diagnostics.push({
    code: "SIM_MISSING_PIN",
    severity: "error",
    message: `${instance.symbolId} ${instance.id} requires connected pin ${pinName}`,
    objectIds: [instance.id],
  });
  return null;
}

function extractGate(
  instance: Instance,
  netIdByTerminal: ReadonlyMap<string, string>,
  diagnostics: SimulationDiagnostic[],
): DigitalGate | null {
  const behavior = GATE_BY_SYMBOL_ID[instance.symbolId];
  if (!behavior) return null;
  const inputNetIds = behavior.inputs.map((pin) =>
    pinNet(instance, pin, netIdByTerminal, diagnostics),
  );
  const outputNetId = pinNet(
    instance,
    behavior.output,
    netIdByTerminal,
    diagnostics,
  );
  if (!outputNetId || inputNetIds.some((netId) => netId === null)) return null;
  return {
    kind: behavior.kind,
    instanceId: instance.id,
    inputNetIds: inputNetIds as string[],
    outputNetId,
  };
}

function extractDff(
  instance: Instance,
  profile: DigitalSimulationProfile,
  netIdByTerminal: ReadonlyMap<string, string>,
  diagnostics: SimulationDiagnostic[],
): DigitalDff | null {
  if (instance.symbolId !== "d-flip-flop") return null;
  const dNetId = pinNet(instance, "D", netIdByTerminal, diagnostics);
  const clockNetId = pinNet(instance, "CK", netIdByTerminal, diagnostics);
  const qNetId = pinNet(instance, "Q", netIdByTerminal, diagnostics);
  const qBarNetId = netIdByTerminal.get(`${instance.id}\u0000QBAR`);
  if (!dNetId || !clockNetId || !qNetId) return null;
  const authoredInitial = instance.netlist?.parameters.initialQ?.trim();
  const profileInitial = profile.initialStateByInstanceId?.[instance.id];
  const initialQ =
    profileInitial ??
    (authoredInitial === "0" || authoredInitial === "1"
      ? authoredInitial
      : "X");
  return {
    instanceId: instance.id,
    dNetId,
    clockNetId,
    qNetId,
    ...(qBarNetId ? { qBarNetId } : {}),
    initialQ,
  };
}

function extractPulse(
  instance: Instance,
  netIdByTerminal: ReadonlyMap<string, string>,
  groundNetIds: ReadonlySet<string>,
  diagnostics: SimulationDiagnostic[],
): DigitalPulseSource | null {
  if (instance.symbolId !== "pulse-voltage-source") return null;
  const outputNetId = pinNet(instance, "+", netIdByTerminal, diagnostics);
  const referenceNetId = pinNet(instance, "-", netIdByTerminal, diagnostics);
  if (!outputNetId || !referenceNetId) return null;
  if (outputNetId === referenceNetId) {
    diagnostics.push({
      code: "SIM_SHORTED_SOURCE",
      severity: "error",
      message: `Pulse source ${instance.id} has both terminals on the same logical Net`,
      objectIds: [instance.id, outputNetId],
    });
    return null;
  }
  if (!groundNetIds.has(referenceNetId)) {
    diagnostics.push({
      code: "SIM_REFERENCE_NOT_GROUND",
      severity: "error",
      message: `Pulse source ${instance.id} negative terminal must connect to Ground`,
      objectIds: [instance.id, referenceNetId],
    });
    return null;
  }
  const parameters = instance.netlist?.parameters ?? {};
  const periodPs = parseTimePs(parameters.period, 10_000);
  const delayPs = parseTimePs(parameters.delay, 1_000, true);
  const widthPs = parseTimePs(parameters.width, -1);
  const dutyCycle = Number(parameters.dutyCycle ?? "50");
  const initialValue = parameters.initial === "1" ? "1" : "0";
  const highTimePs =
    widthPs === null
      ? null
      : widthPs > 0
        ? widthPs
        : Math.max(1, Math.round(((periodPs ?? 0) * dutyCycle) / 100));
  if (
    periodPs === null ||
    delayPs === null ||
    highTimePs === null ||
    highTimePs >= periodPs ||
    ((widthPs ?? -1) <= 0 &&
      (!Number.isFinite(dutyCycle) || dutyCycle <= 0 || dutyCycle >= 100))
  ) {
    diagnostics.push({
      code: "SIM_INVALID_PARAMETER",
      severity: "error",
      message: `Pulse source ${instance.id} requires a positive period, nonnegative delay, and width shorter than period`,
      objectIds: [instance.id],
    });
    return null;
  }
  return {
    instanceId: instance.id,
    outputNetId,
    referenceNetId,
    initialValue,
    delayPs,
    periodPs,
    highTimePs,
  };
}

export function extractDigitalCircuit(
  document: SchematicDocument,
  profile: DigitalSimulationProfile,
): ExtractedDigitalCircuit {
  const diagnostics: SimulationDiagnostic[] = [];
  const logical = resolveDocumentLogicalNets(document);
  const netIdByTerminal = new Map<string, string>();
  for (const net of document.nets) {
    const logicalNetId = logical.byBaseNetId.get(net.id)?.id ?? net.id;
    for (const terminal of net.terminals) {
      netIdByTerminal.set(
        `${terminal.instanceId}\u0000${terminal.pinName}`,
        logicalNetId,
      );
    }
  }
  for (const group of logical.groups) {
    if (group.conflicts.length === 0) continue;
    diagnostics.push({
      code: "SIM_LOGICAL_NET_CONFLICT",
      severity: "error",
      message: `Logical Net ${group.id} has unresolved ${group.conflicts.join(", ")}`,
      objectIds: [...group.baseNetIds],
    });
  }
  const groundNetIds = new Set(
    logical.groups
      .filter((group) => group.powerDomain === "ground")
      .map((group) => group.id),
  );
  for (const instance of document.instances) {
    if (instance.symbolId !== "ground") continue;
    const groundNetId = netIdByTerminal.get(`${instance.id}\u00000`);
    if (groundNetId) groundNetIds.add(groundNetId);
  }

  const gates: DigitalGate[] = [];
  const dffs: DigitalDff[] = [];
  const pulseSources: DigitalPulseSource[] = [];
  for (const instance of document.instances) {
    const gate = extractGate(instance, netIdByTerminal, diagnostics);
    if (gate) {
      gates.push(gate);
      continue;
    }
    const dff = extractDff(instance, profile, netIdByTerminal, diagnostics);
    if (dff) {
      dffs.push(dff);
      continue;
    }
    const pulse = extractPulse(
      instance,
      netIdByTerminal,
      groundNetIds,
      diagnostics,
    );
    if (pulse) {
      pulseSources.push(pulse);
      continue;
    }
    if (
      !GATE_BY_SYMBOL_ID[instance.symbolId] &&
      instance.symbolId !== "d-flip-flop" &&
      instance.symbolId !== "pulse-voltage-source" &&
      !IGNORED_SYMBOL_IDS.has(instance.symbolId)
    ) {
      diagnostics.push({
        code: "SIM_UNSUPPORTED_COMPONENT",
        severity: "warning",
        message: `Digital simulation does not model symbol ${instance.symbolId}`,
        objectIds: [instance.id],
      });
    }
  }
  return {
    logicalNets: logical.groups.map((group) => ({
      id: group.id,
      baseNetIds: group.baseNetIds,
      name: group.name ?? group.id,
    })),
    logicalNetIdByBaseNetId: new Map(
      [...logical.byBaseNetId].map(([baseNetId, group]) => [
        baseNetId,
        group.id,
      ]),
    ),
    gates,
    dffs,
    pulseSources,
    diagnostics,
  };
}
