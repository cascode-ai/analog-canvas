import { deviceDescriptor, subcircuitDescriptor } from "@icm/devices";
import {
  flattenRichText,
  scalarCellTerminals,
  scalarConnectivityEvidence,
  type CircuitProject,
  type Point,
  type Rect,
} from "@icm/model";
import { variantHiddenPinNames, type SymbolResolver } from "@icm/symbols";

import type { ProjectConnectivityIndex } from "../connectivity-index.js";
import {
  drawnFreeTexts,
  resolveDraftingObjectGeometry,
  resolveDraftingTextInkBounds,
} from "../drafting-geometry.js";
import { resolveEndpointPoint } from "../endpoint.js";
import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import { resolveDocumentRoutingGeometry } from "../resolved-route-geometry.js";
import type { ErcDiagnostic } from "./erc.js";
import {
  VOLTAGE_SOURCE_CLASSES,
  buildTerminalLogicalNetMap,
  isSubcircuitBound,
} from "./erc-shared.js";

type Document = CircuitProject["documents"][number];
type LogicalNets = ReturnType<typeof resolveDocumentLogicalNets>;

/**
 * Signal-like identifiers frequently authored as free drafting text instead of
 * a real Net Label or formal Port (#2613), e.g. `Vout1`, `Vout+`, `Vin-`,
 * `Ibias`, `Vref`, `Vcm`, `Clk`, `Phi1`.
 */
const SIGNAL_DRAFTING_TEXT =
  /^(?:V(?:out|in|ref|cm|bias|dd|ss|cc|ee)|I(?:bias|out|in|ref)|Clk|Phi)[A-Za-z0-9_+-]{0,12}$/iu;

/**
 * Custom supply rail names (distinct from bare global `VDD`/`VSS`/`GND`) that
 * commonly float when authored only as local Net Labels without a formal Port
 * or supply source (#2613), e.g. `PVDD`, `PVSS`, `AVDD`, `DVDD`, `VDDIO`,
 * `SAP`, `SAN`, `VBAT`.
 */
const CUSTOM_SUPPLY_NAME =
  /^(?:[PADI]V(?:DD|SS|CC|EE)[A-Z0-9_]*|V(?:DD|SS|CC|EE)[A-Z0-9_]+|SA[PN]|VBAT[A-Z0-9_]*)$/iu;

/**
 * Unambiguous external input, output, or clock Net Label names (#2557) —
 * distinct from internal nodes (`n1`, `tail`, `mid`, `vb1`) and supply rails.
 */
const IO_OR_CLOCK_NET_NAME =
  /^(?:(?:[VI]_?(?:in|out)|in(?:put)?|out(?:put)?|vo)(?:[0-9]+[pnb+-]?|[pnb+-]|_(?:[0-9]+[pnb+-]?|p|n|b|bar|in|out|pos|neg|plus|minus|cm|diff|[+-]))?|(?:clk|clock)(?:[0-9]+[pnb+-]?|[pnb+-]|_(?:[0-9]+[pnb+-]?|p|n|b|bar|in|out|pos|neg|plus|minus|cm|diff|[+-]))?|(?:phi|[Φφ])(?:[0-9]+[pnb+-]?|[pnb+-]|_(?:[0-9]+[pnb+-]?|p|n|b|bar|in|out|pos|neg|plus|minus|[+-]))?)$/iu;

const BEHAVIORAL_OUTPUT_CLASSES: ReadonlySet<string> = new Set([
  "opamp",
  "comparator",
  "logic-gate",
]);

function pointToRectDistance(point: Point, rect: Rect): number {
  const dx = Math.max(rect.x - point.x, 0, point.x - (rect.x + rect.width));
  const dy = Math.max(rect.y - point.y, 0, point.y - (rect.y + rect.height));
  return Math.hypot(dx, dy);
}

interface ElectricalAnchor {
  readonly point: Point;
  /** Logical Net ID, or a unique unconnected token per pin. */
  readonly netKey: string;
  readonly unnamed: boolean;
}

function collectElectricalAnchors(
  document: Document,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
): ElectricalAnchor[] {
  const anchors: ElectricalAnchor[] = [];
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const hidden = variantHiddenPinNames(resolved.variant);
    for (const pin of resolved.definition.pins) {
      if (pin.presentation.visibility === "implicit" || hidden.has(pin.name)) {
        continue;
      }
      const point = resolveEndpointPoint(document, resolver, {
        kind: "terminal",
        instanceId: instance.id,
        pinName: pin.name,
      });
      if (!point) continue;
      const logicalId = netOfTerminal.get(`${instance.id}\u0000${pin.name}`);
      const group = logicalId ? logicalNets.byId.get(logicalId) : undefined;
      anchors.push({
        point,
        netKey: logicalId ?? `unconnected:${instance.id}:${pin.name}`,
        unnamed: !group?.name,
      });
    }
  }
  for (const junction of document.junctions) {
    const group = logicalNets.byBaseNetId.get(junction.netId);
    anchors.push({
      point: junction.position,
      netKey: group?.id ?? junction.netId,
      unnamed: !group?.name,
    });
  }
  return anchors;
}

/**
 * Flag non-electrical drafting lines that start and end directly on distinct
 * electrical endpoints, and free drafting text with a signal-like identifier
 * sitting beside an unnamed electrical stub (#2613).
 */
function reportDraftingImitations(
  document: Document,
  docIndex: ReturnType<ProjectConnectivityIndex["documents"]["get"]>,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  const objects = document.drafting?.objects ?? [];
  if (objects.length === 0) return;

  const routingGeometry =
    docIndex?.routingGeometry ??
    resolveDocumentRoutingGeometry(document, resolver);
  const anchors = collectElectricalAnchors(document, logicalNets, resolver);
  if (anchors.length === 0) return;

  for (const object of objects) {
    if (object.kind !== "construction-line") continue;
    const geometry = resolveDraftingObjectGeometry(
      document,
      resolver,
      object,
      routingGeometry,
    );
    if (geometry.kind !== "construction-line" || geometry.points.length < 2) {
      continue;
    }
    const start = geometry.points[0]!;
    const end = geometry.points[geometry.points.length - 1]!;
    if (Math.hypot(end.x - start.x, end.y - start.y) < 5) continue;
    const startHits = anchors.filter(
      (anchor) =>
        Math.hypot(anchor.point.x - start.x, anchor.point.y - start.y) <= 2,
    );
    if (startHits.length === 0) continue;
    const endHits = anchors.filter(
      (anchor) =>
        Math.hypot(anchor.point.x - end.x, anchor.point.y - end.y) <= 2,
    );
    if (endHits.length === 0) continue;
    const bridgesDistinctNets = startHits.some((a) =>
      endHits.some((b) => a.netKey !== b.netKey),
    );
    if (!bridgesDistinctNets) continue;
    diagnostics.push({
      id: `erc:drafting-wire-imitation:${document.id}:${object.id}`,
      domain: "erc",
      code: "ERC_DRAFTING_WIRE_IMITATION",
      severity: "warning",
      confidence: "medium",
      gateEligible: false,
      message: `Drafting line ${object.id} starts and ends on electrical endpoints without connecting them; draw a wire if an electrical connection is intended`,
      primary: directObjectLocator(document.id, "document", document.id),
      related: [],
      parameters: { draftingObjectId: object.id },
    });
  }

  const unnamedAnchors = anchors.filter((anchor) => anchor.unnamed);
  if (unnamedAnchors.length === 0) return;
  for (const textObject of drawnFreeTexts(document)) {
    const plain = flattenRichText(textObject.content).trim();
    if (!SIGNAL_DRAFTING_TEXT.test(plain)) continue;
    const ink = resolveDraftingTextInkBounds(
      document,
      resolver,
      textObject,
      routingGeometry,
    );
    const nearUnnamed = unnamedAnchors.some(
      (anchor) => pointToRectDistance(anchor.point, ink) <= 15,
    );
    if (!nearUnnamed) continue;
    diagnostics.push({
      id: `erc:drafting-port-label:${document.id}:${textObject.id}`,
      domain: "erc",
      code: "ERC_DRAFTING_PORT_LABEL",
      severity: "warning",
      confidence: "medium",
      gateEligible: false,
      message: `Free drafting text "${plain}" sits near an unnamed electrical node without naming it; use a Net Label or formal Port so it appears in the netlist`,
      primary: directObjectLocator(document.id, "document", document.id),
      related: [],
      parameters: { draftingObjectId: textObject.id, text: plain },
    });
  }
}

/**
 * Flag custom supply-named nets (`PVDD`, `PVSS`, `AVDD`, `DVDD`, `SAP`, `SAN`,
 * etc.) feeding two or more MOSFET sources/bulks when no formal Port, supply
 * marker, subcircuit, or voltage source drives the rail (#2613).
 */
function reportFloatingCustomSupplies(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  const formalNetIds = new Set<string>();
  for (const terminal of document.netlist?.terminals ?? []) {
    const logicalId =
      logicalNets.byBaseNetId.get(terminal.netId)?.id ?? terminal.netId;
    formalNetIds.add(logicalId);
  }
  const instanceById = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const netById = new Map(document.nets.map((net) => [net.id, net]));

  for (const group of logicalNets.groups) {
    const name = group.name?.trim();
    if (!name || !CUSTOM_SUPPLY_NAME.test(name)) continue;
    if (group.powerDomain !== "none") continue;
    if (formalNetIds.has(group.id)) continue;

    let mosSourceOrBulkCount = 0;
    let hasDriver = false;
    for (const baseNetId of group.baseNetIds) {
      const baseNet = netById.get(baseNetId);
      if (!baseNet) continue;
      for (const terminal of baseNet.terminals) {
        const instance = instanceById.get(terminal.instanceId);
        if (!instance?.placement) continue;
        if (
          instance.symbolId === "port" ||
          instance.symbolId === "port-filled"
        ) {
          hasDriver = true;
          break;
        }
        if (isSubcircuitBound(instance)) {
          hasDriver = true;
          break;
        }
        const descriptor = deviceDescriptor(instance.symbolId, project);
        if (!descriptor) {
          if (subcircuitDescriptor(instance.symbolId)) {
            hasDriver = true;
            break;
          }
          continue;
        }
        if (
          VOLTAGE_SOURCE_CLASSES.has(descriptor.deviceClass) ||
          BEHAVIORAL_OUTPUT_CLASSES.has(descriptor.deviceClass)
        ) {
          hasDriver = true;
          break;
        }
        if (
          descriptor.deviceClass === "mos" &&
          (terminal.pinName === "S" || terminal.pinName === "B")
        ) {
          mosSourceOrBulkCount += 1;
        }
      }
      if (hasDriver) break;
    }

    if (hasDriver || mosSourceOrBulkCount < 2) continue;
    diagnostics.push({
      id: `erc:floating-custom-supply:${document.id}:${group.id}`,
      domain: "erc",
      code: "ERC_FLOATING_CUSTOM_SUPPLY",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Custom supply Net ${name} feeds ${mosSourceOrBulkCount} MOS source/bulk pins without a formal Port, supply marker, or voltage source driving it`,
      primary: directObjectLocator(document.id, "net", group.id),
      related: [],
      parameters: {
        netId: group.id,
        netName: name,
        mosSourceOrBulkCount,
      },
    });
  }
}

/**
 * Flag connected output, input, or clock Nets named only by a local Net Label
 * with no formal Port, so the Cell cannot be driven or read (#2557).
 *
 * Self-driven portless testbenches (containing an independent voltage source
 * and no formal Ports), nets driven directly by an independent source, global
 * or supply nets, and singleton nets (already reported as floating endpoints)
 * stay quiet.
 */
function reportIoNetLabelsWithoutPort(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  const placedInstances = document.instances.filter(
    (instance) => instance.placement !== null,
  );
  if (placedInstances.length === 0) return;

  const instanceById = new Map(
    placedInstances.map((instance) => [instance.id, instance]),
  );
  const netById = new Map(document.nets.map((net) => [net.id, net]));

  let hasIndependentVoltageSource = false;
  const portNetIds = new Set<string>();
  for (const instance of placedInstances) {
    if (instance.symbolId === "port" || instance.symbolId === "port-filled") {
      continue;
    }
    const descriptor = deviceDescriptor(instance.symbolId, project);
    if (descriptor?.deviceClass === "voltage-source") {
      hasIndependentVoltageSource = true;
    }
  }

  for (const terminal of scalarCellTerminals(document.netlist)) {
    const logicalId =
      logicalNets.byBaseNetId.get(terminal.netId)?.id ?? terminal.netId;
    portNetIds.add(logicalId);
  }
  for (const group of logicalNets.groups) {
    if (group.formalTerminalIds.length > 0) {
      portNetIds.add(group.id);
      continue;
    }
    for (const baseNetId of group.baseNetIds) {
      const baseNet = netById.get(baseNetId);
      if (!baseNet) continue;
      if (
        baseNet.terminals.some((terminal) => {
          const instance = instanceById.get(terminal.instanceId);
          return (
            instance?.symbolId === "port" ||
            instance?.symbolId === "port-filled"
          );
        })
      ) {
        portNetIds.add(group.id);
        break;
      }
    }
  }

  // A portless Cell with an independent voltage source is a self-driven
  // testbench whose signals are probed with Net Labels rather than Cell Ports.
  if (hasIndependentVoltageSource && portNetIds.size === 0) return;

  const netLabelLogicalIds = new Set<string>();
  for (const evidence of scalarConnectivityEvidence(document)) {
    if (evidence.kind === "name-claim" && evidence.owner.kind === "net-label") {
      const logicalId =
        logicalNets.byBaseNetId.get(evidence.netId)?.id ?? evidence.netId;
      netLabelLogicalIds.add(logicalId);
    }
  }
  if (netLabelLogicalIds.size === 0) return;

  for (const group of logicalNets.groups) {
    if (!netLabelLogicalIds.has(group.id)) continue;
    if (portNetIds.has(group.id)) continue;
    if (group.powerDomain !== "none" || group.scope === "global") continue;

    const name = group.name?.trim();
    if (!name || !IO_OR_CLOCK_NET_NAME.test(name)) continue;

    const connectedTerminals = new Set<string>();
    let hasIndependentSource = false;
    for (const baseNetId of group.baseNetIds) {
      const baseNet = netById.get(baseNetId);
      if (!baseNet) continue;
      for (const terminal of baseNet.terminals) {
        const instance = instanceById.get(terminal.instanceId);
        if (!instance) continue;
        connectedTerminals.add(
          `${terminal.instanceId}\u0000${terminal.pinName}`,
        );
        const descriptor = deviceDescriptor(instance.symbolId, project);
        if (
          descriptor?.deviceClass === "voltage-source" ||
          descriptor?.deviceClass === "current-source"
        ) {
          hasIndependentSource = true;
        }
      }
    }

    // Single-pin nets already report as floating endpoints (ERC_FLOATING_GATE /
    // ERC_UNCONNECTED_PIN), and nets driven directly by an independent source
    // are already driven internally.
    if (connectedTerminals.size < 2 || hasIndependentSource) continue;

    diagnostics.push({
      id: `erc:io-label-without-port:${document.id}:${group.id}`,
      domain: "erc",
      code: "ERC_IO_LABEL_WITHOUT_PORT",
      severity: "warning",
      confidence: "medium",
      gateEligible: false,
      message: `Net ${name} uses a Net Label without a formal Port, so this Cell cannot be driven or read on ${name}; place a Port if ${name} is an external signal`,
      primary: directObjectLocator(document.id, "net", group.id),
      related: [],
      parameters: {
        netId: group.id,
        netName: name,
      },
    });
  }
}

export function reportDraftingAndSupplyChecks(
  project: CircuitProject,
  document: Document,
  docIndex: ReturnType<ProjectConnectivityIndex["documents"]["get"]>,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  reportDraftingImitations(
    document,
    docIndex,
    logicalNets,
    resolver,
    diagnostics,
  );
  reportFloatingCustomSupplies(project, document, logicalNets, diagnostics);
  reportIoNetLabelsWithoutPort(project, document, logicalNets, diagnostics);
}
