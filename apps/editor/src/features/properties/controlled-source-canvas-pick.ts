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
  { kind: "net"; netId: string } | { kind: "sensor"; instanceId: string };

export type ControlPickResult =
  | { kind: "continue"; state: ControlPickState; message: string }
  | {
      kind: "complete";
      control:
        | { kind: "voltage"; positiveNetId: string; negativeNetId: string }
        | { kind: "current"; sensorInstanceId: string };
      message: string;
    }
  | { kind: "reject"; message: string };

/** Keep the first voltage pick provisional; cancelling never leaves half a control. */
export function advanceControlPick(
  state: ControlPickState,
  document: SchematicDocument,
  target: ControlPickTarget,
  isVoltageSource: (symbolId: string) => boolean,
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
      return {
        kind: "continue",
        state: { ...state, positiveNetId: choice.netId },
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
  if (target.kind !== "sensor")
    return {
      kind: "reject",
      message: "Click a voltage source or one of its pins",
    };
  const sensor = document.instances.find(
    (instance) => instance.id === target.instanceId,
  );
  if (!sensor || !isVoltageSource(sensor.symbolId))
    return {
      kind: "reject",
      message: "Branch-current control needs a voltage source as its sensor",
    };
  return {
    kind: "complete",
    control: { kind: "current", sensorInstanceId: sensor.id },
    message: `Current sensor selected: ${sensor.reference ?? "voltage source"}`,
  };
}
