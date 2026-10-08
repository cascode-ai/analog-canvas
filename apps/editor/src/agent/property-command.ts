import type {
  AgentAuthoringCommand,
  AgentCommandPlan,
  AgentCommandPlanNote,
} from "@icm/agent-adapter";
import { deriveDocumentContactEvidence, endpointKey } from "@icm/derived";
import {
  instanceParameterContract,
  milliScaleReading,
  quantityForms,
  subcircuitDescriptor,
  validateDeviceParameters,
} from "@icm/devices";
import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
  pinAnchoredPlacement,
  type SchematicEdit,
} from "@icm/edit-engine";
import {
  reflectOrientation,
  routeEndpoints,
  type CircuitProject,
  type Instance,
  type SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { ComponentPropertyCodeValue } from "../features/properties/component-property-code";
import {
  logicGateInputInfo,
  type LogicGateInputCount,
} from "../features/properties/logic-gate-input-count";
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
    case "number": {
      // A SPICE number still, but one that reads as milli where mega was meant.
      const milli = milliScaleReading(issue.value);
      return milli
        ? `Parameter "${issue.name}" is "${issue.value}", which ${milli}`
        : `Parameter "${issue.name}" must be ${quantityForms(issue)}; received "${issue.value}"${
            /[µμ]/u.test(issue.value) ? " (SPICE writes micro as u)" : ""
          }`;
    }
    case "duplicate":
      return `Parameter "${issue.name}" duplicates "${issue.previousName}" under case folding`;
    case "select":
      return `Parameter "${issue.name}" must be one of: ${issue.allowed.join(", ")}; received "${issue.value}"`;
    case "decimal":
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

/** The markers a moved part carries when they stand on its pins (#1531). */
const PIN_MARKERS = {
  ground: "ground",
  "vdd-port": "supply marker",
  port: "Cell Pin",
  "port-filled": "Cell Pin",
} as const;

/**
 * The ground, supply and Cell Pin markers that touch one of a part's pins
 * and have no other connection: no wire of their own, and nothing else at
 * that point but the pin. House style stands a ground on its pin, so moving
 * the part alone left the ground behind on a jog wire (#1531). A marker that
 * is wired, shares the point with another pin or is locked in place stays.
 */
function markersOnPinsOnly(
  document: SchematicDocument,
  resolver: SymbolResolver,
  instance: Instance,
): { marker: Instance; pinName: string }[] {
  if (instance.symbolId in PIN_MARKERS) return [];
  const wired = new Set(
    document.routes.flatMap((route) => routeEndpoints(route).map(endpointKey)),
  );
  // A marker held by a locked group or constraint stays, and so does one
  // with a locked label: moving it would move that label, and the move would
  // be refused as a whole.
  const locked = new Set([
    ...[...document.layoutGroups, ...document.constraints].flatMap((owner) =>
      owner.locked ? owner.objectIds : [],
    ),
    ...document.annotations.flatMap((annotation) =>
      annotation.locked && annotation.anchor.kind === "object"
        ? [annotation.anchor.objectId]
        : [],
    ),
  ]);
  let evidence: ReturnType<typeof deriveDocumentContactEvidence> | undefined;
  return document.instances.flatMap((marker) => {
    if (
      !(marker.symbolId in PIN_MARKERS) ||
      !marker.placement ||
      locked.has(marker.id)
    )
      return [];
    const pins = (
      resolver.resolve(marker.symbolId, marker.symbolVariantId)?.definition
        .pins ?? []
    ).map((pin) =>
      endpointKey({
        kind: "terminal",
        instanceId: marker.id,
        pinName: pin.name,
      }),
    );
    if (!pins.length || pins.some((key) => wired.has(key))) return [];
    evidence ??= deriveDocumentContactEvidence(document, resolver);
    let touched: string | undefined;
    for (const key of pins) {
      const contact = evidence.byEndpointKey.get(key);
      if (!contact) continue;
      const other = contact.endpoints.find(
        (endpoint) => endpointKey(endpoint) !== key,
      );
      if (
        contact.endpoints.length !== 2 ||
        other?.kind !== "terminal" ||
        other.instanceId !== instance.id
      )
        return [];
      touched = other.pinName;
    }
    return touched ? [{ marker, pinName: touched }] : [];
  });
}

/** What the receipt says of the markers a move carried (#1531). */
function markersMovedAlongNote(
  instance: Instance,
  carried: readonly { marker: Instance; pinName: string }[],
): AgentCommandPlanNote {
  const listed = carried.map(
    ({ marker, pinName }) =>
      `the ${PIN_MARKERS[marker.symbolId as keyof typeof PIN_MARKERS]} ${marker.reference ?? marker.id} on pin ${pinName}`,
  );
  const list =
    listed.length === 1
      ? listed[0]!
      : `${listed.slice(0, -1).join(", ")} and ${listed.at(-1)!}`;
  return {
    code: "MARKERS_MOVED_ALONG",
    message: `${instance.reference ?? instance.id} moved with ${list}, which touched it with no wire`,
    objectIds: carried.map(({ marker }) => marker.id),
  };
}

/**
 * Apply in Properties, for an Agent: the change is written into the value the
 * Properties panel would hold and planned by the same function, so a part
 * changed either way comes out the same, but for one thing: a move carries
 * the markers standing on the part's pins with no wire (#1531).
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
  // A gate's input count is its Properties Inputs choice, not a netlist
  // parameter: set {inputs: "3"} switches the symbol and its default target
  // as that choice does (#1457).
  let parameterChange = command.parameters;
  const inputs = parameterChange?.set?.inputs;
  // A Library block takes any parameter name, so a gate without the choice
  // would export `inputs=3` instead of refusing it.
  if (
    inputs !== undefined &&
    !logicGateInputInfo(instance.symbolId) &&
    subcircuitDescriptor(instance.symbolId)
  )
    throw new Error(
      `${name} (${instance.symbolId}) has no input count; inputs is for the and, nand, or, nor, xor and xnor gates`,
    );
  if (inputs !== undefined && logicGateInputInfo(instance.symbolId)) {
    const count = Number(inputs);
    if (count !== 2 && count !== 3 && count !== 4)
      throw new Error(`inputs must be 2, 3, or 4; received "${inputs}"`);
    value.inputs = count as LogicGateInputCount;
    const { inputs: _inputs, ...set } = parameterChange!.set!;
    parameterChange =
      Object.keys(set).length || parameterChange!.unset?.length
        ? { ...parameterChange, set }
        : undefined;
  }
  if (parameterChange) {
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
      ...Object.keys(parameterChange.set ?? {}),
      ...(parameterChange.unset ?? []),
    ];
    if (changed.some((key) => key.startsWith("spice.")))
      throw new Error(
        "spice.* keys are migration-only; use typed netlist facts",
      );
    const issue = parameterChange.set
      ? parameterIssue(project, instance, parameterChange.set)
      : undefined;
    if (issue) throw new Error(issue);
    // Properties holds the whole map: a key left out is removed.
    const parameters = {
      ...instance.netlist.parameters,
      ...(parameterChange.set ?? {}),
    };
    for (const key of parameterChange.unset ?? []) delete parameters[key];
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
  // A move by a step, turning and mirroring nothing, carries the markers.
  const carried =
    value.placement &&
    instance.placement &&
    value.placement.rotation === instance.placement.rotation &&
    value.placement.mirror === instance.placement.mirror
      ? markersOnPinsOnly(document, resolver, instance)
      : [];
  const plan = planPropertyApply(
    {
      project,
      document,
      resolver,
      instance,
      ...(carried.length
        ? { carriedInstanceIds: carried.map(({ marker }) => marker.id) }
        : {}),
    },
    value,
  );
  /** The receipt names the markers the planned edits did move. */
  const withNotes = (edits: SchematicEdit[]): AgentCommandPlan => {
    const moved = carried.filter(({ marker }) =>
      edits.some(
        (edit) =>
          edit.kind === "move_instance" && edit.instanceId === marker.id,
      ),
    );
    return moved.length
      ? { edits, notes: [markersMovedAlongNote(instance, moved)] }
      : { edits };
  };
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
      return withNotes([...gate.edits, ...controlEdits]);
    }
    case "edits":
      return withNotes([...plan.edits, ...controlEdits]);
  }
}
