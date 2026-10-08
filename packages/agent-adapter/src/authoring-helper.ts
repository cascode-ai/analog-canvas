import { agentRazaviAuthoringCatalog } from "./agent-authoring-catalog.generated.js";
import {
  AgentAuthoringCommandSchema,
  isBatchableAuthoringCommand,
  type AgentAuthoringCommand,
} from "./authoring-command.js";
import {
  AgentSchematicEditSchema,
  AgentWireIntentSchema,
  type AgentSemanticIntent,
  type AgentSessionSnapshot,
} from "./schema.js";
import {
  canonicalParameterValues,
  instanceParameterContract,
  milliScaleReading,
  quantityForms,
  subcircuitDescriptor,
  validateDeviceParameters,
} from "@icm/devices";
import {
  InstancePlacementRequestSchema,
  reflectOrientation,
  SignalFlowParametersSchema,
  type Orientation,
  type RichTextDocument,
} from "@icm/model";
import { z } from "zod";
import {
  AuthoringActionSchema,
  type AuthoringAction,
  type ConnectTarget,
  type ObjectRef,
} from "./authoring-actions.js";

export type SchematicEdit = z.infer<typeof AgentSchematicEditSchema>;
export type WireIntent = z.infer<typeof AgentWireIntentSchema>;

type ActionOfKind<K extends AuthoringAction["kind"]> = Extract<
  AuthoringAction,
  { kind: K }
>;

/**
 * One server transaction produced by compilation. `transact` accepts exactly
 * one form per request, so mixed action batches compile into an ordered
 * sequence; each element is atomic on its own.
 */
export interface CompiledTransaction {
  form: "edits" | "wire-intent" | "command" | "semantic";
  command?: AgentAuthoringCommand;
  semanticIntent?: AgentSemanticIntent;
  edits?: SchematicEdit[];
  /** Input action index for each compiled primitive edit, in the same order. */
  editActionIndices?: number[];
  /** Every input action this transaction carries, ascending. */
  actionIndices?: number[];
  wireIntent?: WireIntent;
  actionKinds: string[];
}

export interface CompileContext {
  snapshot: AgentSessionSnapshot;
  /** Allocates a fresh non-colliding object ID for a given prefix. */
  allocateId: (prefix: string) => string;
  /** Maximum edits per single transaction (from capabilities limits). */
  maxEditsPerTransaction?: number;
}

/** One call's share of an action list that compiles to several transactions. */
export interface ActionCall {
  actionIndices: number[];
  actionKinds: string[];
  sends:
    | "command"
    | "commands"
    | "edit batch"
    | "placement batch"
    | "delete batch"
    | "wires"
    | "focus";
}

/**
 * How to send an action list that compiles to several transactions: one call
 * per transaction, except that neighbouring wires, and neighbouring commands
 * that batch, still share a call. The order is the input order, and it
 * matters: a later call may build on what an earlier one made.
 */
export function splitIntoCalls(
  compiled: readonly CompiledTransaction[],
): ActionCall[] {
  const calls: ActionCall[] = [];
  let joined = 0;
  for (const transaction of compiled) {
    const kinds = transaction.actionKinds;
    const sends: ActionCall["sends"] =
      transaction.form === "wire-intent"
        ? "wires"
        : transaction.form === "semantic"
          ? "focus"
          : transaction.form === "edits"
            ? "edit batch"
            : transaction.command?.kind === "place-components" &&
                kinds.every((kind) => kind === "place-component")
              ? "placement batch"
              : transaction.command?.kind === "delete-selection" &&
                  kinds.every((kind) => kind === "delete")
                ? "delete batch"
                : transaction.command &&
                    isBatchableAuthoringCommand(transaction.command)
                  ? "commands"
                  : "command";
    const last = calls.at(-1);
    if (
      last &&
      last.sends === sends &&
      (sends === "wires" || sends === "commands") &&
      joined < 64
    ) {
      last.actionIndices.push(...(transaction.actionIndices ?? []));
      for (const kind of kinds)
        if (!last.actionKinds.includes(kind)) last.actionKinds.push(kind);
      joined += 1;
      continue;
    }
    calls.push({
      actionIndices: [...(transaction.actionIndices ?? [])],
      actionKinds: [...new Set(kinds)],
      sends,
    });
    joined = 1;
  }
  return calls;
}

/** "actions[0]", "actions[1..7]", "actions[2, 4..5]". */
function actionRange(indices: readonly number[]): string {
  const parts: string[] = [];
  for (let start = 0; start < indices.length;) {
    let end = start;
    while (end + 1 < indices.length && indices[end + 1] === indices[end]! + 1)
      end += 1;
    parts.push(
      end === start
        ? `${indices[start]}`
        : `${indices[start]}..${indices[end]}`,
    );
    start = end + 1;
  }
  return `actions[${parts.join(", ")}]`;
}

/** The refusal message for a list that needs several calls. */
export function describeCallSplit(calls: readonly ActionCall[]): string {
  const sends: Record<ActionCall["sends"], string> = {
    command: "a command of its own",
    commands: "commands that share one call",
    "edit batch": "one edit batch",
    "placement batch": "one placement batch",
    "delete batch": "one delete batch",
    wires: "wires that share one call",
    focus: "a focus operation",
  };
  return (
    `These actions need ${calls.length} calls; one call sends one ` +
    `transaction. Send them in this order, each group in its own call: ` +
    calls
      .map(
        (call) =>
          `${actionRange(call.actionIndices)} (${call.actionKinds.join(", ")}) ` +
          `as ${sends[call.sends]}`,
      )
      .join("; ") +
    ". Nothing was changed."
  );
}

export class ActionCompileError extends Error {
  readonly index: number;
  readonly actionKind: string;

  constructor(index: number, actionKind: string, message: string) {
    super(`actions[${index}] (${actionKind}): ${message}`);
    this.name = "ActionCompileError";
    this.index = index;
    this.actionKind = actionKind;
  }
}

interface SnapshotInstance {
  id: string;
  reference: string | null;
  /** A Cell Pin marker's name, which a Reference target names it by. */
  cellPinName?: string;
  symbolId: string;
  placed: boolean;
  position: { x: number; y: number } | undefined;
  orientation: Orientation | undefined;
  pins: readonly {
    name: string;
    connection: {
      contactPoint: { x: number; y: number };
      gridLanding: { x: number; y: number };
    } | null;
  }[];
  netlist?: {
    binding?: Record<string, unknown>;
    parameters: Record<string, string>;
    terminalMapping?: { sourcePosition: number; pinName: string }[];
  };
  signalFlowParameters?: z.infer<typeof SignalFlowParametersSchema>;
}

interface ResolvedDocument {
  /** The placement grid every Instance origin sits on. */
  grid: number;
  cellTerminalInstanceIds: Set<string>;
  instances: SnapshotInstance[];
  /**
   * Parts placed by earlier actions of the list, for later ones to name
   * (#1515): their pins as the catalog gives them, with no geometry yet.
   */
  listed: SnapshotInstance[];
  nets: {
    id: string;
    name: string | null;
    scope: string;
    powerDomain: string;
    terminals: { instanceId: string; pinName: string }[];
    routeIds: string[];
    junctionIds: string[];
  }[];
  routes: {
    id: string;
    netId: string;
    legs: { id: string }[];
    polyline: { x: number; y: number }[] | null;
  }[];
  junctions: {
    id: string;
    netId: string;
    position: { x: number; y: number };
  }[];
  annotations: Record<string, unknown>[];
  noConnects: {
    id: string;
    endpoint: { instanceId: string; pinName: string };
  }[];
  drafting: { object: Record<string, unknown>; id: string }[];
}

function resolvedDocument(snapshot: AgentSessionSnapshot): ResolvedDocument {
  const document = snapshot.document;
  return {
    grid: document.presentation.grid,
    cellTerminalInstanceIds: new Set(
      (document.cellInterface?.terminals ?? []).flatMap(
        (terminal) => terminal.interfaceInstanceIds,
      ),
    ),
    instances: document.instances.map((instance) => ({
      id: instance.id,
      reference: instance.reference,
      ...(instance.cellTerminal
        ? { cellPinName: instance.cellTerminal.name }
        : {}),
      symbolId: instance.symbolId,
      placed: instance.placement !== null,
      position: instance.placement?.position,
      orientation: instance.placement
        ? {
            rotation: instance.placement.rotation,
            mirror: instance.placement.mirror,
          }
        : undefined,
      pins: instance.pins.map((pin) => ({
        name: pin.name,
        connection: pin.connection,
      })),
      ...(instance.signalFlowParameters
        ? { signalFlowParameters: instance.signalFlowParameters }
        : {}),
      ...(instance.netlist
        ? {
            netlist: {
              ...(instance.netlist.binding
                ? {
                    binding: instance.netlist.binding as Record<
                      string,
                      unknown
                    >,
                  }
                : {}),
              parameters: instance.netlist.parameters,
              ...(instance.netlist.terminalMapping
                ? { terminalMapping: instance.netlist.terminalMapping }
                : {}),
            },
          }
        : {}),
    })),
    listed: [],
    nets: document.nets.map((net) => ({
      id: net.id,
      name: net.name,
      scope: net.scope,
      powerDomain: net.powerDomain,
      terminals: net.terminals,
      routeIds: net.routeIds,
      junctionIds: net.junctionIds,
    })),
    routes: document.routes.map((route) => ({
      id: route.id,
      netId: route.netId,
      legs: route.legs.map((leg) => ({ id: leg.id })),
      polyline: route.polyline,
    })),
    junctions: document.junctions.map((junction) => ({
      id: junction.id,
      netId: junction.netId,
      position: junction.position,
    })),
    annotations: document.annotations as unknown as Record<string, unknown>[],
    noConnects: document.noConnects.map((noConnect) => ({
      id: noConnect.id,
      endpoint: noConnect.endpoint,
    })),
    drafting: document.drafting.objects.map((entry) => ({
      object: entry.object as unknown as Record<string, unknown>,
      id: entry.object.id,
    })),
  };
}

function existingIds(document: ResolvedDocument): Set<string> {
  return new Set([
    ...document.instances.map((i) => i.id),
    ...document.nets.map((n) => n.id),
    ...document.routes.map((r) => r.id),
    ...document.junctions.map((j) => j.id),
    ...document.annotations.map((a) => String(a.id)),
    ...document.noConnects.map((n) => n.id),
    ...document.drafting.map((d) => d.id),
  ]);
}

/**
 * The part a Reference (or a Cell Pin's name) names, in the Document or
 * placed earlier in the list. A name several parts share, as every VDD
 * marker's is, is refused with their IDs rather than taken to mean the
 * first (#1515).
 */
function instanceNamed(
  document: ResolvedDocument,
  index: number,
  kind: string,
  name: string,
): SnapshotInstance | undefined {
  const named = [...document.instances, ...document.listed].filter(
    (instance) => (instance.reference ?? instance.cellPinName) === name,
  );
  if (named.length > 1)
    throw new ActionCompileError(
      index,
      kind,
      `"${name}" names ${named.length} parts (${named.map((instance) => instance.id).join(", ")}); name one by {kind:"instance", id}`,
    );
  return named[0];
}

function resolveInstance(
  document: ResolvedDocument,
  index: number,
  kind: string,
  ref: ObjectRef,
): SnapshotInstance {
  if (ref.kind !== "instance") {
    throw new ActionCompileError(index, kind, "expected an instance reference");
  }
  const found = ref.id
    ? [...document.instances, ...document.listed].find(
        (instance) => instance.id === ref.id,
      )
    : instanceNamed(document, index, kind, ref.reference ?? "");
  if (!found) {
    throw new ActionCompileError(
      index,
      kind,
      `no instance matches ${ref.id ? `id "${ref.id}"` : `Reference "${ref.reference ?? ""}"`}`,
    );
  }
  return found;
}

function resolveNet(
  document: ResolvedDocument,
  index: number,
  kind: string,
  ref: ObjectRef,
): ResolvedDocument["nets"][number] {
  if (ref.kind !== "net") {
    throw new ActionCompileError(index, kind, "expected a net reference");
  }
  const found = ref.id
    ? document.nets.find((net) => net.id === ref.id)
    : document.nets.find((net) => net.name !== null && net.name === ref.name);
  if (!found) {
    throw new ActionCompileError(
      index,
      kind,
      `no net matches ${ref.id ? `id "${ref.id}"` : `name "${ref.name}"`}`,
    );
  }
  return found;
}

function requirePin(
  index: number,
  kind: string,
  instance: SnapshotInstance,
  pin: string,
): void {
  if (!instance.pins.some((candidate) => candidate.name === pin)) {
    // Netlists name a block's ports, not its pins: an op-amp's IN+ is VIP
    // in `.subckt opamp VDD VSS VIP VIN VOUT`, so VIP is a natural mistake.
    const port = subcircuitDescriptor(instance.symbolId)?.ports.find(
      (candidate) => candidate.name === pin && candidate.pinName,
    );
    throw new ActionCompileError(
      index,
      kind,
      `instance "${instance.reference ?? instance.id}" has no pin "${pin}"; snapshot pins: ${instance.pins
        .map((candidate) => candidate.name)
        .join(
          ", ",
        )}${port?.pinName ? ` (${pin} is the exported port name; use pin "${port.pinName}")` : ""}`,
    );
  }
}

function terminalEndpoint(
  instance: SnapshotInstance,
  pin: string,
): {
  kind: "terminal";
  instanceId: string;
  pinName: string;
} {
  return { kind: "terminal", instanceId: instance.id, pinName: pin };
}

function richText(value: string | RichTextDocument): RichTextDocument {
  return typeof value === "string"
    ? { runs: [{ kind: "text", value }] }
    : value;
}

interface NamedId {
  id: string;
}

function resolveByIdOrName<T extends NamedId>(
  index: number,
  kind: string,
  what: string,
  items: readonly T[],
  ref: { id?: string | undefined; name?: string | undefined },
): T {
  const found = ref.id
    ? items.find((item) => item.id === ref.id)
    : items.find(
        (item) =>
          item.id === ref.name ||
          ("name" in item && (item as { name?: string }).name === ref.name),
      );
  if (!found) {
    throw new ActionCompileError(
      index,
      kind,
      `no ${what} matches ${ref.id ? `id "${ref.id}"` : `"${ref.name}"`}`,
    );
  }
  return found;
}

/**
 * Compile a batch of high-level actions against one Snapshot into an ordered
 * list of server transactions. The compiler only resolves names/geometry and
 * allocates IDs; it never invents electrical facts. Anything the mapped typed
 * edit cannot express is a hard error pointing at the advanced path.
 */
/**
 * The native form of a place-cell, set-model, set-display-alias or
 * apply-label-preset written in the friendlier form, where reaching it needs
 * no Snapshot (#1301): a Cell instance named and turned upright, targets
 * given by ID. A target given by Reference is left for compileActions to
 * resolve.
 */
export function nativeForm(
  action: AuthoringAction,
  allocateId: (prefix: string) => string,
): AuthoringAction {
  switch (action.kind) {
    case "place-cell":
      return {
        ...action,
        instanceId: action.instanceId ?? allocateId("instance"),
        placement: {
          ...action.placement,
          rotation: action.placement.rotation ?? 0,
          mirror: action.placement.mirror ?? "none",
        },
      };
    case "set-model":
    case "set-display-alias": {
      if (action.instanceId !== undefined || action.target?.id === undefined)
        return action;
      const { target, ...rest } = action;
      return { ...rest, instanceId: target.id };
    }
    case "apply-label-preset": {
      const { targets, ...rest } = action;
      const ids = targets?.map((target) => target.id);
      if (!ids?.every((id): id is string => id !== undefined)) return action;
      return { ...rest, instanceIds: ids };
    }
    default:
      return action;
  }
}

export function compileActions(
  actions: readonly unknown[],
  context: CompileContext,
): CompiledTransaction[] {
  const parsed = z.array(AuthoringActionSchema).safeParse(actions);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ActionCompileError(
      Number(issue?.path[0] ?? 0) || 0,
      "schema",
      issue ? `${issue.path.join(".")}: ${issue.message}` : "invalid action",
    );
  }
  const document = resolvedDocument(context.snapshot);
  const usedIds = existingIds(document);
  const maxEdits = context.maxEditsPerTransaction ?? 64;
  const allocateId = (prefix: string): string => {
    const id = context.allocateId(prefix);
    if (usedIds.has(id)) {
      throw new ActionCompileError(
        -1,
        "id-allocation",
        `allocated ID "${id}" collides with an existing object`,
      );
    }
    usedIds.add(id);
    return id;
  };
  /** An ID the caller chose, refused if an object already holds it. */
  const claimId = (index: number, kind: string, id: string): string => {
    if (usedIds.has(id))
      throw new ActionCompileError(
        index,
        kind,
        `ID "${id}" is already taken; choose another, or leave id out for a new one`,
      );
    usedIds.add(id);
    return id;
  };

  const transactions: CompiledTransaction[] = [];
  const openEdits = (
    kind: string,
  ): {
    edits: SchematicEdit[];
    actionKinds: string[];
    editActionIndices: number[];
  } => {
    const last = transactions[transactions.length - 1];
    if (
      last &&
      last.form === "edits" &&
      last.edits &&
      last.editActionIndices &&
      last.edits.length < maxEdits &&
      (kind === "place-component") ===
        last.actionKinds.every((item) => item === "place-component") &&
      (kind === "delete") ===
        last.actionKinds.every((item) => item === "delete")
    ) {
      return {
        edits: last.edits,
        actionKinds: last.actionKinds,
        editActionIndices: last.editActionIndices,
      };
    }
    const entry = {
      edits: [] as SchematicEdit[],
      actionKinds: [] as string[],
      editActionIndices: [] as number[],
    };
    transactions.push({
      form: "edits",
      edits: entry.edits,
      actionKinds: entry.actionKinds,
      editActionIndices: entry.editActionIndices,
    });
    return entry;
  };
  /** A typed edit, as a No Connect mark is. */
  const pushEdit = (index: number, kind: string, edit: unknown): void => {
    const validated = AgentSchematicEditSchema.safeParse(edit);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new ActionCompileError(
        index,
        kind,
        `compiled edit failed contract validation: ${issue?.path.join(".")} ${issue?.message ?? ""}`.trim(),
      );
    }
    const slot = openEdits(kind);
    slot.edits.push(validated.data as SchematicEdit);
    slot.actionKinds.push(kind);
    slot.editActionIndices.push(index);
  };
  /** A placement request: always repacked into place-components, where an
   * omitted Reference takes the next free name. */
  const pushPlacement = (index: number, kind: string, instance: unknown) => {
    const validated = InstancePlacementRequestSchema.safeParse(instance);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new ActionCompileError(
        index,
        kind,
        `compiled placement failed contract validation: ${issue?.path.join(".")} ${issue?.message ?? ""}`.trim(),
      );
    }
    const slot = openEdits(kind);
    slot.edits.push({
      kind: "add_instance",
      instance: validated.data,
    } as SchematicEdit);
    slot.actionKinds.push(kind);
    slot.editActionIndices.push(index);
  };
  const pushWireIntent = (
    index: number,
    kind: string,
    intent: unknown,
  ): void => {
    const validated = AgentWireIntentSchema.safeParse(intent);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new ActionCompileError(
        index,
        kind,
        `compiled wire intent failed contract validation: ${issue?.message}`,
      );
    }
    transactions.push({
      form: "wire-intent",
      wireIntent: validated.data as WireIntent,
      actionKinds: [kind],
    });
  };

  // The action being compiled: every command it sends is reported under it.
  let actionIndex = 0;
  let actionKind = "";
  const pushCommand = (command: AgentAuthoringCommand): void => {
    const validated = AgentAuthoringCommandSchema.safeParse(command);
    if (!validated.success) {
      const issue = validated.error.issues[0];
      throw new ActionCompileError(
        actionIndex,
        actionKind,
        `${issue?.path.join(".")} ${issue?.message ?? ""}`.trim(),
      );
    }
    transactions.push({
      form: "command",
      command: validated.data,
      actionKinds: [actionKind],
    });
  };
  /** Properties, as Apply in Properties changes them: the editor plans it. */
  const pushProperties = (
    instance: SnapshotInstance,
    change: Omit<
      Extract<AgentAuthoringCommand, { kind: "set-properties" }>,
      "kind" | "instanceId"
    >,
  ): void =>
    pushCommand({ kind: "set-properties", instanceId: instance.id, ...change });
  /** Deletions in a row are one selection, deleted at once as in the GUI. */
  const pushDelete = (part: Partial<DeleteSelection>): void => {
    const last = transactions[transactions.length - 1];
    if (
      last?.form === "command" &&
      last.command?.kind === "delete-selection" &&
      last.editActionIndices
    ) {
      const selection = last.command.selection;
      for (const key of Object.keys(part) as (keyof DeleteSelection)[])
        for (const id of part[key] ?? [])
          if (!selection[key].includes(id)) selection[key].push(id);
      last.actionKinds.push(actionKind);
      last.editActionIndices.push(actionIndex);
      return;
    }
    transactions.push({
      form: "command",
      command: {
        kind: "delete-selection",
        selection: {
          instanceIds: [...(part.instanceIds ?? [])],
          routeIds: [...(part.routeIds ?? [])],
          junctionIds: [...(part.junctionIds ?? [])],
          annotationIds: [...(part.annotationIds ?? [])],
          draftingIds: [...(part.draftingIds ?? [])],
          noConnectIds: [...(part.noConnectIds ?? [])],
        },
      },
      actionKinds: [actionKind],
      editActionIndices: [actionIndex],
    });
  };

  const createdBy = new Map<CompiledTransaction, number>();
  parsed.data.forEach((action, index) => {
    const before = transactions.length;
    actionIndex = index;
    actionKind = action.kind;
    switch (action.kind) {
      case "route-net":
      case "set-port-direction":
      case "set-vdd-mode":
      case "set-mos-bulk-default":
      case "delete-selection":
      case "add-power-rail":
      case "extend-power-rail":
      case "move-annotation":
      case "batch":
      case "place-components":
      case "set-instance-display":
      case "arrange-labels":
      case "place-existing":
      case "set-net-label":
      case "transform":
      case "copy":
      case "align":
      case "detach-move":
      case "unplace":
      case "reset-cell":
      case "create-cell":
      case "rename-cell":
      case "delete-cell":
      case "move-junction":
      case "remove-cell-terminal":
      case "rename-cell-terminal":
      case "set-cell-symbol-pins":
      case "bind-cell-parameter":
      case "rename-cell-parameter":
      case "set-cell-parameter-default":
      case "remove-cell-parameter":
      case "set-properties":
      case "set-text":
      case "add-text":
      case "arrange-instances":
      case "disconnect-pin":
        transactions.push({
          form: "command",
          command: action,
          actionKinds: [action.kind],
        });
        break;
      case "place-cell":
      case "set-model":
      case "set-display-alias": {
        let native = nativeForm(action, allocateId);
        if (
          (native.kind === "set-model" ||
            native.kind === "set-display-alias") &&
          native.instanceId === undefined
        ) {
          const { target, ...rest } = native;
          native = {
            ...rest,
            instanceId: resolveInstance(document, index, action.kind, target!)
              .id,
          };
        }
        transactions.push({
          form: "command",
          command: AgentAuthoringCommandSchema.parse(native),
          actionKinds: [action.kind],
        });
        break;
      }
      case "apply-label-preset": {
        const { targets, ...native } = action;
        pushCommand(
          targets
            ? {
                ...native,
                instanceIds: targets.map(
                  (target) =>
                    resolveInstance(document, index, action.kind, target).id,
                ),
              }
            : native,
        );
        break;
      }
      case "focus":
        transactions.push({
          form: "semantic",
          semanticIntent: action.intent,
          actionKinds: [action.kind],
        });
        break;
      case "undo":
      case "redo":
        // History steps go alone: the editor restores one entry per call.
        transactions.push({
          form: "edits",
          edits: [{ kind: action.kind }],
          actionKinds: [action.kind],
        });
        break;
      case "place-component":
        compilePlaceComponent(
          index,
          action,
          document,
          () =>
            action.id === undefined
              ? allocateId("instance")
              : claimId(index, action.kind, action.id),
          pushPlacement,
        );
        break;
      case "connect":
        compileConnect(index, action, document, allocateId, pushWireIntent);
        break;
      case "disconnect":
        if (action.noConnect !== undefined)
          compileNoConnect(index, action, document, pushEdit, allocateId);
        else if (action.target.kind === "pin") {
          const instance = resolveInstance(document, index, action.kind, {
            kind: "instance",
            ...(typeof action.target.instance === "string"
              ? { reference: action.target.instance }
              : action.target.instance),
          });
          requirePin(index, action.kind, instance, action.target.pin);
          pushCommand({
            kind: "disconnect-pin",
            instanceId: instance.id,
            pinName: action.target.pin,
          });
        } else {
          const route = resolveByIdOrName(
            index,
            action.kind,
            "route",
            document.routes,
            { id: action.target.route },
          );
          pushDelete({ routeIds: [route.id] });
        }
        break;
      case "move":
        if (action.target.kind === "annotation") {
          const annotation = resolveByIdOrName(
            index,
            action.kind,
            "annotation",
            document.annotations.map((entry) => ({ id: String(entry.id) })),
            action.target,
          );
          pushCommand({
            kind: "move-annotation",
            annotationId: annotation.id,
            position: action.position!,
          });
        } else if (action.target.kind === "junction") {
          const junction = resolveByIdOrName(
            index,
            action.kind,
            "junction",
            document.junctions,
            action.target,
          );
          pushCommand({
            kind: "move-junction",
            junctionId: junction.id,
            position: action.position!,
          });
        } else {
          const instance = resolveInstance(
            document,
            index,
            action.kind,
            action.target,
          );
          if (action.pinAnchor)
            requirePin(index, action.kind, instance, action.pinAnchor.pinName);
          if (!instance.placed)
            pushCommand({
              kind: "place-existing",
              instanceId: instance.id,
              ...(action.pinAnchor
                ? { pinAnchor: action.pinAnchor }
                : {
                    placement: {
                      position: action.position!,
                      rotation: 0,
                      mirror: "none",
                    },
                  }),
            });
          else
            pushProperties(instance, {
              placement: action.pinAnchor
                ? { pinAnchor: action.pinAnchor }
                : { position: action.position! },
            });
        }
        break;
      case "rotate":
        pushProperties(
          resolveInstance(document, index, action.kind, action.target),
          { placement: { rotation: action.rotation } },
        );
        break;
      case "mirror":
        pushProperties(
          resolveInstance(document, index, action.kind, action.target),
          {
            placement: action.axis
              ? { reflect: action.axis }
              : { mirror: action.mirror! },
          },
        );
        break;
      case "set-orientation":
        pushProperties(
          resolveInstance(document, index, action.kind, action.target),
          {
            placement: {
              ...(action.rotation !== undefined
                ? { rotation: action.rotation }
                : {}),
              ...(action.mirror !== undefined ? { mirror: action.mirror } : {}),
            },
          },
        );
        break;
      case "set-reference":
        pushProperties(
          resolveInstance(document, index, action.kind, action.target),
          { reference: action.reference },
        );
        break;
      case "set-property":
        pushProperties(
          resolveInstance(document, index, action.kind, action.target),
          {
            parameters: {
              ...(action.set ? { set: action.set } : {}),
              ...(action.unset ? { unset: action.unset } : {}),
            },
          },
        );
        break;
      case "set-signal-flow": {
        const { kind: _kind, target, ...signalFlow } = action;
        pushProperties(resolveInstance(document, index, action.kind, target), {
          signalFlow,
        });
        break;
      }
      case "set-block-supply":
        pushProperties(
          resolveInstance(document, index, action.kind, action.target),
          {
            supplies: {
              [action.supply]:
                action.net === null
                  ? null
                  : resolveNet(document, index, action.kind, action.net).id,
            },
          },
        );
        break;
      case "set-source-control":
        pushProperties(
          resolveInstance(document, index, action.kind, action.target),
          { control: action.control },
        );
        break;
      case "add-label":
        pushCommand(compileAddLabel(index, action, document, allocateId));
        break;
      case "edit-text": {
        const id = action.target.id ?? action.target.name ?? "";
        if (action.target.kind === "annotation") {
          const annotation = resolveByIdOrName(
            index,
            action.kind,
            "annotation",
            document.annotations.map((entry) => ({
              id: String(entry.id),
              entry,
            })),
            { id },
          ).entry;
          if (
            annotation.kind === "net-label" ||
            annotation.kind === "power-label"
          ) {
            pushCommand({
              kind: "set-net-label",
              annotationId: String(annotation.id),
              netId: String(annotation.netId),
              text: richText(action.text),
            });
            break;
          }
          pushCommand({
            kind: "set-text",
            target: { kind: "annotation", id: String(annotation.id) },
            text: action.text,
          });
          break;
        }
        const drafting = resolveByIdOrName(
          index,
          action.kind,
          "drafting object",
          document.drafting,
          { id },
        );
        pushCommand({
          kind: "set-text",
          target: { kind: "drafting", id: drafting.id },
          text: action.text,
        });
        break;
      }
      case "annotate":
        pushCommand({
          kind: "add-text",
          id: allocateId("text"),
          position: action.position,
          text: action.text,
          ...(action.alignment ? { alignment: action.alignment } : {}),
          ...(action.rotation !== undefined
            ? { rotation: action.rotation }
            : {}),
        });
        break;
      case "arrange":
        pushCommand({
          kind: "arrange-instances",
          instanceIds: action.instances.map(
            (ref) => resolveInstance(document, index, action.kind, ref).id,
          ),
          axis: action.axis,
          ...(action.coordinate !== undefined
            ? { coordinate: action.coordinate }
            : {}),
        });
        break;
      case "delete":
        pushDelete(resolveDeletion(index, action, document));
        break;
      default: {
        // Every action compiles to something: a kind left out here was once
        // dropped from a mixed call without a word.
        const unhandled: never = action;
        throw new Error(
          `Action kind ${(unhandled as { kind: string }).kind} has no compiler`,
        );
      }
    }
    // Edit batches record their actions edit by edit; every other form is
    // created by exactly one action.
    for (const transaction of transactions.slice(before))
      if (transaction.form !== "edits") createdBy.set(transaction, index);
  });

  return transactions
    .map((transaction): CompiledTransaction => {
      const actionIndices = transaction.editActionIndices
        ? [...new Set(transaction.editActionIndices)]
        : [createdBy.get(transaction)!];
      if (
        transaction.form === "edits" &&
        transaction.actionKinds.every((kind) => kind === "delete") &&
        transaction.edits?.length
      ) {
        const selection = {
          instanceIds: [] as string[],
          routeIds: [] as string[],
          junctionIds: [] as string[],
          annotationIds: [] as string[],
          draftingIds: [] as string[],
          noConnectIds: [] as string[],
        };
        for (const edit of transaction.edits) {
          if (edit.kind === "remove_instance")
            selection.instanceIds.push(edit.instanceId);
          if (edit.kind === "cut_connection")
            selection.routeIds.push(edit.routeId);
          if (edit.kind === "remove_junction")
            selection.junctionIds.push(edit.junctionId);
          if (edit.kind === "remove_schematic_annotation")
            selection.annotationIds.push(edit.annotationId);
          if (edit.kind === "remove_drafting_object")
            selection.draftingIds.push(edit.objectId);
          if (edit.kind === "remove_no_connect")
            selection.noConnectIds.push(edit.noConnectId);
        }
        return {
          form: "command",
          command: { kind: "delete-selection", selection },
          actionKinds: transaction.actionKinds,
          actionIndices,
        };
      }
      if (
        transaction.form === "edits" &&
        transaction.edits &&
        transaction.edits.length > 0 &&
        transaction.actionKinds.every((kind) => kind === "place-component")
      ) {
        return {
          form: "command",
          command: {
            kind: "place-components",
            instances: transaction.edits.flatMap((edit) =>
              edit.kind === "add_instance" ? [edit.instance] : [],
            ),
            terminalDirections: Object.fromEntries(
              transaction.edits.flatMap((edit, index) => {
                const source =
                  parsed.data[transaction.editActionIndices![index]!];
                return edit.kind === "add_instance" &&
                  source?.kind === "place-component" &&
                  source.direction
                  ? [[edit.instance.id, source.direction]]
                  : [];
              }),
            ),
            pinAnchors: Object.fromEntries(
              transaction.edits.flatMap((edit, index) => {
                const source =
                  parsed.data[transaction.editActionIndices![index]!];
                return edit.kind === "add_instance" &&
                  source?.kind === "place-component" &&
                  source.pinAnchor
                  ? [[edit.instance.id, source.pinAnchor]]
                  : [];
              }),
            ),
            ...placementDisplays(
              transaction.edits.flatMap((edit, index) => {
                const source =
                  parsed.data[transaction.editActionIndices![index]!];
                return edit.kind === "add_instance" &&
                  source?.kind === "place-component"
                  ? [{ id: edit.instance.id, source }]
                  : [];
              }),
            ),
          },
          actionKinds: transaction.actionKinds,
          ...(transaction.editActionIndices
            ? { editActionIndices: transaction.editActionIndices }
            : {}),
          actionIndices,
        };
      }
      return { ...transaction, actionIndices };
    })
    .filter(
      (transaction) =>
        transaction.form !== "edits" ||
        (transaction.edits !== undefined && transaction.edits.length > 0),
    );
}

type PushEdit = (index: number, kind: string, edit: unknown) => void;
type PushPlacement = (index: number, kind: string, instance: unknown) => void;
type PushWireIntent = (index: number, kind: string, intent: unknown) => void;
type AllocateId = (prefix: string) => string;

/**
 * The labels each placement asked for, by its new Instance ID, as
 * place-components takes them (#1435); nothing when none asked.
 */
function placementDisplays(
  placements: readonly {
    id: string;
    source: ActionOfKind<"place-component">;
  }[],
): {
  displays?: Record<string, { showReference?: boolean; showValue?: boolean }>;
} {
  const entries = placements.flatMap(({ id, source }) =>
    source.showReference === undefined && source.showValue === undefined
      ? []
      : [
          [
            id,
            {
              ...(source.showReference === undefined
                ? {}
                : { showReference: source.showReference }),
              ...(source.showValue === undefined
                ? {}
                : { showValue: source.showValue }),
            },
          ] as const,
        ],
  );
  return entries.length ? { displays: Object.fromEntries(entries) } : {};
}

function compilePlaceComponent(
  index: number,
  action: ActionOfKind<"place-component">,
  document: ResolvedDocument,
  /** The part's ID: the caller's own, or a new one. */
  newId: () => string,
  pushPlacement: PushPlacement,
): void {
  if (action.symbol === "vdd") {
    throw new ActionCompileError(
      index,
      action.kind,
      "vdd is not a symbol asset; use the add-power-rail action (catalog primitive vdd-rail)",
    );
  }
  const catalogSymbol = agentRazaviAuthoringCatalog.symbols.find(
    (symbol) => symbol.symbolId === action.symbol,
  );
  if (!catalogSymbol) {
    throw new ActionCompileError(
      index,
      action.kind,
      `"${action.symbol}" is not in the reviewed built-in catalog; a custom, imported, or PDK symbol is a human-fact boundary (see analog-canvas://reference/authoring)`,
    );
  }
  const powerMarker = action.symbol === "ground";
  const cellPin = ["port", "port-filled", "vdd-port"].includes(action.symbol);
  if (action.direction && !cellPin)
    throw new ActionCompileError(
      index,
      action.kind,
      "direction is only valid for Cell interface markers",
    );
  if (
    (cellPin || powerMarker) &&
    (action.showReference !== undefined || action.showValue !== undefined)
  )
    throw new ActionCompileError(
      index,
      action.kind,
      "showReference and showValue are for devices; a Cell Pin or ground marker shows its Pin or Net name",
    );
  // A device without a Reference takes the next free one in the editor, as
  // a GUI insert does (#1256); a Port's reference is its name.
  if (
    powerMarker
      ? action.reference !== undefined
      : !action.reference &&
        (action.symbol === "port" || action.symbol === "port-filled")
  ) {
    throw new ActionCompileError(
      index,
      action.kind,
      powerMarker
        ? "Power markers use Net names; omit reference"
        : "A Port needs its name as reference",
    );
  }
  if (action.signalFlow && !catalogSymbol.formula)
    throw new ActionCompileError(
      index,
      action.kind,
      `${action.symbol} draws no formula; signalFlow is for blocks with catalog formula: true`,
    );
  const signalFlow = action.signalFlow
    ? SignalFlowParametersSchema.omit({ formulaFormat: true }).safeParse(
        action.signalFlow,
      )
    : undefined;
  if (signalFlow && !signalFlow.success) {
    const issue = signalFlow.error.issues[0];
    throw new ActionCompileError(
      index,
      action.kind,
      `signalFlow.${issue?.path.join(".")}: ${issue?.message ?? "invalid"}`,
    );
  }
  if (action.signalFlow?.coefficient && !catalogSymbol.coefficient)
    throw new ActionCompileError(
      index,
      action.kind,
      `${action.symbol} draws no coefficient`,
    );
  if (
    !cellPin &&
    action.reference !== undefined &&
    document.instances.some(
      (instance) => instance.reference === action.reference,
    )
  ) {
    throw new ActionCompileError(
      index,
      action.kind,
      `Instance Reference "${action.reference}" already exists in this document`,
    );
  }
  const parameters = validateActionParameters(
    index,
    action.kind,
    { symbolId: action.symbol },
    action.parameters,
  );
  const variant = action.variant ?? catalogSymbol.defaultVariantId ?? undefined;
  const reference =
    action.reference ?? (action.symbol === "vdd-port" ? "VDD" : undefined);
  const mirrored = action.mirrorOf
    ? mirroredPlacement(index, action, document)
    : undefined;
  const id = newId();
  const placement = mirrored ?? {
    position: action.position ?? { x: 0, y: 0 },
    rotation: action.rotation ?? 0,
    mirror: action.mirror ?? "none",
  };
  // Later actions of the list may name it; where a pin anchor puts it is
  // known only once it lands.
  document.listed.push({
    id,
    reference: cellPin ? null : (reference ?? null),
    ...(cellPin && reference ? { cellPinName: reference } : {}),
    symbolId: action.symbol,
    placed: true,
    position: action.pinAnchor ? undefined : placement.position,
    orientation: {
      rotation: placement.rotation,
      mirror: placement.mirror,
    } as Orientation,
    pins: catalogSymbol.pins.map((pin) => ({
      name: pin.name,
      connection: null,
    })),
  });
  pushPlacement(index, action.kind, {
    id,
    symbolId: action.symbol,
    ...(reference ? { reference } : {}),
    ...(variant ? { symbolVariantId: variant } : {}),
    placement,
    // Without parameters or control the editor fills the netlist, catalog
    // defaults and the Process's model, exactly as a GUI insert, and leaves a
    // block that emits nothing without one.
    ...(!powerMarker && (parameters || action.control)
      ? {
          netlist: {
            parameters: parameters ?? {},
            ...(action.control ? { control: action.control } : {}),
          },
        }
      : {}),
    ...(signalFlow?.success ? { signalFlowParameters: signalFlow.data } : {}),
  });
}

/**
 * Where a part goes as the mirror image of a placed one about a vertical
 * (x) or horizontal (y) line: the origin reflected, the mirror toggled on
 * that axis and the rotation kept, which reflects every drawn point exactly
 * (#1112). An origin off the placement grid is refused with the half-grid
 * rule rather than silently moved.
 */
function mirroredPlacement(
  index: number,
  action: ActionOfKind<"place-component">,
  document: ResolvedDocument,
): { position: { x: number; y: number }; rotation: number; mirror: string } {
  const of = action.mirrorOf!;
  if ((of.x === undefined) === (of.y === undefined))
    throw new ActionCompileError(
      index,
      action.kind,
      "mirrorOf takes exactly one axis: x (a vertical line) or y (a horizontal line)",
    );
  if (action.rotation !== undefined || action.mirror !== undefined)
    throw new ActionCompileError(
      index,
      action.kind,
      "mirrorOf takes rotation and mirror from the part it reflects; omit them",
    );
  const source =
    instanceNamed(document, index, action.kind, of.instance) ??
    [...document.instances, ...document.listed].find(
      (instance) => instance.id === of.instance,
    );
  if (!source?.position || !source.orientation)
    throw new ActionCompileError(
      index,
      action.kind,
      !source
        ? `no part ${of.instance} to mirror`
        : source.placed
          ? `${of.instance} lands by its pin anchor in this list; mirror it in a later call`
          : `${of.instance} is not placed yet; place it before mirroring it`,
    );
  const position =
    of.x !== undefined
      ? { x: 2 * of.x - source.position.x, y: source.position.y }
      : { x: source.position.x, y: 2 * of.y! - source.position.y };
  const grid = document.grid;
  if (position.x % grid !== 0 || position.y % grid !== 0)
    throw new ActionCompileError(
      index,
      action.kind,
      `${of.instance} mirrored about ${of.x !== undefined ? `x = ${of.x}` : `y = ${of.y}`} lands at (${position.x}, ${position.y}), off placement grid ${grid}; use an axis on a multiple of ${grid / 2}`,
    );
  const orientation = reflectOrientation(
    source.orientation,
    of.x !== undefined ? "left-right" : "top-bottom",
  );
  return { position, ...orientation };
}

/**
 * The parameters as the part stores them, once its model takes them: a
 * choice typed in another spelling it accepts, such as the Unicode minus for
 * an adder's `-`, becomes the choice. Throws the first refusal.
 */
function validateActionParameters(
  index: number,
  kind: string,
  owner: Parameters<typeof instanceParameterContract>[1],
  parameters: Readonly<Record<string, string>> | undefined,
  externalSubcircuitDefinitions?: Parameters<
    typeof instanceParameterContract
  >[0]["externalSubcircuitDefinitions"],
): Readonly<Record<string, string>> | undefined {
  if (!parameters) return undefined;
  // The parameters the part's model owns, as export reads them: a part bound
  // to a reviewed SKY130 model takes that model's (a resistor's w, l, mult).
  // Custom and imported symbols outside the registry deliberately remain a
  // human-fact boundary; their contracts are unavailable to this client.
  const contract = instanceParameterContract(
    externalSubcircuitDefinitions ? { externalSubcircuitDefinitions } : {},
    owner,
  );
  if (!contract) return parameters;
  const symbolId = owner.symbolId;
  const issues = validateDeviceParameters(
    { parameters: contract.definitions },
    parameters,
    { open: contract.open },
  );
  if (!issues.length)
    return canonicalParameterValues(
      { parameters: contract.definitions },
      parameters,
    );
  const issue = issues[0]!;
  const allowed = contract.definitions.map((parameter) => parameter.name);
  const allowedText = allowed.length ? allowed.join(", ") : "(none)";
  // A SPICE number still, but one that reads as milli where mega was meant.
  const milli =
    issue.kind === "number" ? milliScaleReading(issue.value) : undefined;
  const message =
    issue.kind === "unknown"
      ? 'Unknown parameter "' +
        issue.name +
        '" for ' +
        symbolId +
        (issue.suggestion ? '; did you mean "' + issue.suggestion + '"?' : "") +
        "; allowed parameters: " +
        allowedText
      : issue.kind === "number"
        ? milli
          ? 'Parameter "' +
            issue.name +
            '" is "' +
            issue.value +
            '", which ' +
            milli
          : 'Parameter "' +
            issue.name +
            '" must be ' +
            quantityForms(issue) +
            '; received "' +
            issue.value +
            '"' +
            (/[µμ]/u.test(issue.value) ? " (SPICE writes micro as u)" : "")
        : issue.kind === "duplicate"
          ? 'Parameter "' +
            issue.name +
            '" duplicates "' +
            issue.previousName +
            '" under case folding'
          : issue.kind === "select"
            ? 'Parameter "' +
              issue.name +
              '" must be one of: ' +
              issue.allowed.join(", ") +
              '; received "' +
              issue.value +
              '"'
            : 'Parameter "' +
              issue.name +
              '" must be a finite decimal number; received "' +
              issue.value +
              '"';
  throw new ActionCompileError(index, kind, message);
}

/** Explicit endpoints need no client-side topology read. The existing server
 * planner still validates pins, geometry, locks and revision atomically. */
export function directConnectIntent(
  action: AuthoringAction,
  allocateId: AllocateId,
): WireIntent | undefined {
  if (action.kind !== "connect") return undefined;
  const anchor = (target: ConnectTarget): WireIntent["from"] | undefined => {
    if (target.kind === "wire-at" || target.kind === "net") return target;
    if (target.kind === "route-segment") return target;
    if (target.kind === "point")
      return { kind: "free", point: { x: target.x, y: target.y } };
    if (target.kind === "junction")
      return {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: target.junction },
      };
    if (
      target.kind === "pin" &&
      typeof target.instance !== "string" &&
      target.instance.id
    )
      return {
        kind: "endpoint",
        endpoint: {
          kind: "terminal",
          instanceId: target.instance.id,
          pinName: target.pin,
        },
      };
    return undefined;
  };
  const from = anchor(action.from),
    to = anchor(action.to);
  return from && to ? connectIntent(action, from, to, allocateId) : undefined;
}

function connectIntent(
  action: ActionOfKind<"connect">,
  from: unknown,
  to: unknown,
  allocateId: AllocateId,
): WireIntent {
  return AgentWireIntentSchema.parse({
    id: allocateId("wire"),
    from,
    to,
    ...(action.via ? { waypoints: action.via } : {}),
    ...(action.routingMode ? { routingMode: action.routingMode } : {}),
    ...(action.cornerOrder ? { cornerOrder: action.cornerOrder } : {}),
  });
}

function compileConnect(
  index: number,
  action: ActionOfKind<"connect">,
  document: ResolvedDocument,
  allocateId: AllocateId,
  pushWireIntent: PushWireIntent,
): void {
  const { from, to } = action;

  if (from.kind === "net" && to.kind === "net") {
    throw new ActionCompileError(
      index,
      action.kind,
      "connecting two nets is a Net merge; use advanced_transact with merge_nets after reading the contract resource",
    );
  }

  // Every normal connection routes through one wireIntent. In particular,
  // pin-to-pin must create visible Route geometry rather than only adding the
  // two terminals to a logical Net.

  const anchorFor = (target: ConnectTarget): Record<string, unknown> => {
    if (target.kind === "wire-at" || target.kind === "net") return target;
    if (target.kind === "route-segment") return target;
    if (target.kind === "pin") {
      const instance = resolveInstance(document, index, action.kind, {
        kind: "instance",
        ...(typeof target.instance === "string"
          ? { reference: target.instance }
          : target.instance),
      });
      requirePin(index, action.kind, instance, target.pin);
      return {
        kind: "endpoint",
        endpoint: terminalEndpoint(instance, target.pin),
      };
    }
    if (target.kind === "point") {
      return {
        kind: "free",
        point: { x: target.x, y: target.y },
      };
    }
    if (target.kind === "junction") {
      const junction = resolveByIdOrName(
        index,
        action.kind,
        "junction",
        document.junctions,
        { id: target.junction },
      );
      return {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: junction.id },
      };
    }
    return target;
  };

  pushWireIntent(
    index,
    action.kind,
    connectIntent(action, anchorFor(from), anchorFor(to), allocateId),
  );
}

/**
 * A disconnect with noConnect marks or clears a pin's No Connect, as the
 * GUI's toggle does (#1305). An unused QBAR blocked a PFD's netlist, and
 * the Agent's only way to mark it was an advanced edit with an ID it had to
 * invent. Marking a wired pin disconnects it first: the Agent asked to.
 */
function compileNoConnect(
  index: number,
  action: ActionOfKind<"disconnect">,
  document: ResolvedDocument,
  pushEdit: PushEdit,
  allocateId: AllocateId,
): void {
  const target = action.target;
  if (target.kind !== "pin")
    throw new ActionCompileError(
      index,
      action.kind,
      "noConnect applies to a pin target, not a route",
    );
  const instance = resolveInstance(document, index, action.kind, {
    kind: "instance",
    ...(typeof target.instance === "string"
      ? { reference: target.instance }
      : target.instance),
  });
  const pinName = target.pin;
  requirePin(index, action.kind, instance, pinName);
  if (pinName === "P" && document.cellTerminalInstanceIds.has(instance.id))
    throw new ActionCompileError(
      index,
      action.kind,
      "A formal Cell Pin's P pin is its Net's connection, never No Connect; use remove-cell-terminal or delete-selection instead",
    );
  const name = `${instance.reference ?? instance.id}.${pinName}`;
  const marked = document.noConnects.find(
    (noConnect) =>
      noConnect.endpoint.instanceId === instance.id &&
      noConnect.endpoint.pinName === pinName,
  );
  if (!action.noConnect) {
    if (!marked)
      throw new ActionCompileError(
        index,
        action.kind,
        `pin ${name} has no No Connect mark`,
      );
    pushEdit(index, action.kind, {
      kind: "remove_no_connect",
      noConnectId: marked.id,
    });
    return;
  }
  if (marked)
    throw new ActionCompileError(
      index,
      action.kind,
      `pin ${name} is already marked No Connect`,
    );
  const wired = document.nets.some((candidate) =>
    candidate.terminals.some(
      (terminal) =>
        terminal.instanceId === instance.id && terminal.pinName === pinName,
    ),
  );
  if (wired)
    pushEdit(index, action.kind, {
      kind: "disconnect_endpoint",
      endpoint: terminalEndpoint(instance, pinName),
    });
  pushEdit(index, action.kind, {
    kind: "add_no_connect",
    noConnect: {
      id: allocateId("no-connect"),
      endpoint: terminalEndpoint(instance, pinName),
    },
  });
}

/**
 * The Net of an add-label's pin target, and a point on the wire leaving that
 * pin for the label to stand over. Naming a bias gate's stub once took a
 * Snapshot read just to learn the new stub's Net.
 */
function pinNet(
  index: number,
  action: ActionOfKind<"add-label">,
  document: ResolvedDocument,
): {
  net: ResolvedDocument["nets"][number];
  position: { x: number; y: number } | undefined;
} {
  const target = action.target;
  if (target.kind !== "pin")
    throw new ActionCompileError(index, action.kind, "expected a pin target");
  const instance = resolveInstance(document, index, action.kind, {
    kind: "instance",
    ...(typeof target.instance === "string"
      ? { reference: target.instance }
      : target.instance),
  });
  requirePin(index, action.kind, instance, target.pin);
  const net = document.nets.find((candidate) =>
    candidate.terminals.some(
      (terminal) =>
        terminal.instanceId === instance.id && terminal.pinName === target.pin,
    ),
  );
  if (!net)
    throw new ActionCompileError(
      index,
      action.kind,
      `pin ${instance.reference ?? instance.id}.${target.pin} is on no Net yet; connect it first, for example to a {kind:"point"} a grid step or two out`,
    );
  const connection = instance.pins.find(
    (pin) => pin.name === target.pin,
  )?.connection;
  const atPin = (point: { x: number; y: number }) =>
    !!connection &&
    [connection.contactPoint, connection.gridLanding].some(
      (end) => end.x === point.x && end.y === point.y,
    );
  for (const routeId of net.routeIds) {
    const line = document.routes.find(
      (route) => route.id === routeId,
    )?.polyline;
    if (!line || line.length < 2) continue;
    const [from, to] = atPin(line[0]!)
      ? [line[0]!, line[1]!]
      : atPin(line.at(-1)!)
        ? [line.at(-1)!, line.at(-2)!]
        : [];
    if (from && to)
      return {
        net,
        position: {
          x: Math.round((from.x + to.x) / 2),
          y: Math.round((from.y + to.y) / 2),
        },
      };
  }
  return {
    net,
    position: connection ? { ...connection.gridLanding } : undefined,
  };
}

function compileAddLabel(
  index: number,
  action: ActionOfKind<"add-label">,
  document: ResolvedDocument,
  allocateId: AllocateId,
): Extract<
  import("@icm/agent-adapter").AgentAuthoringCommand,
  { kind: "set-net-label" }
> {
  const target = action.target;
  const atPin = target.kind === "pin" ? pinNet(index, action, document) : null;
  const net =
    atPin?.net ??
    resolveNet(document, index, action.kind, {
      kind: "net",
      ...(target.kind === "net" && target.name ? { name: target.name } : {}),
      ...(target.kind === "net" && target.id ? { id: target.id } : {}),
    });
  let position = action.position ?? atPin?.position;
  if (!position) {
    const route = net.routeIds
      .map((routeId) =>
        document.routes.find((candidate) => candidate.id === routeId),
      )
      .find(
        (candidate) => candidate?.polyline && candidate.polyline.length >= 2,
      );
    if (route?.polyline) {
      const polyline = route.polyline;
      const middle = polyline[Math.floor(polyline.length / 2)]!;
      position = { x: middle.x, y: middle.y - 20 };
    } else {
      const terminal = net.terminals[0];
      const instance = terminal
        ? document.instances.find(
            (candidate) => candidate.id === terminal.instanceId,
          )
        : undefined;
      const pin = instance?.pins.find(
        (candidate) => terminal && candidate.name === terminal.pinName,
      );
      if (pin?.connection) {
        position = {
          x: pin.connection.gridLanding.x,
          y: pin.connection.gridLanding.y - 20,
        };
      }
    }
  }
  if (!position) {
    throw new ActionCompileError(
      index,
      action.kind,
      `net "${net.name ?? net.id}" has no geometry to anchor a label; provide position`,
    );
  }
  return {
    kind: "set-net-label",
    annotationId: allocateId("label"),
    netId: net.id,
    text: richText(action.text),
    position,
  };
}

type DeleteSelection = Extract<
  AgentAuthoringCommand,
  { kind: "delete-selection" }
>["selection"];

/** The object a delete action names, as a selection to delete. */
function resolveDeletion(
  index: number,
  action: ActionOfKind<"delete">,
  document: ResolvedDocument,
): Partial<DeleteSelection> {
  const reference =
    action.target.id ??
    (action.target.kind === "instance"
      ? action.target.reference
      : action.target.name) ??
    "";
  switch (action.target.kind) {
    case "instance":
      return {
        instanceIds: [
          resolveInstance(document, index, action.kind, {
            kind: "instance",
            ...(action.target.id
              ? { id: action.target.id }
              : { reference: action.target.reference }),
          }).id,
        ],
      };
    case "net":
      throw new ActionCompileError(
        index,
        action.kind,
        "a Net is derived from connectivity; disconnect its terminals/routes instead",
      );
    case "route":
      return {
        routeIds: [
          resolveByIdOrName(index, action.kind, "route", document.routes, {
            id: reference,
          }).id,
        ],
      };
    case "junction":
      return {
        junctionIds: [
          resolveByIdOrName(
            index,
            action.kind,
            "junction",
            document.junctions,
            { id: reference },
          ).id,
        ],
      };
    case "annotation":
      return {
        annotationIds: [
          resolveByIdOrName(
            index,
            action.kind,
            "annotation",
            document.annotations.map((entry) => ({ id: String(entry.id) })),
            { id: reference },
          ).id,
        ],
      };
    case "drafting":
      return {
        draftingIds: [
          resolveByIdOrName(
            index,
            action.kind,
            "drafting object",
            document.drafting,
            { id: reference },
          ).id,
        ],
      };
    case "no-connect":
      return {
        noConnectIds: [
          resolveByIdOrName(
            index,
            action.kind,
            "no-connect",
            document.noConnects,
            { id: reference },
          ).id,
        ],
      };
  }
}
