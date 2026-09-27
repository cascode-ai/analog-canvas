import type { SchematicDocument } from "@icm/model";
import {
  logicalNetChoiceForNet,
  logicalNetChoices,
} from "../logical-net-choices";

export type ControlPickState =
  | {
      documentId: string;
      instanceId: string;
      kind: "voltage";
      positiveNetId?: string;
    }
  | { documentId: string; instanceId: string; kind: "current" };

export type ControlPickTarget =
  | { kind: "net"; netId: string }
  | { kind: "sensor"; instanceId: string }
  | { kind: "terminal"; instanceId: string; pinName: string };

export type ControlPickResult =
  | {
      kind: "continue";
      state: ControlPickState;
      control: {
        kind: "voltage";
        positiveNetId: string;
        negativeNetId?: string;
      };
      message: string;
    }
  | {
      kind: "complete";
      control:
        | { kind: "voltage"; positiveNetId: string; negativeNetId: string }
        | {
            kind: "terminal-current";
            instanceId: string;
            pinName: string;
            direction: "into" | "out";
          };
      message: string;
    }
  | { kind: "reject"; message: string };

/** Each accepted endpoint is an immediate edit; Escape stops remaining picks. */
export function advanceControlPick(
  state: ControlPickState,
  document: SchematicDocument,
  target: ControlPickTarget,
  isCurrentTerminal: (instanceId: string, pinName: string) => boolean,
): ControlPickResult {
  if (
    state.documentId !== document.id ||
    !document.instances.some((instance) => instance.id === state.instanceId)
  ) {
    return {
      kind: "reject",
      message: "The controlled source is no longer in this Cell",
    };
  }
  if (state.kind === "voltage") {
    if (target.kind !== "net")
      return {
        kind: "reject",
        message: "Click a connected wire, junction, label, or pin",
      };
    const choice = logicalNetChoiceForNet(
      logicalNetChoices(document),
      target.netId,
    );
    if (!choice)
      return { kind: "reject", message: "This point has no resolvable Net" };
    if (!state.positiveNetId) {
      const previous = document.instances.find(
        (instance) => instance.id === state.instanceId,
      )?.netlist?.control;
      return {
        kind: "continue",
        state: { ...state, positiveNetId: choice.netId },
        control: {
          kind: "voltage",
          positiveNetId: choice.netId,
          ...(previous?.kind === "voltage" && previous.negativeNetId
            ? { negativeNetId: previous.negativeNetId }
            : {}),
        },
        message: `Control +: ${choice.label}; now pick control −`,
      };
    }
    if (state.positiveNetId === choice.netId)
      return { kind: "reject", message: "Control − must be a different Net" };
    return {
      kind: "complete",
      control: {
        kind: "voltage",
        positiveNetId: state.positiveNetId,
        negativeNetId: choice.netId,
      },
      message: `Control Nets selected: + ${logicalNetChoiceForNet(logicalNetChoices(document), state.positiveNetId)?.label ?? "Net"}, − ${choice.label}`,
    };
  }
  if (target.kind !== "terminal")
    return {
      kind: "reject",
      message: "Click a specific device terminal, not its body",
    };
  const sensor = document.instances.find(
    (instance) => instance.id === target.instanceId,
  );
  if (!sensor || !isCurrentTerminal(sensor.id, target.pinName))
    return {
      kind: "reject",
      message: "This is not an electrical device terminal",
    };
  const previous = document.instances.find(
    (item) => item.id === state.instanceId,
  )?.netlist?.control;
  const direction =
    previous?.kind === "terminal-current" ? previous.direction : "into";
  return {
    kind: "complete",
    control: {
      kind: "terminal-current",
      instanceId: sensor.id,
      pinName: target.pinName,
      direction,
    },
    message: `Control current: ${sensor.reference ?? sensor.id}.${target.pinName}, ${direction} device`,
  };
}
