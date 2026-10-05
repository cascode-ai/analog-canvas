import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
} from "@icm/agent-adapter";
import {
  instanceParameterContract,
  subcircuitDescriptor,
  validateDeviceParameters,
} from "@icm/devices";
import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
  pinAnchoredPlacement,
} from "@icm/edit-engine";
import {
  reflectOrientation,
  type CircuitProject,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { ComponentPropertyCodeValue } from "../features/properties/component-property-code";
import { planPropertyApply } from "../features/properties/property-apply-plan";

type SetProperties = Extract<AgentAuthoringCommand, { kind: "set-properties" }>;

/**
 * One message per refused parameter, as an Agent needs it to correct the
 * call: the GUI accepts any name and lets ERC report it later; an Agent is
 * told at once, with the names the part's model owns.
 */
function parameterIssue(
  project: CircuitProject,
  instance: Instance,
  parameters: Readonly<Record<string, string>>,
): string | undefined {
  // The parameters the part's model owns, as export reads them: a part bound
  // to a reviewed SKY130 model takes that model's (a resistor's w, l, mult).
  // Custom and imported symbols outside the registry remain a human-fact
  // boundary; their contracts are not known here.
  const contract = instanceParameterContract(project, instance);
  if (!contract) return undefined;
  const issue = validateDeviceParameters(
    { parameters: contract.definitions },
    parameters,
    { open: contract.open },
  )[0];
  if (!issue) return undefined;
  const allowed = contract.definitions.map((parameter) => parameter.name);
  const allowedText = allowed.length ? allowed.join(", ") : "(none)";
  switch (issue.kind) {
    case "unknown":
      return `Unknown parameter "${issue.name}" for ${instance.symbolId}${
        issue.suggestion ? `; did you mean "${issue.suggestion}"?` : ""
      }; allowed parameters: ${allowedText}`;
    case "number":
      return `Parameter "${issue.name}" must be a SPICE number such as 1k or 2.5n, or an expression in braces such as {vdd/2}; received "${issue.value}"${
        /[µμ]/u.test(issue.value) ? " (SPICE writes micro as u)" : ""
      }`;
    case "duplicate":
      return `Parameter "${issue.name}" duplicates "${issue.previousName}" under case folding`;
    case "select":
      return `Parameter "${issue.name}" must be one of: ${issue.allowed.join(", ")}; received "${issue.value}"`;
    default:
      return `Parameter "${issue.name}" must be a finite decimal number; received "${issue.value}"`;
  }
}

/** The formula block's drawing after a change; null clears a field. */
function nextSignalFlow(
  instance: Instance,
  change: NonNullable<SetProperties["signalFlow"]>,
  resolver: SymbolResolver,
): Record<string, string | number> {
  const presentation = resolver.resolve(
    instance.symbolId,
    instance.symbolVariantId,
  )?.definition.formulaPresentation;
  const name = instance.reference ?? instance.id;
  if (!presentation)
    throw new Error(`${name} (${instance.symbolId}) draws no formula`);
  const next: Record<string, unknown> = {
    ...(instance.signalFlowParameters ?? {}),
  };
  for (const key of [
    "formula",
    "coefficient",
    "bodyWidth",
    "bodyHeight",
  ] as const) {
    if (!(key in change)) continue;
    const value = change[key];
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  return next as Record<string, string | number>;
}

/**
 * Apply in Properties, for an Agent: the change is written into the value the
 * Properties panel would hold and planned by the same function, so a part
 * changed either way comes out the same.
 */
export function planSetProperties(
  project: CircuitProject,
  document: SchematicDocument,
  resolver: SymbolResolver,
  command: SetProperties,
): AgentCommandPlan {
  const instance = document.instances.find(
    (item) => item.id === command.instanceId,
  );
  if (!instance) throw new Error(`Instance not found: ${command.instanceId}`);
  const name = instance.reference ?? instance.id;
  const value: ComponentPropertyCodeValue = {
    placement: null,
    appearance: {
      color: (instance.styleOverride?.foreground ??
        "auto") as ComponentPropertyCodeValue["appearance"]["color"],
    },
  };
  const formalPin = document.netlist?.terminals.some((terminal) =>
    terminal.interfaceInstanceIds.includes(instance.id),
  );
  if (command.reference !== undefined) {
    // A Cell Pin is renamed through its interface, as its name field does.
    if (formalPin) value.displayName = command.reference;
    else value.netlistName = command.reference;
  }
  if (command.parameters) {
    if (!instance.netlist)
      throw new Error(
        `${name} has no netlist parameters${
          resolver.resolve(instance.symbolId, instance.symbolVariantId)
            ?.definition.formulaPresentation
            ? "; use set-signal-flow for its formula or coefficient"
            : ""
        }`,
      );
    const changed = [
      ...Object.keys(command.parameters.set ?? {}),
      ...(command.parameters.unset ?? []),
    ];
    if (changed.some((key) => key.startsWith("spice.")))
      throw new Error(
        "spice.* keys are migration-only; use typed netlist facts",
      );
    const issue = command.parameters.set
      ? parameterIssue(project, instance, command.parameters.set)
      : undefined;
    if (issue) throw new Error(issue);
    // Properties holds the whole map: a key left out is removed.
    const parameters = {
      ...instance.netlist.parameters,
      ...(command.parameters.set ?? {}),
    };
    for (const key of command.parameters.unset ?? []) delete parameters[key];
    value.parameters = parameters;
  }
  if (command.signalFlow) {
    value.signalFlow = nextSignalFlow(instance, command.signalFlow, resolver);
  }
  if (command.supplies) {
    const descriptor = subcircuitDescriptor(instance.symbolId, project);
    value.supplies = {};
    for (const [pinName, netId] of Object.entries(command.supplies)) {
      if (netId === undefined) continue;
      if (!descriptor?.ports.some((port) => port.supply === pinName))
        throw new Error(`${name} has no ${pinName} supply to choose`);
      if (netId !== null && !document.nets.some((net) => net.id === netId))
        throw new Error(`Net not found: ${netId}`);
      value.supplies[pinName] = netId ?? "";
    }
  }
  let clearControl = false;
  if (command.control !== undefined) {
    const control = command.control;
    // Properties cannot clear a control or set a legacy current sensor; an
    // Agent can, through the same netlist record.
    if (control === null || control.kind === "current") clearControl = true;
    else
      value.control =
        control.kind === "voltage"
          ? {
              positiveNetId: control.positiveNetId ?? "",
              negativeNetId: control.negativeNetId ?? "",
            }
          : {
              instanceId: control.instanceId ?? "",
              pinName: control.pinName ?? "",
              direction: control.direction,
            };
  }
  if (command.placement) {
    const requested = command.placement;
    if (!instance.placement)
      throw new Error(`${name} is not placed; place it first`);
    if (requested.position && requested.pinAnchor)
      throw new Error("Give position or pinAnchor, not both");
    if (requested.mirror && requested.reflect)
      throw new Error("Give mirror or reflect, not both");
    const rotation = requested.rotation ?? instance.placement.rotation;
    const mirror = requested.reflect
      ? reflectOrientation(
          instance.placement,
          requested.reflect === "y" ? "left-right" : "top-bottom",
        ).mirror
      : (requested.mirror ?? instance.placement.mirror);
    const position = requested.pinAnchor
      ? pinAnchoredPlacement(
          document,
          resolver,
          {
            ...instance,
            placement: { ...instance.placement, rotation, mirror },
          },
          requested.pinAnchor,
        ).position
      : (requested.position ?? instance.placement.position);
    value.placement = {
      coordinate: [position.x, position.y],
      rotation,
      mirror,
    };
  }
  const plan = planPropertyApply(
    { project, document, resolver, instance },
    value,
  );
  const controlEdits = clearControl
    ? [
        {
          kind: "set_instance_netlist" as const,
          instanceId: instance.id,
          netlist: {
            ...(instance.netlist?.binding
              ? { binding: instance.netlist.binding }
              : {}),
            // The parameters this same call leaves, not the ones it replaced.
            parameters: value.parameters
              ? Object.fromEntries(
                  Object.entries(value.parameters).filter(
                    ([, raw]) => raw.trim() !== "",
                  ),
                )
              : { ...(instance.netlist?.parameters ?? {}) },
            ...(command.control?.kind === "current"
              ? { control: command.control }
              : {}),
          },
        },
      ]
    : [];
  switch (plan.kind) {
    case "rejected":
      throw new Error(plan.message);
    case "unchanged":
      return { edits: controlEdits };
    case "structure":
      if (controlEdits.length)
        throw new Error("Change the control in its own call");
      return { structureEdits: plan.structureEdits };
    case "connectivity": {
      const gate = gateRoutingOperationPlan(
        document,
        createRoutingOperationPlan(document, {
          intent: plan.intent,
          edits: plan.edits,
          diagnostics: [],
          expectedElectricalEffect: plan.expectedElectricalEffect,
        }),
        { symbolResolver: resolver },
      );
      if (!gate.ok) throw new Error(gate.message);
      return { edits: [...gate.edits, ...controlEdits] };
    }
    case "edits":
      return { edits: [...plan.edits, ...controlEdits] };
  }
}
