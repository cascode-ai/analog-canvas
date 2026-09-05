import {
  AgentSchematicEditSchema,
  AgentWireIntentSchema,
  type AgentSessionSnapshot,
} from "@icm/agent-adapter";
import { agentRazaviAuthoringCatalog } from "@icm/agent-adapter/kit";
import type { RichTextDocument } from "@icm/model";
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
}

interface ResolvedDocument {
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
    instances: document.instances.map((instance) => ({
      id: instance.id,
      reference: instance.reference,
      symbolId: instance.symbolId,
      placed: instance.placement !== null,
      pins: instance.pins.map((pin) => ({
        name: pin.name,
        connection: pin.connection,
      })),
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
    throw new ActionCompileError(
      index,
      kind,
      `instance "${instance.reference ?? instance.id}" has no pin "${pin}"; snapshot pins: ${instance.pins
        .map((candidate) => candidate.name)
        .join(", ")}`,
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

function nearestPointOnPolyline(
  origin: { x: number; y: number },
  polyline: readonly { x: number; y: number }[],
): { point: { x: number; y: number }; segmentIndex: number } | null {
  let best: { point: { x: number; y: number }; segmentIndex: number } | null =
    null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (
    let segmentIndex = 0;
    segmentIndex < polyline.length - 1;
    segmentIndex += 1
  ) {
    const a = polyline[segmentIndex]!;
    const b = polyline[segmentIndex + 1]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const lengthSquared = dx * dx + dy * dy;
    const t =
      lengthSquared === 0
        ? 0
        : Math.max(
            0,
            Math.min(
              1,
              ((origin.x - a.x) * dx + (origin.y - a.y) * dy) / lengthSquared,
            ),
          );
    const px = a.x + t * dx;
    const py = a.y + t * dy;
    const distance = (origin.x - px) ** 2 + (origin.y - py) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = {
        point: { x: Math.round(px), y: Math.round(py) },
        segmentIndex,
      };
    }
  }
  return best;
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
  const openEdits = (): { edits: SchematicEdit[]; actionKinds: string[] } => {
    const last = transactions[transactions.length - 1];
    if (
      last &&
      last.form === "edits" &&
      last.edits &&
      last.edits.length < maxEdits
    ) {
      return { edits: last.edits, actionKinds: last.actionKinds };
    }
    const entry = { edits: [] as SchematicEdit[], actionKinds: [] as string[] };
    transactions.push({
      form: "edits",
      edits: entry.edits,
      actionKinds: entry.actionKinds,
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
    const slot = openEdits();
    slot.edits.push(validated.data as SchematicEdit);
    slot.actionKinds.push(kind);
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

  parsed.data.forEach((action, index) => {
    switch (action.kind) {
      case "set-model":
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
        compilePlaceComponent(index, action, document, allocateId, pushEdit);
        break;
      case "add-power-rail":
        compileAddPowerRail(index, action, document, allocateId, pushEdit);
        break;
      case "connect":
        compileConnect(index, action, document, allocateId, pushWireIntent);
        break;
      case "disconnect":
        compileDisconnect(index, action, document, pushEdit);
        break;
      case "move":
        if (action.target.kind === "junction") {
          const junction = resolveByIdOrName(
            index,
            action.kind,
            "junction",
            document.junctions,
            action.target,
          );
          pushEdit(index, action.kind, {
            kind: "move_junction",
            junctionId: junction.id,
            position: action.position,
          });
        } else {
          const instance = resolveInstance(
            document,
            index,
            action.kind,
            action.target,
          );
          if (!instance.placed) {
            transactions.push({
              form: "command",
              actionKinds: [action.kind],
              command: {
                kind: "place-existing",
                instanceId: instance.id,
                placement: {
                  position: action.position,
                  rotation: 0,
                  mirror: "none",
                },
              },
            });
            break;
          }
          pushEdit(index, action.kind, {
            kind: "move_instance",
            instanceId: instance.id,
            position: action.position,
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
        break;
      }
      case "mirror": {
        const instance = resolveInstance(
          document,
          index,
          action.kind,
          action.target,
        );
        pushEdit(index, action.kind, {
          kind: "mirror_instance",
          instanceId: instance.id,
          mirror: action.mirror,
        });
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
        pushEdit(index, action.kind, {
          kind: "patch_instance_netlist_parameters",
          instanceId: instance.id,
          ...(action.set ? { set: action.set } : {}),
          ...(action.unset ? { unset: action.unset } : {}),
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
          object: {
            kind: "text",
            id: allocateId("text"),
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: action.position },
            content: richText(action.text),
            alignment: action.alignment ?? "start",
            rotation: action.rotation ?? 0,
          },
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
    }
  });

  return transactions.filter(
    (transaction) =>
      transaction.form !== "edits" ||
      (transaction.edits !== undefined && transaction.edits.length > 0),
  );
}

type PushEdit = (index: number, kind: string, edit: unknown) => void;
type PushWireIntent = (index: number, kind: string, intent: unknown) => void;
type AllocateId = (prefix: string) => string;

function compilePlaceComponent(
  index: number,
  action: ActionOfKind<"place-component">,
  document: ResolvedDocument,
  allocateId: AllocateId,
  pushEdit: PushEdit,
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
  const powerMarker =
    action.symbol === "ground" || action.symbol === "vdd-port";
  if (powerMarker ? action.reference !== undefined : !action.reference) {
    throw new ActionCompileError(
      index,
      action.kind,
      powerMarker
        ? "Power markers use Net names; omit reference"
        : "A device requires an Instance Reference",
    );
  }
  if (
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
  const variant = action.variant ?? catalogSymbol.defaultVariantId ?? undefined;
  pushEdit(index, action.kind, {
    kind: "add_instance",
    instance: {
      id: allocateId("instance"),
      symbolId: action.symbol,
      reference: action.reference,
      ...(variant ? { symbolVariantId: variant } : {}),
      placement: {
        position: action.position,
        rotation: action.rotation ?? 0,
        mirror: action.mirror ?? "none",
      },
      ...(!powerMarker
        ? { netlist: { parameters: action.parameters ?? {} } }
        : {}),
    },
  });
}

function compileAddPowerRail(
  index: number,
  action: ActionOfKind<"add-power-rail">,
  document: ResolvedDocument,
  allocateId: AllocateId,
  pushEdit: PushEdit,
): void {
  const horizontal =
    action.start.y === action.end.y && action.start.x !== action.end.x;
  const vertical =
    action.start.x === action.end.x && action.start.y !== action.end.y;
  if (!horizontal && !vertical) {
    throw new ActionCompileError(
      index,
      action.kind,
      "a Power Rail must be one non-zero horizontal or vertical segment",
    );
  }
  const supplyNet = document.nets.find(
    (net) => net.name?.toLocaleLowerCase("en-US") === "vdd",
  );
  pushEdit(index, action.kind, {
    kind: "add_power_rail",
    netId: supplyNet ? supplyNet.id : allocateId("net"),
    routeId: allocateId("route"),
    startJunctionId: allocateId("junction"),
    endJunctionId: allocateId("junction"),
    labelId: allocateId("label"),
    netName: supplyNet?.name ?? "VDD",
    scope: supplyNet?.scope ?? "global",
    powerDomain: "vdd",
    start: action.start,
    end: action.end,
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
  const pinSide =
    from.kind === "pin" ? from : to.kind === "pin" ? to : undefined;
  const pinOrigin = (() => {
    if (pinSide) {
      const instance = resolveInstance(document, index, action.kind, {
        kind: "instance",
        ...(typeof pinSide.instance === "string"
          ? { reference: pinSide.instance }
          : pinSide.instance),
      });
      requirePin(index, action.kind, instance, pinSide.pin);
      const pin = instance.pins.find(
        (candidate) => candidate.name === pinSide.pin,
      );
      if (!pin?.connection) {
        throw new ActionCompileError(
          index,
          action.kind,
          `pin ${pinSide.instance}.${pinSide.pin} has no resolved grid landing`,
        );
      }
      return pin.connection.gridLanding;
    }
    const geometric = from.kind === "net" ? to : from;
    if (geometric.kind === "route-segment") return geometric.point;
    if (geometric.kind === "point") {
      return { x: geometric.x, y: geometric.y };
    }
    if (geometric.kind === "junction") {
      const junction = resolveByIdOrName(
        index,
        action.kind,
        "junction",
        document.junctions,
        { id: geometric.junction },
      );
      return junction.position;
    }
    throw new ActionCompileError(
      index,
      action.kind,
      "a Net connection needs a pin, point, or Junction on its other side",
    );
  })();

  const anchorFor = (target: ConnectTarget): Record<string, unknown> => {
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
    // Net target: attach at the nearest existing geometry of that net.
    const net = resolveNet(document, index, action.kind, {
      kind: "net",
      name: target.net,
    });
    const routes = net.routeIds
      .map((routeId) => document.routes.find((route) => route.id === routeId))
      .filter(
        (route): route is (typeof document.routes)[number] =>
          route !== undefined,
      );
    let best: {
      routeId: string;
      legId: string;
      point: { x: number; y: number };
    } | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const route of routes) {
      if (!route.polyline) continue;
      const candidate = nearestPointOnPolyline(pinOrigin, route.polyline);
      if (!candidate) continue;
      const distance =
        (pinOrigin.x - candidate.point.x) ** 2 +
        (pinOrigin.y - candidate.point.y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        const leg = route.legs[candidate.segmentIndex];
        if (!leg) continue;
        best = { routeId: route.id, legId: leg.id, point: candidate.point };
      }
    }
    if (best) {
      return {
        kind: "route-segment",
        routeId: best.routeId,
        legId: best.legId,
        point: best.point,
      };
    }
    const junction = net.junctionIds
      .map((junctionId) =>
        document.junctions.find((candidate) => candidate.id === junctionId),
      )
      .filter(
        (candidate): candidate is (typeof document.junctions)[number] =>
          candidate !== undefined,
      )
      .sort(
        (a, b) =>
          (pinOrigin.x - a.position.x) ** 2 +
          (pinOrigin.y - a.position.y) ** 2 -
          ((pinOrigin.x - b.position.x) ** 2 +
            (pinOrigin.y - b.position.y) ** 2),
      )[0];
    if (junction) {
      return {
        kind: "endpoint",
        endpoint: { kind: "junction", junctionId: junction.id },
      };
    }
    throw new ActionCompileError(
      index,
      action.kind,
      `net "${net.name ?? net.id}" has no route or junction geometry to attach to; connect pin-to-pin first or place a junction`,
    );
  };

  pushWireIntent(index, action.kind, {
    id: allocateId("wire"),
    from: anchorFor(from),
    to: anchorFor(to),
    ...(action.via ? { waypoints: action.via } : {}),
    ...(action.routingMode ? { routingMode: action.routingMode } : {}),
    ...(action.cornerOrder ? { cornerOrder: action.cornerOrder } : {}),
  });
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
  const reference = action.target.id ?? action.target.name ?? "";
  if (action.target.kind === "annotation") {
    const annotation = resolveByIdOrName(
      index,
      action.kind,
      "annotation",
      document.annotations.map((entry) => ({ id: String(entry.id), entry })),
      { id: reference },
    );
    pushEdit(index, action.kind, {
      kind: "upsert_schematic_annotation",
      annotation: {
        ...annotation.entry,
        content: richText(action.text),
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
  pushEdit(index, action.kind, {
    kind: "upsert_drafting_object",
    object: {
      ...drafting.object,
      content: richText(action.text),
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
