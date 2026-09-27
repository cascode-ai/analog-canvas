import type { SchematicDocument } from "@icm/model";
import { terminalCurrentDirectionPartners } from "../simulation/terminal-current-pick";
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
  | {
      documentId: string;
      instanceId: string;
      kind: "current";
      positive?: {
        instanceId: string;
        pinName: string;
        partners: readonly string[];
      };
    };

export type ControlPickTarget =
  | { kind: "net"; netId: string }
  | { kind: "sensor"; instanceId: string }
  | { kind: "terminal"; instanceId: string; pinName: string };

export type ControlPickResult =
  | { kind: "await-negative"; state: ControlPickState; message: string }
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

/** Voltage endpoints apply immediately. Current direction is one atomic edit
 * after the two clicks, so cancellation leaves the authored control untouched. */
export function advanceControlPick(
  state: ControlPickState,
  document: SchematicDocument,
  target: ControlPickTarget,
  isCurrentTerminal: (instanceId: string, pinName: string) => boolean,
  terminalNames: (instanceId: string) => readonly string[] = () => [],
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
  if (!state.positive) {
    const partners = terminalCurrentDirectionPartners(
      sensor,
      target.pinName,
      terminalNames(sensor.id),
    );
    if (!partners.length)
      return {
        kind: "reject",
        message: "Choose a two-terminal branch or a MOS drain/source pair",
      };
    return {
      kind: "await-negative",
      state: {
        ...state,
        positive: { instanceId: sensor.id, pinName: target.pinName, partners },
      },
      message: `Control +: ${sensor.reference ?? sensor.id}.${target.pinName}; pick control − on the same device`,
    };
  }
  if (
    state.positive.instanceId !== sensor.id ||
    !isCurrentTerminal(sensor.id, state.positive.pinName) ||
    !terminalCurrentDirectionPartners(
      sensor,
      state.positive.pinName,
      terminalNames(sensor.id),
    ).includes(target.pinName)
  )
    return {
      kind: "reject",
      message: "Choose the highlighted − terminal of the same device",
    };
  return {
    kind: "complete",
    control: {
      kind: "terminal-current",
      instanceId: sensor.id,
      pinName: state.positive.pinName,
      direction: "into",
    },
    message: `Control current: ${sensor.reference ?? sensor.id}.${state.positive.pinName} → ${sensor.reference ?? sensor.id}.${target.pinName}`,
  };
}
