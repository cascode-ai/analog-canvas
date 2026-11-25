import { deviceDescriptor } from "@icm/devices";
import type { CircuitProject } from "@icm/model";
import { variantHiddenPinNames, type SymbolResolver } from "@icm/symbols";

import { resolveEndpointPoint } from "../endpoint.js";
import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import type { ErcDiagnostic } from "./erc.js";
import { buildTerminalLogicalNetMap, terminalLocator } from "./erc-shared.js";

type Document = CircuitProject["documents"][number];
type LogicalNets = ReturnType<typeof resolveDocumentLogicalNets>;

const SPICE_BUILTIN_IDENTIFIERS: ReadonlySet<string> = new Set([
  "pi",
  "e",
  "boltz",
  "echarge",
  "kelvin",
  "temp",
  "temper",
  "hertz",
  "time",
  "true",
  "false",
  "v",
  "i",
]);

function collectDefinedParameterNames(
  project: CircuitProject,
  document: Document,
): Set<string> {
  const defined = new Set<string>();
  for (const formal of document.netlist?.formalParameters ?? []) {
    defined.add(formal.name.toLowerCase());
  }
  const scanText = (text: string) => {
    // SPICE `.param a=1 b=2` / `.params ...` and VACASK `parameters a=1 b=2`.
    for (const line of text.split(/\r?\n/u)) {
      const trimmed = line.trim();
      const spice = /^\.params?\b(.*)$/iu.exec(trimmed);
      const vacask = /^parameters\b(.*)$/iu.exec(trimmed);
      const body = spice?.[1] ?? vacask?.[1];
      if (!body) continue;
      for (const match of body.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\s*=/gu)) {
        defined.add(match[1]!.toLowerCase());
      }
    }
  };
  for (const folder of project.simulationFolders ?? []) {
    for (const file of folder.input.files) {
      if (file.path === folder.input.configPath) {
        try {
          const parsed = JSON.parse(file.text) as {
            variables?: Array<{ name?: unknown }>;
          };
          for (const variable of parsed.variables ?? []) {
            if (typeof variable?.name === "string") {
              defined.add(variable.name.toLowerCase());
            }
          }
        } catch {
          // Malformed config is reported by simulation config diagnostics.
        }
        continue;
      }
      scanText(file.text);
    }
  }
  for (const source of project.modelSources ?? []) {
    for (const file of source.files) {
      scanText(file.text);
    }
  }
  return defined;
}

function unresolvedIdentifiersInExpression(
  rawValue: string,
  defined: ReadonlySet<string>,
): string[] {
  if (!rawValue.includes("{")) return [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const match of rawValue.matchAll(/\{([^}]+)\}/gu)) {
    const cleaned = match[1]!
      // Strip numeric literals with scientific notation or SPICE SI suffixes.
      .replace(
        /(?<![A-Za-z0-9_])(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+|meg|[a-z]+)?/giu,
        " ",
      )
      // Strip function names invoked with `(`.
      .replace(/\b[A-Za-z_][A-Za-z0-9_]*(?=\s*\()/gu, " ");
    for (const token of cleaned.matchAll(/\b([A-Za-z_][A-Za-z0-9_]*)\b/gu)) {
      const ident = token[1]!;
      const folded = ident.toLowerCase();
      if (
        SPICE_BUILTIN_IDENTIFIERS.has(folded) ||
        defined.has(folded) ||
        seen.has(folded)
      ) {
        continue;
      }
      seen.add(folded);
      unresolved.push(ident);
    }
  }
  return unresolved;
}

/**
 * MOSFET channel shorts (`D == S` while `B` is on a different Net, or 3-pin
 * `G == D == S`) and BJT collector-emitter shorts (`C == E`), excluding valid
 * MOSCAPs (`D == S == B`, `G` separate) and 4-pin dummy transistors
 * (`G == D == S == B`).
 */
function reportShortedTransistors(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  const netOf = (instanceId: string, pinName: string) =>
    netOfTerminal.get(`${instanceId}\u0000${pinName}`);

  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const descriptor = deviceDescriptor(instance.symbolId, project);
    if (!descriptor) continue;
    const label = instance.reference ?? instance.id;

    if (descriptor.deviceClass === "mos") {
      const netD = netOf(instance.id, "D");
      const netS = netOf(instance.id, "S");
      if (!netD || netD !== netS) continue;
      const netG = netOf(instance.id, "G");
      const netB = netOf(instance.id, "B");
      // Intentional MOSCAP (D == S == B, G distinct) and 4-pin dummy MOSFET
      // (G == D == S == B) stay quiet.
      const distinctBulkShort = netB !== undefined && netB !== netD;
      const threePinAllShorted = netB === undefined && netG === netD;
      if (!distinctBulkShort && !threePinAllShorted) continue;
      const netName = logicalNets.byId.get(netD)?.name;
      diagnostics.push({
        id: `erc:shorted-transistor:${document.id}:${instance.id}`,
        domain: "erc",
        code: "ERC_SHORTED_TRANSISTOR",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: `${label}'s drain and source are shorted on Net${netName ? ` ${netName}` : ""}${distinctBulkShort ? " while its bulk is on another Net" : " together with its gate"}`,
        primary: directObjectLocator(document.id, "instance", instance.id),
        related: [
          terminalLocator(document.id, instance.id, "D"),
          terminalLocator(document.id, instance.id, "S"),
        ],
        parameters: {
          instanceId: instance.id,
          netId: netD,
          deviceClass: "mos",
        },
      });
      continue;
    }

    if (descriptor.deviceClass === "bjt") {
      const netC = netOf(instance.id, "C");
      const netE = netOf(instance.id, "E");
      if (!netC || netC !== netE) continue;
      const netName = logicalNets.byId.get(netC)?.name;
      diagnostics.push({
        id: `erc:shorted-transistor:${document.id}:${instance.id}`,
        domain: "erc",
        code: "ERC_SHORTED_TRANSISTOR",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: `${label}'s collector and emitter are shorted on Net${netName ? ` ${netName}` : ""}`,
        primary: directObjectLocator(document.id, "instance", instance.id),
        related: [
          terminalLocator(document.id, instance.id, "C"),
          terminalLocator(document.id, instance.id, "E"),
        ],
        parameters: {
          instanceId: instance.id,
          netId: netC,
          deviceClass: "bjt",
        },
      });
    }
  }
}

/**
 * Two placed instances sitting on identical `(x, y)` coordinates with at least
 * one overlapping visible pin hide each other visually and silently short
 * coinciding pins (#2612).
 */
function reportStackedInstances(
  document: Document,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  const placed = document.instances.filter((instance) => instance.placement);
  if (placed.length < 2) return;
  // Abstract connectivity-only schematics that leave every part unpositioned at
  // (0, 0) with no routes are not stacked drawn instances.
  if (
    document.routes.length === 0 &&
    placed.every(
      (instance) =>
        instance.placement!.position.x === 0 &&
        instance.placement!.position.y === 0,
    )
  ) {
    return;
  }

  const byOrigin = new Map<
    string,
    Array<{
      instance: Document["instances"][number];
      pinPoints: Array<{ x: number; y: number }>;
    }>
  >();

  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const hidden = variantHiddenPinNames(resolved.variant);
    const pinPoints: Array<{ x: number; y: number }> = [];
    for (const pin of resolved.definition.pins) {
      if (pin.presentation.visibility === "implicit" || hidden.has(pin.name)) {
        continue;
      }
      const point = resolveEndpointPoint(document, resolver, {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      });
      if (point) pinPoints.push(point);
    }
    if (pinPoints.length === 0) continue;
    const key = `${Math.round(instance.placement.position.x)},${Math.round(instance.placement.position.y)}`;
    const bucket = byOrigin.get(key) ?? [];
    bucket.push({ instance, pinPoints });
    byOrigin.set(key, bucket);
  }

  for (const bucket of byOrigin.values()) {
    if (bucket.length < 2) continue;
    for (let i = 0; i < bucket.length; i += 1) {
      for (let j = i + 1; j < bucket.length; j += 1) {
        const first = bucket[i]!;
        const second = bucket[j]!;
        const overlapsPin = first.pinPoints.some((p1) =>
          second.pinPoints.some(
            (p2) => Math.abs(p1.x - p2.x) <= 1 && Math.abs(p1.y - p2.y) <= 1,
          ),
        );
        if (!overlapsPin) continue;
        const firstLabel = first.instance.reference ?? first.instance.id;
        const secondLabel = second.instance.reference ?? second.instance.id;
        const pos = first.instance.placement!.position;
        diagnostics.push({
          id: `erc:stacked-instance:${document.id}:${first.instance.id}:${second.instance.id}`,
          domain: "erc",
          code: "ERC_STACKED_INSTANCE",
          severity: "warning",
          confidence: "high",
          gateEligible: false,
          message: `Instances ${firstLabel} and ${secondLabel} are stacked at (${pos.x}, ${pos.y}) with overlapping pins; separate or delete the duplicate`,
          primary: directObjectLocator(
            document.id,
            "instance",
            first.instance.id,
          ),
          related: [
            directObjectLocator(document.id, "instance", second.instance.id),
          ],
          parameters: {
            instanceId: first.instance.id,
            otherInstanceId: second.instance.id,
            x: pos.x,
            y: pos.y,
          },
        });
      }
    }
  }
}

/**
 * Braced `{PARAM}` references in device parameters that are not declared by
 * the Cell's formal parameters or any `.param` / `parameters` statement in the
 * Project (#2612).
 */
function reportUnresolvedParameters(
  project: CircuitProject,
  document: Document,
  diagnostics: ErcDiagnostic[],
): void {
  const defined = collectDefinedParameterNames(project, document);
  for (const instance of document.instances) {
    if (!instance.placement || !instance.netlist?.parameters) continue;
    const label = instance.reference ?? instance.id;
    for (const [paramName, rawValue] of Object.entries(
      instance.netlist.parameters,
    )) {
      if (typeof rawValue !== "string") continue;
      const missing = unresolvedIdentifiersInExpression(rawValue, defined);
      if (missing.length === 0) continue;
      diagnostics.push({
        id: `erc:unresolved-parameter:${document.id}:${instance.id}:${paramName}`,
        domain: "erc",
        code: "ERC_UNRESOLVED_PARAMETER",
        severity: "warning",
        confidence: "high",
        gateEligible: false,
        message: `${label} parameter ${paramName}="${rawValue}" references undefined parameter${missing.length === 1 ? "" : "s"} ${missing.join(", ")}; declare a Cell formal parameter or .param`,
        primary: directObjectLocator(document.id, "instance", instance.id),
        related: [],
        parameters: {
          instanceId: instance.id,
          parameter: paramName,
          unresolved: missing.join(","),
        },
      });
    }
  }
}

/**
 * Device integrity checks (#2612): shorted MOSFET/BJT channels, stacked
 * identical-origin instances, and unresolved `{PARAM}` expressions.
 */
export function reportDeviceIntegrityChecks(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  reportShortedTransistors(project, document, logicalNets, diagnostics);
  reportStackedInstances(document, resolver, diagnostics);
  reportUnresolvedParameters(project, document, diagnostics);
}
