import {
  deviceDescriptor,
  gateCellBinding,
  subcircuitDescriptor,
} from "@icm/devices";
import { projectCellInterface } from "@icm/model";
import type {
  CircuitProject,
  RouteEndpoint,
  SchematicDocument,
} from "@icm/model";
import { variantHiddenPinNames, type SymbolResolver } from "@icm/symbols";

import type { ProjectConnectivityIndex } from "../connectivity-index.js";
import { terminalPinKey } from "../document-read-helpers.js";
import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import type { ErcDiagnostic } from "./erc.js";
import {
  VOLTAGE_SOURCE_CLASSES,
  buildTerminalLogicalNetMap,
  isSubcircuitBound,
  terminalLocator,
} from "./erc-shared.js";

type Document = CircuitProject["documents"][number];
type DocIndex = ReturnType<ProjectConnectivityIndex["documents"]["get"]>;
type LogicalNets = ReturnType<typeof resolveDocumentLogicalNets>;

/**
 * Pin roles that sense a voltage without setting it: a MOS gate or body, and
 * the inputs of a behavioural or logic block.
 */
const CONTROL_INPUT_ROLES = new Set([
  "gate",
  "bulk",
  "input",
  "non-inverting-input",
  "inverting-input",
  "clock",
  "reset",
]);

/**
 * A Net of two or more pins that only sense a voltage, MOS gates, bulks or
 * block inputs, with nothing to set it: no Cell Pin, no global or supply
 * name, and no other part's pin, so its operating point is undefined. A bias
 * line drawn to several gates that its bias generator never reaches is the
 * usual case (#1473). Any other pin, a capacitor's included, counts as a
 * driver; a lone gate is ERC_FLOATING_GATE's.
 */
export function reportUndrivenGateNets(
  document: Document,
  docIndex: DocIndex,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  if (!docIndex) return;
  type Terminal = Extract<RouteEndpoint, { kind: "terminal" }>;
  const instances = new Map(
    document.instances.map((instance) => [instance.id, instance]),
  );
  const sensesOnly = (endpoint: RouteEndpoint): endpoint is Terminal => {
    if (endpoint.kind !== "terminal") return false;
    const instance = instances.get(endpoint.instanceId);
    const role = instance
      ? resolver
          .resolve(instance.symbolId, instance.symbolVariantId)
          ?.definition.pins.find((pin) => pin.name === endpoint.pinName)
          ?.role.toLowerCase()
      : undefined;
    return role !== undefined && CONTROL_INPUT_ROLES.has(role);
  };
  for (const record of docIndex.logicalNets.values()) {
    const endpoints = record.logicalEndpoints;
    if (endpoints.length < 2 || !endpoints.every(sensesOnly)) continue;
    const net = logicalNets.byId.get(record.netId);
    if (
      !net ||
      net.scope !== "local" ||
      net.powerDomain !== "none" ||
      net.formalTerminalIds.length > 0
    )
      continue;
    const pins = endpoints
      .map((endpoint) => ({
        endpoint,
        text: `${instances.get(endpoint.instanceId)?.reference ?? endpoint.instanceId}.${endpoint.pinName}`,
      }))
      .sort((left, right) =>
        left.text.localeCompare(right.text, "en", { numeric: true }),
      );
    const listed =
      pins
        .slice(0, 5)
        .map((pin) => pin.text)
        .join(", ") + (pins.length > 5 ? ", …" : "");
    const [first, ...rest] = pins.map(({ endpoint }) =>
      terminalLocator(document.id, endpoint.instanceId, endpoint.pinName),
    );
    diagnostics.push({
      id: `erc:undriven-gate-net:${document.id}:${record.netId}`,
      domain: "erc",
      code: "ERC_UNDRIVEN_GATE_NET",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Nothing drives Net ${net.name ?? record.netId}: it reaches only MOS gates, bulks or block inputs (${listed}), and no source, Cell Pin, global name or other part sets its voltage`,
      primary: first!,
      related: [...rest, directObjectLocator(document.id, "net", record.netId)],
      parameters: { netId: record.netId, count: pins.length },
    });
  }
}

/**
 * A Cell Pin whose Net reaches no part of the Cell but its own Port: a wire
 * that ends on the Port's artwork without joining its pin, or a Port placed
 * and never wired, leaves the Pin connected to nothing, so whatever a parent
 * wires to it goes nowhere (#2557). A Pin on a supply or global Net, and a
 * bus Pin, are left alone; two Pins joined to each other count as connected.
 */
export function reportUnconnectedCellPins(
  document: Document,
  docIndex: DocIndex,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  if (!docIndex) return;
  for (const terminal of document.netlist?.terminals ?? []) {
    if (terminal.signal && terminal.signal.members.length > 1) continue;
    const net = logicalNets.byBaseNetId.get(terminal.netId);
    if (net && (net.scope === "global" || net.powerDomain !== "none")) continue;
    const own = new Set(terminal.interfaceInstanceIds);
    const record = docIndex.logicalNetByBaseNetId.get(terminal.netId);
    const reached = (record?.logicalEndpoints ?? []).some(
      (endpoint) =>
        endpoint.kind === "terminal" && !own.has(endpoint.instanceId),
    );
    if (reached) continue;
    const portId = terminal.interfaceInstanceIds[0];
    diagnostics.push({
      id: `erc:unconnected-cell-pin:${document.id}:${terminal.id}`,
      domain: "erc",
      code: "ERC_UNCONNECTED_CELL_PIN",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Cell Pin ${terminal.name} is connected to nothing in this Cell: its Net reaches no part but its own Port, so whatever a parent wires to it goes nowhere. Wire the Port's pin, or remove the Pin`,
      primary: portId
        ? directObjectLocator(document.id, "instance", portId)
        : terminal.interfaceAnnotationId
          ? directObjectLocator(
              document.id,
              "annotation",
              terminal.interfaceAnnotationId,
            )
          : directObjectLocator(document.id, "net", terminal.netId),
      related: [directObjectLocator(document.id, "net", terminal.netId)],
      parameters: {
        terminalId: terminal.id,
        name: terminal.name,
        netId: terminal.netId,
      },
    });
  }
}

/**
 * Two voltage-forcing outputs that set the same voltage: two ideal voltage
 * sources across one pair of Nets, or ideal sources and behavioural block
 * outputs (op-amp, inverter, gate, comparator) on one Net against ground
 * (#2557). Each forces its voltage with no resistance, so the netlist has no
 * consistent solution, or one the simulator reports as a voltage loop. A
 * behavioural output counts as forced from ground; a transconductor's output
 * is a current and does not count, nor does a block bound to a Cell.
 */
export function reportConflictingVoltageOutputs(
  project: CircuitProject,
  document: Document,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  const GROUND = "\u0000ground";
  const side = (netId: string): string =>
    logicalNets.byId.get(netId)?.powerDomain === "ground" ? GROUND : netId;
  type Output = { instanceId: string; pinName: string; text: string };
  const byPair = new Map<
    string,
    { sides: [string, string]; outputs: Output[] }
  >();
  const add = (a: string, b: string, output: Output) => {
    if (a === b) return;
    const sides = [a, b].sort() as [string, string];
    const key = sides.join("\u0000");
    const entry = byPair.get(key) ?? { sides, outputs: [] };
    entry.outputs.push(output);
    byPair.set(key, entry);
  };
  for (const instance of document.instances) {
    if (isSubcircuitBound(instance)) continue;
    const label = instance.reference ?? instance.id;
    const netOf = (pinName: string) =>
      netOfTerminal.get(terminalPinKey(instance.id, pinName));
    const device = deviceDescriptor(instance.symbolId, project);
    if (device && VOLTAGE_SOURCE_CLASSES.has(device.deviceClass)) {
      const [plus, minus] = device.pinOrder;
      const a = plus ? netOf(plus) : undefined;
      const b = minus ? netOf(minus) : undefined;
      if (a && b)
        add(side(a), side(b), {
          instanceId: instance.id,
          pinName: plus!,
          text: label,
        });
      continue;
    }
    const block = subcircuitDescriptor(instance.symbolId, project);
    if (!block || block.target.includes("transconductance")) continue;
    for (const port of block.ports) {
      if (port.direction !== "output" || !("pinName" in port)) continue;
      const netId = netOf(port.pinName);
      if (netId)
        add(side(netId), GROUND, {
          instanceId: instance.id,
          pinName: port.pinName,
          text: `${label}.${port.pinName}`,
        });
    }
  }
  const nameOf = (id: string) =>
    id === GROUND ? "ground" : (logicalNets.byId.get(id)?.name ?? id);
  for (const { sides, outputs } of byPair.values()) {
    if (outputs.length < 2) continue;
    outputs.sort((left, right) =>
      left.text.localeCompare(right.text, "en", { numeric: true }),
    );
    const [first, ...rest] = outputs;
    const forced = sides.filter((id) => id !== GROUND);
    const where =
      forced.length === 1
        ? `Net ${nameOf(forced[0]!)}`
        : `Nets ${nameOf(sides[0])} and ${nameOf(sides[1])}`;
    diagnostics.push({
      id: `erc:conflicting-voltage-outputs:${document.id}:${sides.join(":")}`,
      domain: "erc",
      code: "ERC_CONFLICTING_VOLTAGE_OUTPUTS",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `${outputs.length} voltage outputs (${outputs
        .map((output) => output.text)
        .join(
          ", ",
        )}) force the voltage of ${where}${forced.length === 1 ? " from ground" : ""}: ideal sources and behavioural outputs cannot share it, so the circuit has no consistent solution. Keep one, or put a resistance between them`,
      primary: terminalLocator(document.id, first!.instanceId, first!.pinName),
      related: [
        ...rest.map((output) =>
          terminalLocator(document.id, output.instanceId, output.pinName),
        ),
        ...forced.map((id) => directObjectLocator(document.id, "net", id)),
      ],
      parameters: {
        netId: forced[0]!,
        ...(forced[1] ? { otherNetId: forced[1] } : {}),
        count: outputs.length,
      },
    });
  }
}

/**
 * A two-pin part whose pins share one Logical Net does nothing: it is
 * shorted. The drawing can still show it in series, as a part dropped onto a
 * wire over the wire's own end once did, with the wire hidden under its body.
 * Parts with more pins are not judged: a dummy transistor ties every pin to
 * one supply on purpose.
 */
export function reportShortedTwoPinParts(
  document: Document,
  logicalNets: LogicalNets,
  resolver: SymbolResolver,
  diagnostics: ErcDiagnostic[],
): void {
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  for (const instance of document.instances) {
    if (!instance.placement) continue;
    const resolved = resolver.resolve(
      instance.symbolId,
      instance.symbolVariantId,
    );
    if (!resolved) continue;
    const hidden = variantHiddenPinNames(resolved.variant);
    const pins = resolved.definition.pins.filter(
      (pin) => !hidden.has(pin.name),
    );
    if (pins.length !== 2) continue;
    const [first, second] = pins.map(
      (pin) => netOfTerminal.get(terminalPinKey(instance.id, pin.name)) ?? null,
    );
    if (!first || first !== second) continue;
    const name = logicalNets.byId.get(first)?.name;
    const label = instance.reference ?? instance.id;
    diagnostics.push({
      id: `erc:shorted-part:${document.id}:${instance.id}`,
      domain: "erc",
      code: "ERC_SHORTED_DEVICE",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `${label}'s two pins are on one Net${name ? ` (${name})` : ""}, so the part is shorted`,
      primary: directObjectLocator(document.id, "instance", instance.id),
      related: pins.map((pin) =>
        terminalLocator(document.id, instance.id, pin.name),
      ),
      parameters: { instanceId: instance.id, netId: first },
    });
  }
}

/**
 * A child interface can be shared by several parent instances. Preserve the
 * per-instance mismatch rules above for compatibility, then provide one
 * repair-oriented diagnostic rooted at the child interface with every stale
 * caller as a related location.
 */
export function reportStaleHierarchyInterfaces(
  project: CircuitProject,
  documents: readonly Document[],
  resolver: SymbolResolver,
  target: SchematicDocument | undefined,
  diagnostics: ErcDiagnostic[],
): void {
  const staleCallersByChild = new Map<
    string,
    {
      child: Document;
      callers: Array<{
        parentDocumentId: string;
        instanceId: string;
        pinNames: ReadonlySet<string>;
      }>;
    }
  >();
  for (const parent of documents) {
    const callers = parent.instances.filter(
      ({ netlist }) =>
        netlist?.binding?.kind === "subcircuit" &&
        (!target || netlist.binding.childDocumentId === target.id),
    );
    for (const instance of callers.sort((left, right) =>
      left.id.localeCompare(right.id, "en"),
    )) {
      const childBinding = instance.netlist?.binding;
      if (childBinding?.kind !== "subcircuit") continue;
      const childDocumentId = childBinding.childDocumentId;
      const child = project.documents.find(
        (candidate) => candidate.id === childDocumentId,
      );
      const resolved = resolver.resolve(
        instance.symbolId,
        instance.symbolVariantId,
      );
      // A Library gate's fit is its own finding above.
      if (!child || !resolved || gateCellBinding(project, instance)) continue;
      const pinNames = new Set(resolved.definition.pins.map((pin) => pin.name));
      const childPortNames = new Set(
        projectCellInterface(child.netlist).ports.map((port) => port.name),
      );
      const compatible =
        pinNames.size === childPortNames.size &&
        [...pinNames].every((pinName) => childPortNames.has(pinName));
      if (compatible) continue;
      const group = staleCallersByChild.get(child.id) ?? {
        child,
        callers: [],
      };
      group.callers.push({
        parentDocumentId: parent.id,
        instanceId: instance.id,
        pinNames,
      });
      staleCallersByChild.set(child.id, group);
    }
  }
  for (const [childDocumentId, group] of [
    ...staleCallersByChild.entries(),
  ].sort(([left], [right]) => left.localeCompare(right, "en"))) {
    const expectedNames = new Set(
      group.callers.flatMap((caller) => [...caller.pinNames]),
    );
    const mismatchedTerminal = [
      ...projectCellInterface(group.child.netlist).ports,
    ]
      .filter((terminal) => !expectedNames.has(terminal.name))
      .sort((left, right) => left.name.localeCompare(right.name, "en"))[0];
    const primary = directObjectLocator(
      group.child.id,
      "document",
      group.child.id,
    );
    diagnostics.push({
      id: `erc:hierarchy-interface-stale:${childDocumentId}`,
      domain: "erc",
      code: "ERC_HIERARCHY_INTERFACE_STALE",
      severity: "error",
      confidence: "high",
      gateEligible: true,
      message: `Child document ${childDocumentId} interface does not match ${group.callers.length} caller instance${group.callers.length === 1 ? "" : "s"}`,
      primary,
      related: group.callers.map((caller) =>
        directObjectLocator(
          caller.parentDocumentId,
          "instance",
          caller.instanceId,
        ),
      ),
      parameters: {
        childDocumentId,
        callerCount: group.callers.length,
        ...(mismatchedTerminal
          ? { childTerminalName: mismatchedTerminal.name }
          : {}),
      },
    });
  }
}
