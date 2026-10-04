import {
  AgentSchematicEditSchema,
  AgentWireIntentSchema,
  isBatchableAuthoringCommand,
  type AgentSessionSnapshot,
} from "@icm/agent-adapter";
import { agentRazaviAuthoringCatalog } from "@icm/agent-adapter/kit";
import {
  deviceDescriptor,
  instanceParameterContract,
  subcircuitDescriptor,
  validateDeviceParameters,
} from "@icm/devices";
import {
  createDraftText,
  flattenRichText,
  InstancePlacementRequestSchema,
  reflectOrientation,
  rewriteRichTextContent,
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
  command?: import("@icm/agent-adapter").AgentAuthoringCommand;
  semanticIntent?: import("@icm/agent-adapter").AgentSemanticIntent;
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
    super(`action[${index}] ${actionKind}: ${message}`);
    this.name = "ActionCompileError";
    this.index = index;
    this.actionKind = actionKind;
  }
}

interface SnapshotInstance {
  id: string;
  reference: string | null;
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
  noConnects: { id: string }[];
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
    noConnects: document.noConnects.map((noConnect) => ({ id: noConnect.id })),
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
    ? document.instances.find((instance) => instance.id === ref.id)
    : document.instances.find(
        (instance) =>
          "reference" in ref && instance.reference === ref.reference,
      );
  if (!found) {
    throw new ActionCompileError(
      index,
      kind,
      `no instance matches ${ref.id ? `id "${ref.id}"` : `Reference "${"reference" in ref ? ref.reference : ""}"`}`,
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

  const createdBy = new Map<CompiledTransaction, number>();
  parsed.data.forEach((action, index) => {
    const before = transactions.length;
    switch (action.kind) {
      case "set-model":
      case "route-net":
      case "set-port-direction":
      case "set-vdd-mode":
      case "delete-selection":
      case "add-power-rail":
      case "extend-power-rail":
      case "move-annotation":
      case "batch":
      case "place-components":
      case "set-instance-display":
      case "set-display-alias":
      case "arrange-labels":
      case "place-existing":
      case "place-cell":
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
      case "bind-cell-parameter":
      case "rename-cell-parameter":
      case "set-cell-parameter-default":
      case "remove-cell-parameter":
        transactions.push({
          form: "command",
          command: action,
          actionKinds: [action.kind],
        });
        break;
      case "focus":
        transactions.push({
          form: "semantic",
          semanticIntent: action.intent,
          actionKinds: [action.kind],
        });
        break;
      case "undo":
      case "redo":
        pushEdit(index, action.kind, { kind: action.kind });
        break;
      case "place-component":
        compilePlaceComponent(
          index,
          action,
          document,
          allocateId,
          pushPlacement,
        );
        break;
      case "connect":
        compileConnect(index, action, document, allocateId, pushWireIntent);
        break;
      case "disconnect":
        compileDisconnect(index, action, document, pushEdit);
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
          transactions.push({
            form: "command",
            actionKinds: [action.kind],
            command: {
              kind: "move-annotation",
              annotationId: annotation.id,
              position: action.position!,
            },
          });
        } else if (action.target.kind === "junction") {
          const junction = resolveByIdOrName(
            index,
            action.kind,
            "junction",
            document.junctions,
            action.target,
          );
          transactions.push({
            form: "command",
            actionKinds: [action.kind],
            command: {
              kind: "move-junction",
              junctionId: junction.id,
              position: action.position!,
            },
          });
        } else {
          const instance = resolveInstance(
            document,
            index,
            action.kind,
            action.target,
          );
          if (!instance.placed) {
            if (action.pinAnchor)
              throw new ActionCompileError(
                index,
                action.kind,
                "move pinAnchor requires a placed Instance; use place-existing with pinAnchor for a tray Instance",
              );
            transactions.push({
              form: "command",
              actionKinds: [action.kind],
              command: {
                kind: "place-existing",
                instanceId: instance.id,
                placement: {
                  position: action.position!,
                  rotation: 0,
                  mirror: "none",
                },
              },
            });
            break;
          }
          let position = action.position!;
          if (action.pinAnchor) {
            requirePin(index, action.kind, instance, action.pinAnchor.pinName);
            const landing = instance.pins.find(
              (pin) => pin.name === action.pinAnchor!.pinName,
            )?.connection?.gridLanding;
            if (!landing || !instance.position)
              throw new ActionCompileError(
                index,
                action.kind,
                `Pin ${action.pinAnchor.pinName} has no resolved routing landing`,
              );
            position = {
              x: instance.position.x + action.pinAnchor.position.x - landing.x,
              y: instance.position.y + action.pinAnchor.position.y - landing.y,
            };
            const grid = document.grid;
            const snapped = {
              x: Math.round(position.x / grid) * grid,
              y: Math.round(position.y / grid) * grid,
            };
            if (snapped.x !== position.x || snapped.y !== position.y)
              throw new ActionCompileError(
                index,
                action.kind,
                `Pin ${instance.reference ?? instance.id}.${action.pinAnchor.pinName} cannot land at (${action.pinAnchor.position.x}, ${action.pinAnchor.position.y}) on placement grid ${grid}; nearest reachable landing is (${landing.x + snapped.x - instance.position.x}, ${landing.y + snapped.y - instance.position.y})`,
              );
          }
          pushEdit(index, action.kind, {
            kind: "move_instance",
            instanceId: instance.id,
            position,
          });
        }
        break;
      case "rotate": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        pushEdit(index, action.kind, {
          kind: "rotate_instance",
          instanceId: instance.id,
          rotation: action.rotation,
        });
        if (instance.orientation)
          instance.orientation = {
            ...instance.orientation,
            rotation: action.rotation as Orientation["rotation"],
          };
        break;
      }
      case "mirror": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        // A reflection from where the part is, one vocabulary with the
        // selection transform (#1231); a state is still accepted.
        let mirror = action.mirror;
        if (action.axis) {
          if (!instance.orientation)
            throw new ActionCompileError(
              index,
              action.kind,
              "reflect a placed part; place it first",
            );
          mirror = reflectOrientation(
            instance.orientation,
            action.axis === "y" ? "left-right" : "top-bottom",
          ).mirror;
        }
        pushEdit(index, action.kind, {
          kind: "mirror_instance",
          instanceId: instance.id,
          mirror,
        });
        // A later reflection in this call starts from this one.
        if (instance.orientation && mirror)
          instance.orientation = {
            ...instance.orientation,
            mirror: mirror as Orientation["mirror"],
          };
        break;
      }
      case "set-reference": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        pushEdit(index, action.kind, {
          kind: "set_instance_reference",
          instanceId: instance.id,
          reference: action.reference,
        });
        break;
      }
      case "set-property": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        if (!instance.netlist)
          throw new ActionCompileError(
            index,
            action.kind,
            `${instance.reference ?? instance.id} has no netlist parameters${
              catalogEntry(instance.symbolId)?.formula
                ? "; use set-signal-flow for its formula or coefficient"
                : ""
            }`,
          );
        for (const key of [
          ...Object.keys(action.set ?? {}),
          ...(action.unset ?? []),
        ]) {
          if (key.startsWith("spice.")) {
            throw new ActionCompileError(
              index,
              action.kind,
              "spice.* keys are migration-only; use typed netlist facts",
            );
          }
        }
        validateActionParameters(
          index,
          action.kind,
          instance,
          action.set,
          context.snapshot.project.externalSubcircuitDefinitions,
        );
        pushEdit(index, action.kind, {
          kind: "patch_instance_netlist_parameters",
          instanceId: instance.id,
          ...(action.set ? { set: action.set } : {}),
          ...(action.unset ? { unset: action.unset } : {}),
        });
        // Subsequent control replacements in this batch must keep earlier
        // parameter edits, not restore the pre-batch Snapshot values.
        const parameters = {
          ...(instance.netlist?.parameters ?? {}),
          ...action.set,
        };
        for (const key of action.unset ?? []) delete parameters[key];
        instance.netlist = { ...instance.netlist, parameters };
        break;
      }
      case "set-block-supply": {
        // Fixes MISSING_BLOCK_SUPPLY in one action, through the same
        // property-only terminal the Properties panel binds.
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        // A built-in block names its supplies, and a built-in primitive has
        // none; the edit engine checks a user component's terminal itself.
        const descriptor = subcircuitDescriptor(instance.symbolId);
        if (
          descriptor
            ? !descriptor.ports.some((port) => port.supply === action.supply)
            : deviceDescriptor(instance.symbolId) !== undefined
        )
          throw new ActionCompileError(
            index,
            action.kind,
            `instance "${instance.reference ?? instance.id}" has no ${action.supply} supply to choose`,
          );
        const net =
          action.net === null
            ? null
            : resolveNet(document, index, action.kind, action.net);
        pushEdit(index, action.kind, {
          kind: "set_property_terminal_net",
          instanceId: instance.id,
          pinName: action.supply,
          netId: net?.id ?? null,
        });
        break;
      }
      case "set-source-control": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        pushEdit(index, action.kind, {
          kind: "set_instance_netlist",
          instanceId: instance.id,
          netlist: {
            ...(instance.netlist?.binding
              ? { binding: instance.netlist.binding }
              : {}),
            parameters: { ...(instance.netlist?.parameters ?? {}) },
            ...(action.control ? { control: action.control } : {}),
          },
        });
        break;
      }
      case "add-label":
        transactions.push({
          form: "command",
          command: compileAddLabel(index, action, document, allocateId),
          actionKinds: [action.kind],
        });
        break;
      case "edit-text": {
        const annotation =
          action.target.kind === "annotation"
            ? document.annotations.find(
                (entry) =>
                  entry.id === (action.target.id ?? action.target.name),
              )
            : undefined;
        if (
          annotation?.kind === "net-label" ||
          annotation?.kind === "power-label"
        ) {
          transactions.push({
            form: "command",
            actionKinds: [action.kind],
            command: {
              kind: "set-net-label",
              annotationId: String(annotation.id),
              netId: String(annotation.netId),
              text: richText(action.text),
            },
          });
          break;
        }
        compileEditText(index, action, document, pushEdit);
        break;
      }
      case "annotate":
        pushEdit(index, action.kind, {
          kind: "upsert_drafting_object",
          object: createDraftText({
            id: allocateId("text"),
            position: action.position,
            content: action.text,
            alignment: action.alignment,
            rotation: action.rotation,
          }),
        });
        break;
      case "arrange": {
        const instanceIds = action.instances.map(
          (ref) => resolveInstance(document, index, action.kind, ref).id,
        );
        if (new Set(instanceIds).size !== instanceIds.length) {
          throw new ActionCompileError(
            index,
            action.kind,
            "instances must be distinct",
          );
        }
        pushEdit(index, action.kind, {
          kind: "align_instances",
          instanceIds,
          axis: action.axis,
          ...(action.coordinate !== undefined
            ? { coordinate: action.coordinate }
            : {}),
        });
        break;
      }
      case "delete":
        compileDelete(index, action, document, pushEdit);
        break;
      case "set-orientation": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        if (action.rotation !== undefined)
          pushEdit(index, action.kind, {
            kind: "rotate_instance",
            instanceId: instance.id,
            rotation: action.rotation,
          });
        if (action.mirror !== undefined)
          pushEdit(index, action.kind, {
            kind: "mirror_instance",
            instanceId: instance.id,
            mirror: action.mirror,
          });
        if (instance.orientation)
          instance.orientation = {
            rotation: (action.rotation ??
              instance.orientation.rotation) as Orientation["rotation"],
            mirror: action.mirror ?? instance.orientation.mirror,
          };
        break;
      }
      case "set-signal-flow": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        const parameters = signalFlowChange(
          index,
          action.kind,
          instance,
          action,
        );
        pushEdit(index, action.kind, {
          kind: "set_instance_signal_flow_parameters",
          instanceId: instance.id,
          parameters,
        });
        // A later action in this call sees the change.
        if (parameters) instance.signalFlowParameters = parameters;
        else delete instance.signalFlowParameters;
        break;
      }
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

function compilePlaceComponent(
  index: number,
  action: ActionOfKind<"place-component">,
  document: ResolvedDocument,
  allocateId: AllocateId,
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
  validateActionParameters(
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
  pushPlacement(index, action.kind, {
    id: allocateId("instance"),
    symbolId: action.symbol,
    ...(reference ? { reference } : {}),
    ...(variant ? { symbolVariantId: variant } : {}),
    placement: mirrored ?? {
      position: action.position ?? { x: 0, y: 0 },
      rotation: action.rotation ?? 0,
      mirror: action.mirror ?? "none",
    },
    // Without parameters or control the editor fills the netlist, catalog
    // defaults and the Process's model, exactly as a GUI insert, and leaves a
    // block that emits nothing without one.
    ...(!powerMarker && (action.parameters || action.control)
      ? {
          netlist: {
            parameters: action.parameters ?? {},
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
    document.instances.find((instance) => instance.reference === of.instance) ??
    document.instances.find((instance) => instance.id === of.instance);
  if (!source?.position || !source.orientation)
    throw new ActionCompileError(
      index,
      action.kind,
      source
        ? `${of.instance} is not placed yet; place it before mirroring it`
        : `no part ${of.instance} to mirror`,
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

/** One catalog entry, or undefined for a part outside the reviewed catalog. */
function catalogEntry(symbolId: string) {
  return agentRazaviAuthoringCatalog.symbols.find(
    (symbol) => symbol.symbolId === symbolId,
  );
}

/**
 * The signal-flow parameters set-signal-flow leaves: null clears a field,
 * a value replaces it, and the formula's authored look goes with a new
 * formula, as in the Properties formula. Null when nothing is left.
 */
function signalFlowChange(
  index: number,
  kind: string,
  instance: SnapshotInstance,
  action: Extract<AuthoringAction, { kind: "set-signal-flow" }>,
): z.infer<typeof SignalFlowParametersSchema> | null {
  const entry = catalogEntry(instance.symbolId);
  if (!entry?.formula)
    throw new ActionCompileError(
      index,
      kind,
      `${instance.reference ?? instance.id} (${instance.symbolId}) draws no formula`,
    );
  if (action.coefficient && !entry.coefficient)
    throw new ActionCompileError(
      index,
      kind,
      `${instance.symbolId} draws no coefficient`,
    );
  const next: Record<string, unknown> = {
    ...(instance.signalFlowParameters ?? {}),
  };
  for (const key of [
    "formula",
    "coefficient",
    "bodyWidth",
    "bodyHeight",
  ] as const) {
    if (!(key in action)) continue;
    const value = action[key];
    if (value === null || value === undefined) delete next[key];
    else next[key] = value;
  }
  if (next.formula !== instance.signalFlowParameters?.formula)
    delete next.formulaFormat;
  if (!next.formula) delete next.formulaFormat;
  if (
    JSON.stringify(next) === JSON.stringify(instance.signalFlowParameters ?? {})
  )
    throw new ActionCompileError(
      index,
      kind,
      "the block already shows this; nothing to change",
    );
  return Object.keys(next).length
    ? (next as z.infer<typeof SignalFlowParametersSchema>)
    : null;
}

function validateActionParameters(
  index: number,
  kind: string,
  owner: Parameters<typeof instanceParameterContract>[1],
  parameters: Readonly<Record<string, string>> | undefined,
  externalSubcircuitDefinitions?: Parameters<
    typeof instanceParameterContract
  >[0]["externalSubcircuitDefinitions"],
): void {
  if (!parameters) return;
  // The parameters the part's model owns, as export reads them: a part bound
  // to a reviewed SKY130 model takes that model's (a resistor's w, l, mult).
  // Custom and imported symbols outside the registry deliberately remain a
  // human-fact boundary; their contracts are unavailable to this client.
  const contract = instanceParameterContract(
    externalSubcircuitDefinitions ? { externalSubcircuitDefinitions } : {},
    owner,
  );
  if (!contract) return;
  const symbolId = owner.symbolId;
  const issues = validateDeviceParameters(
    { parameters: contract.definitions },
    parameters,
    { open: contract.open },
  );
  if (!issues.length) return;
  const issue = issues[0]!;
  const allowed = contract.definitions.map((parameter) => parameter.name);
  const allowedText = allowed.length ? allowed.join(", ") : "(none)";
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
        ? 'Parameter "' +
          issue.name +
          '" must be a SPICE number such as 1k or 2.5n, or an expression in braces such as {vdd/2}; received "' +
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

function compileDisconnect(
  index: number,
  action: ActionOfKind<"disconnect">,
  document: ResolvedDocument,
  pushEdit: PushEdit,
): void {
  if (action.target.kind === "pin") {
    const instance = resolveInstance(document, index, action.kind, {
      kind: "instance",
      ...(typeof action.target.instance === "string"
        ? { reference: action.target.instance }
        : action.target.instance),
    });
    requirePin(index, action.kind, instance, action.target.pin);
    if (
      action.target.pin === "P" &&
      document.cellTerminalInstanceIds.has(instance.id)
    )
      throw new ActionCompileError(
        index,
        action.kind,
        "A formal Cell Pin's P pin cannot be disconnected; use remove-cell-terminal or delete-selection instead",
      );
    pushEdit(index, action.kind, {
      kind: "disconnect_endpoint",
      endpoint: terminalEndpoint(instance, action.target.pin),
    });
    return;
  }
  const route = resolveByIdOrName(
    index,
    action.kind,
    "route",
    document.routes,
    { id: action.target.route },
  );
  pushEdit(index, action.kind, { kind: "cut_connection", routeId: route.id });
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
  const net = resolveNet(document, index, action.kind, {
    kind: "net",
    ...(action.target.name ? { name: action.target.name } : {}),
    ...(action.target.id ? { id: action.target.id } : {}),
  });
  let position = action.position;
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

function compileEditText(
  index: number,
  action: ActionOfKind<"edit-text">,
  document: ResolvedDocument,
  pushEdit: PushEdit,
): void {
  const contentUpdate = (previous: unknown): RichTextDocument => {
    if (typeof action.text !== "string") return action.text;
    const rewritten = rewriteRichTextContent(
      previous as RichTextDocument,
      action.text,
    );
    if (!rewritten)
      throw new ActionCompileError(
        index,
        action.kind,
        "This text contains a formula or fraction; supply explicit RichText to replace it without losing its structure",
      );
    return rewritten;
  };
  const reference = action.target.id ?? action.target.name ?? "";
  if (action.target.kind === "annotation") {
    const annotation = resolveByIdOrName(
      index,
      action.kind,
      "annotation",
      document.annotations.map((entry) => ({ id: String(entry.id), entry })),
      { id: reference },
    );
    const { resolvedText, content: _content, ...source } = annotation.entry;
    const nextText = richText(action.text);
    if (source.binding) {
      if (
        typeof resolvedText !== "string" ||
        flattenRichText(nextText) !== resolvedText
      ) {
        throw new ActionCompileError(
          index,
          action.kind,
          "bound labels can only be restyled with edit-text; change their underlying name or value through its owning object",
        );
      }
      // A same-text string is content-only, not an explicit format override.
      if (typeof action.text === "string") {
        return;
      }
      pushEdit(index, action.kind, {
        kind: "upsert_schematic_annotation",
        annotation: { ...source, formatOverride: nextText },
      });
      return;
    }
    if (
      typeof action.text === "string" &&
      flattenRichText(_content as RichTextDocument) === action.text
    )
      return;
    pushEdit(index, action.kind, {
      kind: "upsert_schematic_annotation",
      annotation: {
        ...source,
        content: contentUpdate(_content),
      },
    });
    return;
  }
  const drafting = resolveByIdOrName(
    index,
    action.kind,
    "drafting object",
    document.drafting.map((entry) => ({ id: entry.id, object: entry.object })),
    { id: reference },
  );
  if (drafting.object.kind !== "text") {
    throw new ActionCompileError(
      index,
      action.kind,
      `drafting object "${drafting.id}" is a ${String(drafting.object.kind)}, not text`,
    );
  }
  if (
    typeof action.text === "string" &&
    flattenRichText(drafting.object.content as RichTextDocument) === action.text
  )
    return;
  pushEdit(index, action.kind, {
    kind: "upsert_drafting_object",
    object: {
      ...drafting.object,
      content: contentUpdate(drafting.object.content),
    },
  });
}

function compileDelete(
  index: number,
  action: ActionOfKind<"delete">,
  document: ResolvedDocument,
  pushEdit: PushEdit,
): void {
  const reference =
    action.target.id ??
    (action.target.kind === "instance"
      ? action.target.reference
      : action.target.name) ??
    "";
  switch (action.target.kind) {
    case "instance": {
      const instance = resolveInstance(document, index, action.kind, {
        kind: "instance",
        ...(action.target.id
          ? { id: action.target.id }
          : { reference: action.target.reference }),
      });
      pushEdit(index, action.kind, {
        kind: "remove_instance",
        instanceId: instance.id,
      });
      return;
    }
    case "net":
      throw new ActionCompileError(
        index,
        action.kind,
        "a Net is derived from connectivity; disconnect its terminals/routes instead",
      );
    case "route": {
      const route = resolveByIdOrName(
        index,
        action.kind,
        "route",
        document.routes,
        { id: reference },
      );
      pushEdit(index, action.kind, {
        kind: "cut_connection",
        routeId: route.id,
      });
      return;
    }
    case "junction": {
      const junction = resolveByIdOrName(
        index,
        action.kind,
        "junction",
        document.junctions,
        { id: reference },
      );
      pushEdit(index, action.kind, {
        kind: "remove_junction",
        junctionId: junction.id,
      });
      return;
    }
    case "annotation": {
      const annotation = resolveByIdOrName(
        index,
        action.kind,
        "annotation",
        document.annotations.map((entry) => ({ id: String(entry.id) })),
        { id: reference },
      );
      pushEdit(index, action.kind, {
        kind: "remove_schematic_annotation",
        annotationId: annotation.id,
      });
      return;
    }
    case "drafting": {
      const drafting = resolveByIdOrName(
        index,
        action.kind,
        "drafting object",
        document.drafting,
        { id: reference },
      );
      pushEdit(index, action.kind, {
        kind: "remove_drafting_object",
        objectId: drafting.id,
      });
      return;
    }
    case "no-connect": {
      const noConnect = resolveByIdOrName(
        index,
        action.kind,
        "no-connect",
        document.noConnects,
        { id: reference },
      );
      pushEdit(index, action.kind, {
        kind: "remove_no_connect",
        noConnectId: noConnect.id,
      });
      return;
    }
  }
}
