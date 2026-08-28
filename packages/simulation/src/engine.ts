import type {
  DigitalSimulationRequest,
  DigitalSimulationResult,
  DigitalTrace,
  LogicValue,
  SimulationDiagnostic,
} from "./contract.js";
import { extractDigitalCircuit, type DigitalGate } from "./extract.js";
import {
  logicAnd,
  logicNot,
  logicOr,
  logicXor,
  resolveDrivers,
} from "./logic.js";

interface ScheduledDriverEvent {
  readonly timePs: number;
  readonly driverId: string;
  readonly netId: string;
  readonly value: LogicValue;
  readonly order: number;
}

function gateValue(
  gate: DigitalGate,
  states: ReadonlyMap<string, LogicValue>,
): LogicValue {
  const inputs = gate.inputNetIds.map((netId) => states.get(netId) ?? "Z");
  switch (gate.kind) {
    case "buffer":
      return inputs[0] === "Z" ? "X" : inputs[0]!;
    case "inverter":
      return logicNot(inputs[0]!);
    case "and":
      return logicAnd(inputs);
    case "nand":
      return logicNot(logicAnd(inputs));
    case "or":
      return logicOr(inputs);
    case "nor":
      return logicNot(logicOr(inputs));
    case "xor":
      return logicXor(inputs);
    case "xnor":
      return logicNot(logicXor(inputs));
  }
}

function complement(value: LogicValue): LogicValue {
  return value === "0" || value === "1" ? logicNot(value) : "X";
}

export function simulateDigitalDocument({
  document,
  profile,
}: DigitalSimulationRequest): DigitalSimulationResult {
  const diagnostics: SimulationDiagnostic[] = [];
  if (
    !Number.isSafeInteger(profile.stopTimePs) ||
    profile.stopTimePs <= 0 ||
    (profile.maxDeltaCycles !== undefined &&
      (!Number.isSafeInteger(profile.maxDeltaCycles) ||
        profile.maxDeltaCycles <= 0))
  ) {
    return {
      documentId: document.id,
      documentRevision: document.revision,
      stopTimePs: profile.stopTimePs,
      traces: [],
      diagnostics: [
        {
          code: "SIM_INVALID_PROFILE",
          severity: "error",
          message:
            "Simulation stopTimePs and maxDeltaCycles must be positive safe integers",
          objectIds: [document.id],
        },
      ],
      completed: false,
    };
  }

  const circuit = extractDigitalCircuit(document, profile);
  diagnostics.push(...circuit.diagnostics);
  const states = new Map<string, LogicValue>(
    circuit.logicalNets.map((net) => [net.id, "Z"]),
  );
  const drivers = new Map<string, Map<string, LogicValue>>(
    circuit.logicalNets.map((net) => [net.id, new Map()]),
  );
  const setDriver = (
    netId: string,
    driverId: string,
    value: LogicValue,
  ): boolean => {
    const netDrivers = drivers.get(netId);
    if (!netDrivers) return false;
    const priorDriver = netDrivers.get(driverId);
    if (priorDriver === value) return false;
    netDrivers.set(driverId, value);
    const resolved = resolveDrivers(netDrivers.values());
    const changed = states.get(netId) !== resolved;
    states.set(netId, resolved);
    return changed;
  };

  const maxDeltaCycles = profile.maxDeltaCycles ?? 256;
  const settle = (timePs: number): boolean => {
    for (let delta = 0; delta < maxDeltaCycles; delta += 1) {
      let changed = false;
      for (const gate of circuit.gates) {
        changed =
          setDriver(
            gate.outputNetId,
            `${gate.instanceId}\u0000Y`,
            gateValue(gate, states),
          ) || changed;
      }
      if (!changed) return true;
    }
    diagnostics.push({
      code: "SIM_DID_NOT_SETTLE",
      severity: "error",
      message: `Digital network did not settle at ${timePs} ps after ${maxDeltaCycles} delta cycles`,
      objectIds: [document.id],
    });
    return false;
  };

  for (const dff of circuit.dffs) {
    setDriver(dff.qNetId, `${dff.instanceId}\u0000Q`, dff.initialQ);
    if (dff.qBarNetId) {
      setDriver(
        dff.qBarNetId,
        `${dff.instanceId}\u0000QBAR`,
        complement(dff.initialQ),
      );
    }
  }

  const events: ScheduledDriverEvent[] = [];
  let eventOrder = 0;
  for (const source of circuit.pulseSources) {
    const driverId = `${source.instanceId}\u0000+`;
    events.push({
      timePs: 0,
      driverId,
      netId: source.outputNetId,
      value: source.initialValue,
      order: eventOrder++,
    });
    const firstActive = source.initialValue === "0" ? "1" : "0";
    for (
      let cycleStart = source.delayPs;
      cycleStart <= profile.stopTimePs;
      cycleStart += source.periodPs
    ) {
      events.push({
        timePs: cycleStart,
        driverId,
        netId: source.outputNetId,
        value: firstActive,
        order: eventOrder++,
      });
      const secondTime = cycleStart + source.highTimePs;
      if (secondTime <= profile.stopTimePs) {
        events.push({
          timePs: secondTime,
          driverId,
          netId: source.outputNetId,
          value: complement(firstActive),
          order: eventOrder++,
        });
      }
    }
  }
  events.sort(
    (left, right) => left.timePs - right.timePs || left.order - right.order,
  );

  const savedLogicalIds: string[] = [];
  for (const baseNetId of profile.savedNetIds) {
    const logicalNetId = circuit.logicalNetIdByBaseNetId.get(baseNetId);
    if (!logicalNetId) {
      diagnostics.push({
        code: "SIM_UNKNOWN_SAVED_NET",
        severity: "warning",
        message: `Saved Net ${baseNetId} is not present in Document ${document.id}`,
        objectIds: [baseNetId],
      });
      continue;
    }
    if (!savedLogicalIds.includes(logicalNetId))
      savedLogicalIds.push(logicalNetId);
  }
  const traceByNetId = new Map<string, DigitalTrace>();
  for (const netId of savedLogicalIds) {
    const net = circuit.logicalNets.find(
      (candidate) => candidate.id === netId,
    )!;
    traceByNetId.set(netId, {
      netId,
      baseNetIds: net.baseNetIds,
      name: net.name,
      transitions: [],
    });
  }
  const record = (timePs: number): void => {
    for (const [netId, trace] of traceByNetId) {
      const value = states.get(netId) ?? "Z";
      const transitions = trace.transitions as Array<{
        timePs: number;
        value: LogicValue;
      }>;
      if (transitions.at(-1)?.value !== value)
        transitions.push({ timePs, value });
    }
  };

  let completed = settle(0);
  let cursor = 0;
  while (completed && cursor < events.length) {
    const timePs = events[cursor]!.timePs;
    const previousClockValues = new Map(
      circuit.dffs.map((dff) => [
        dff.instanceId,
        states.get(dff.clockNetId) ?? "Z",
      ]),
    );
    while (cursor < events.length && events[cursor]!.timePs === timePs) {
      const event = events[cursor]!;
      setDriver(event.netId, event.driverId, event.value);
      cursor += 1;
    }
    completed = settle(timePs);
    if (!completed) break;

    const captures = circuit.dffs.flatMap((dff) => {
      const previous = previousClockValues.get(dff.instanceId);
      const current = states.get(dff.clockNetId) ?? "Z";
      if (previous !== "0" || current !== "1") return [];
      const d = states.get(dff.dNetId) ?? "Z";
      return [{ dff, q: d === "0" || d === "1" ? d : ("X" as const) }];
    });
    for (const { dff, q } of captures) {
      setDriver(dff.qNetId, `${dff.instanceId}\u0000Q`, q);
      if (dff.qBarNetId) {
        setDriver(dff.qBarNetId, `${dff.instanceId}\u0000QBAR`, complement(q));
      }
    }
    completed = settle(timePs);
    record(timePs);
  }
  if (events.length === 0 || events[0]!.timePs !== 0) record(0);

  return {
    documentId: document.id,
    documentRevision: document.revision,
    stopTimePs: profile.stopTimePs,
    traces: [...traceByNetId.values()],
    diagnostics,
    completed:
      completed &&
      !diagnostics.some((diagnostic) => diagnostic.severity === "error"),
  };
}
