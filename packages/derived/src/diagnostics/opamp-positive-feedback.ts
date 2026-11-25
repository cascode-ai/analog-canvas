import {
  DIFFERENTIAL_OPAMP_TARGET,
  deviceDescriptor,
  drawnSwitchControl,
  subcircuitDescriptor,
  type DeviceDescriptor,
} from "@icm/devices";
import type { CircuitProject } from "@icm/model";

import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator, type ObjectLocator } from "../object-locator.js";
import type { ErcDiagnostic } from "./erc.js";
import {
  VOLTAGE_SOURCE_CLASSES,
  buildTerminalLogicalNetMap,
  isSubcircuitBound,
  terminalLocator,
} from "./erc-shared.js";

const PASSIVE_FEEDBACK_CLASSES = new Set(["resistor", "capacitor", "inductor"]);

/** Max passive hops traversed when looking for feedback (covers series R-C and S-C-S). */
const MAX_FEEDBACK_HOPS = 3;

function passivePinPairs(
  device: DeviceDescriptor,
): readonly (readonly [string, string])[] {
  if (
    PASSIVE_FEEDBACK_CLASSES.has(device.deviceClass) &&
    device.pinOrder.length === 2 &&
    device.id !== "voltmeter"
  )
    return [[device.pinOrder[0]!, device.pinOrder[1]!]];
  if (device.deviceClass !== "switch") return [];
  const control = drawnSwitchControl(device);
  switch (control) {
    case "phase":
      return [[device.pinOrder[0]!, device.pinOrder[1]!]];
    case "pin": {
      const terminals = device.pinOrder.filter((pin) => pin !== "CTRL");
      return terminals.length === 2 ? [[terminals[0]!, terminals[1]!]] : [];
    }
    case "selector":
      return [
        ["COM", "A"],
        ["COM", "B"],
      ];
    case "chopper":
      return [];
    case null:
      return device.pinOrder.includes("P") && device.pinOrder.includes("N")
        ? [["P", "N"]]
        : [];
  }
}

interface PassivePart {
  readonly id: string;
  readonly label: string;
}

interface PassiveNeighbor {
  readonly netId: string;
  readonly part: PassivePart;
}

interface FeedbackConnection {
  readonly direct: boolean;
  readonly parts: readonly PassivePart[];
}

/**
 * A behavioural fully differential op-amp whose output connects back to the
 * same-sign input (`OUT+`↔`IN+` or `OUT-`↔`IN-`, directly or via a passive
 * network) with no negative-feedback connection (`OUT+`↔`IN-` or `OUT-`↔`IN+`)
 * closes a positive-feedback loop and latches (#2568). Uncrossed differential
 * symbols place `OUT-` beside `IN-`, so textbook straight-across feedback
 * closes positive feedback unless the feedback wires cross to the opposite-sign
 * inputs.
 */
export function reportOpAmpPositiveFeedback(
  project: CircuitProject,
  document: CircuitProject["documents"][number],
  logicalNets: ReturnType<typeof resolveDocumentLogicalNets>,
  diagnostics: ErcDiagnostic[],
): void {
  const netOfTerminal = buildTerminalLogicalNetMap(document, logicalNets);
  const netOf = (instanceId: string, pinName: string) =>
    netOfTerminal.get(`${instanceId}\u0000${pinName}`);

  const isSupplyNet = (netId: string): boolean => {
    const domain = logicalNets.byId.get(netId)?.powerDomain;
    return domain !== undefined && domain !== "none";
  };

  // Adjacency for passive feedback elements and ideal voltage sources.
  const passiveAdj = new Map<string, PassiveNeighbor[]>();
  const addPassiveEdge = (a: string, b: string, part: PassivePart) => {
    const fromA = passiveAdj.get(a) ?? [];
    fromA.push({ netId: b, part });
    passiveAdj.set(a, fromA);
    const fromB = passiveAdj.get(b) ?? [];
    fromB.push({ netId: a, part });
    passiveAdj.set(b, fromB);
  };

  const voltageSourceAdj = new Map<
    string,
    { netId: string; instanceId: string }[]
  >();
  const addVoltageSourceEdge = (a: string, b: string, instanceId: string) => {
    const fromA = voltageSourceAdj.get(a) ?? [];
    fromA.push({ netId: b, instanceId });
    voltageSourceAdj.set(a, fromA);
    const fromB = voltageSourceAdj.get(b) ?? [];
    fromB.push({ netId: a, instanceId });
    voltageSourceAdj.set(b, fromB);
  };

  // Nets driven to a fixed potential by an external voltage source (including
  // stacked sources) or behavioural output cannot be moved by feedback from
  // another part: a resistor to such a node is a load, not a feedback loop.
  const externalDriversByNet = new Map<string, Set<string>>();
  const recordDriver = (netId: string, instanceId: string) => {
    const drivers = externalDriversByNet.get(netId) ?? new Set<string>();
    drivers.add(instanceId);
    externalDriversByNet.set(netId, drivers);
  };

  const instances = [...document.instances].sort((left, right) =>
    left.id.localeCompare(right.id, "en"),
  );

  for (const instance of instances) {
    const device = deviceDescriptor(instance.symbolId, project);
    if (device) {
      for (const [firstPin, secondPin] of passivePinPairs(device)) {
        const a = netOf(instance.id, firstPin);
        const b = netOf(instance.id, secondPin);
        if (!a || !b || a === b) continue;
        addPassiveEdge(a, b, {
          id: instance.id,
          label: instance.reference ?? instance.id,
        });
      }
      if (
        !isSubcircuitBound(instance) &&
        VOLTAGE_SOURCE_CLASSES.has(device.deviceClass)
      ) {
        const [plus, minus] = device.pinOrder;
        const a = plus ? netOf(instance.id, plus) : undefined;
        const b = minus ? netOf(instance.id, minus) : undefined;
        if (a && b && a !== b) addVoltageSourceEdge(a, b, instance.id);
      }
      continue;
    }
    if (isSubcircuitBound(instance)) continue;
    const block = subcircuitDescriptor(instance.symbolId, project);
    if (!block || block.target.includes("transconductance")) continue;
    for (const port of block.ports) {
      if (port.direction !== "output" || !("pinName" in port)) continue;
      const outNet = netOf(instance.id, port.pinName);
      if (outNet) recordDriver(outNet, instance.id);
    }
  }

  // Propagate fixed-potential nodes through chains of ideal voltage sources
  // (e.g. GND -- Vcm -- mid -- Vdm -- IN+).
  const fixedQueue: { netId: string; driverId: string }[] = [];
  for (const net of logicalNets.groups)
    if (isSupplyNet(net.id)) fixedQueue.push({ netId: net.id, driverId: "" });
  for (const [netId, drivers] of externalDriversByNet)
    for (const driverId of drivers) fixedQueue.push({ netId, driverId });

  const propagatedFromSupply = new Set<string>();
  while (fixedQueue.length > 0) {
    const current = fixedQueue.shift()!;
    for (const edge of voltageSourceAdj.get(current.netId) ?? []) {
      const nextDriver = current.driverId || edge.instanceId;
      if (isSupplyNet(edge.netId)) continue;
      const existing = externalDriversByNet.get(edge.netId);
      if (existing?.has(nextDriver)) continue;
      if (current.driverId === "" && propagatedFromSupply.has(edge.netId))
        continue;
      if (current.driverId === "") propagatedFromSupply.add(edge.netId);
      recordDriver(edge.netId, nextDriver);
      fixedQueue.push({ netId: edge.netId, driverId: nextDriver });
    }
  }

  const isExternallyFixed = (netId: string, opampId: string): boolean => {
    if (isSupplyNet(netId)) return true;
    const drivers = externalDriversByNet.get(netId);
    if (!drivers) return false;
    for (const driverId of drivers) if (driverId !== opampId) return true;
    return false;
  };

  const hasVoltageSourceChainBetween = (a: string, b: string): boolean => {
    const visited = new Set<string>([a]);
    const queue = [a];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const edge of voltageSourceAdj.get(current) ?? []) {
        if (edge.netId === b) return true;
        if (!visited.has(edge.netId)) {
          visited.add(edge.netId);
          queue.push(edge.netId);
        }
      }
    }
    return false;
  };

  const feedbackBetween = (
    outNet: string | undefined,
    inNet: string | undefined,
    opampId: string,
    ownSignalNets: ReadonlySet<string>,
  ): FeedbackConnection | undefined => {
    if (!outNet || !inNet || isExternallyFixed(inNet, opampId))
      return undefined;
    if (outNet === inNet) return { direct: true, parts: [] };
    // Breadth-first search up to MAX_FEEDBACK_HOPS through non-fixed
    // intermediate nets outside this op-amp's other terminals.
    const visited = new Set<string>([outNet]);
    const queue: { netId: string; depth: number; parts: PassivePart[] }[] = [
      { netId: outNet, depth: 0, parts: [] },
    ];
    let shortestDepth: number | undefined;
    const collectedParts: PassivePart[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (shortestDepth !== undefined && current.depth >= shortestDepth)
        continue;
      if (current.depth >= MAX_FEEDBACK_HOPS) continue;
      for (const edge of passiveAdj.get(current.netId) ?? []) {
        if (edge.netId === inNet) {
          shortestDepth = current.depth + 1;
          collectedParts.push(...current.parts, edge.part);
          continue;
        }
        if (
          visited.has(edge.netId) ||
          ownSignalNets.has(edge.netId) ||
          isExternallyFixed(edge.netId, opampId)
        )
          continue;
        visited.add(edge.netId);
        queue.push({
          netId: edge.netId,
          depth: current.depth + 1,
          parts: [...current.parts, edge.part],
        });
      }
    }
    return collectedParts.length > 0
      ? { direct: false, parts: collectedParts }
      : undefined;
  };

  for (const instance of instances) {
    if (isSubcircuitBound(instance)) continue;
    const block = subcircuitDescriptor(instance.symbolId, project);
    if (block?.target !== DIFFERENTIAL_OPAMP_TARGET) continue;

    const inPlus = netOf(instance.id, "IN+");
    const inMinus = netOf(instance.id, "IN-");
    const outPlus = netOf(instance.id, "OUT+");
    const outMinus = netOf(instance.id, "OUT-");

    // A floating voltage source directly bridging IN+ and IN- forces the
    // differential input voltage, so passives from the outputs are loads.
    if (inPlus && inMinus && hasVoltageSourceChainBetween(inPlus, inMinus))
      continue;

    const ownSignalNets = new Set(
      [inPlus, inMinus, outPlus, outMinus].filter(
        (id): id is string => id !== undefined,
      ),
    );

    const posPlus = feedbackBetween(
      outPlus,
      inPlus,
      instance.id,
      ownSignalNets,
    );
    const posMinus = feedbackBetween(
      outMinus,
      inMinus,
      instance.id,
      ownSignalNets,
    );
    if (!posPlus && !posMinus) continue;

    const negPlus = feedbackBetween(
      outPlus,
      inMinus,
      instance.id,
      ownSignalNets,
    );
    const negMinus = feedbackBetween(
      outMinus,
      inPlus,
      instance.id,
      ownSignalNets,
    );
    if (negPlus || negMinus) continue;

    const label = instance.reference ?? instance.id;
    const pairs: {
      outPin: string;
      inPin: string;
      connection: FeedbackConnection;
    }[] = [];
    if (posPlus)
      pairs.push({ outPin: "OUT+", inPin: "IN+", connection: posPlus });
    if (posMinus)
      pairs.push({ outPin: "OUT-", inPin: "IN-", connection: posMinus });

    const describePair = ({
      outPin,
      inPin,
      connection,
    }: (typeof pairs)[number]) => {
      if (connection.direct) return `${outPin} directly to ${inPin}`;
      const names = [...new Set(connection.parts.map((part) => part.label))]
        .sort((left, right) =>
          left.localeCompare(right, "en", { numeric: true }),
        )
        .join(", ");
      return `${outPin} to ${inPin} through ${names}`;
    };

    const partIds = [
      ...new Set(
        pairs.flatMap((pair) => pair.connection.parts.map((part) => part.id)),
      ),
    ].sort((left, right) => left.localeCompare(right, "en"));

    const related: ObjectLocator[] = [
      ...pairs.flatMap(({ outPin, inPin }) => [
        terminalLocator(document.id, instance.id, outPin),
        terminalLocator(document.id, instance.id, inPin),
      ]),
      ...partIds.map((partId) =>
        directObjectLocator(document.id, "instance", partId),
      ),
    ];

    diagnostics.push({
      id: `erc:opamp-positive-feedback:${document.id}:${instance.id}`,
      domain: "erc",
      code: "ERC_OPAMP_POSITIVE_FEEDBACK",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `${label} connects ${pairs.map(describePair).join(" and ")} (positive feedback with no negative feedback), so it will latch instead of amplifying or integrating; rewire feedback to the opposite-sign input (OUT+ to IN-, OUT- to IN+)`,
      primary: directObjectLocator(document.id, "instance", instance.id),
      related,
      parameters: {
        instanceId: instance.id,
        pairs: pairs
          .map(({ outPin, inPin }) => `${outPin}->${inPin}`)
          .join(","),
      },
    });
  }
}
