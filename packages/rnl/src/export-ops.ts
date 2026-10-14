import {
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  resolveDocumentLogicalNets,
  resolveEndpointPoint,
} from "@icm/derived";
import type {
  CircuitProject,
  Instance,
  RouteEndpoint,
  SchematicDocument,
  StableId,
} from "@icm/model";
import type { DesignNetlistCell, DesignNetlistIR } from "@icm/netlist";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { rnlOrient, type RnlOrient } from "./orientation.js";
import { rnlPlace, toRnlPoint, type RnlPoint } from "./place.js";
import { rnlSymbolFor, terminalOfPin } from "./symbol-map.js";

/**
 * A vertex of a wire as an RNL edit transaction names it: a terminal, a named
 * point, a role of a usage, or a coordinate (rnl-dev
 * `notes/rnl-editor-interface/spec-draft.md`, 3.5).
 */
export type RnlVertex =
  | { terminal: string }
  | { point: string }
  | { usage: string; role: string }
  | { at: RnlPoint };

/** One operation of an RNL edit transaction (the same draft, 4.1). */
export type RnlOp = { level: string } & (
  | {
      op: "set";
      object: string;
      /** Absent leaves the part to RNL's own symbol rules or stand-in box. */
      symbol?: string;
      at?: RnlPoint;
      orient?: RnlOrient;
    }
  | {
      op: "add-usage";
      name: string;
      definition: string;
      attach: Record<string, string | RnlPoint>;
      symbol?: string;
      at?: RnlPoint;
      orient?: RnlOrient;
    }
  | { op: "add-point"; name: string; at: RnlPoint; junction?: true }
  | {
      op: "add-wire";
      nets: string[];
      via: RnlVertex[];
      mode: "straight";
      style?: Record<string, string>;
    }
  | { op: "remove-from"; items: string[]; set: string }
  | { op: "use-package"; name: string }
);

export interface RnlExportDiagnostic {
  /** An error leaves the drawing out of the export; a warning only reports. */
  severity: "error" | "warning";
  code: string;
  message: string;
  documentId: StableId;
  objectIds: StableId[];
}

/**
 * The RNL definition each drawn glyph stands for: the symbol draws it, the
 * definition says what it is (standard package, `rnl-std-virtual`).
 */
const GLYPH_DEFINITIONS: Readonly<Record<string, string>> = {
  $GROUND: "$GND",
  $SUPPLY_BAR: "$SUPPLY",
  $PORT_TAG: "$IOPORT",
  $AC_PORT_FILLED: "$IOPORT",
};

const USAGE_PREFIX: Readonly<Record<string, string>> = {
  $GND: "gnd",
  $SUPPLY: "vdd",
  $IOPORT: "port",
};

/** Packages the standard package `rnl-std` brings in by itself (16.3). */
const IMPLICIT_PACKAGES = new Set(["rnl-std-symbols", "rnl-std-virtual"]);

/**
 * A name as RNL writes it after its prefix: plain when it is ASCII letters,
 * digits and underscores, otherwise in double quotes with `"` doubled (3.6).
 */
export function rnlName(prefix: string, name: string): string {
  return /^[A-Za-z0-9_]+$/.test(name)
    ? `${prefix}${name}`
    : `${prefix}"${name.replaceAll('"', '""')}"`;
}

/**
 * The edit transaction's operations that draw a netlisted Project as Analog
 * Canvas draws it: each part's symbol, place and orientation, the ground,
 * supply and Cell Pin glyphs, every wire with all its bends, junctions and
 * the dots Analog Canvas draws, and the contacts it makes by touching.
 *
 * `ir` is the IR the netlist was printed from (`includeIr`), with the body
 * port order `rnlBodyPortOrder` gives, so names and terminals match the file.
 * Texts are not written yet.
 */
export function rnlExportOps(
  project: CircuitProject,
  ir: DesignNetlistIR,
): { ops: RnlOp[]; diagnostics: RnlExportDiagnostic[] } {
  const ops: RnlOp[] = [];
  const diagnostics: RnlExportDiagnostic[] = [];
  const packages = new Set<string>();
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  const top = ir.cells.find((cell) => cell.id === ir.topCellId);
  for (const cell of ir.cells) {
    if (cell.origin === "generated-model") continue;
    const document = project.documents.find((item) => item.id === cell.id);
    if (!document) continue;
    exportCell(document, cell, {
      project,
      ir,
      ops,
      diagnostics,
      packages,
      resolver,
    });
  }
  const header: RnlOp[] = [...packages]
    .filter((name) => !IMPLICIT_PACKAGES.has(name))
    .sort()
    .map((name) => ({
      level: top ? `subckt:${top.name}` : "",
      op: "use-package",
      name,
    }));
  return { ops: [...header, ...ops], diagnostics };
}

interface ExportContext {
  project: CircuitProject;
  ir: DesignNetlistIR;
  ops: RnlOp[];
  diagnostics: RnlExportDiagnostic[];
  packages: Set<string>;
  resolver: ReturnType<typeof createProjectSymbolResolver>;
}

function exportCell(
  document: SchematicDocument,
  cell: DesignNetlistCell,
  context: ExportContext,
): void {
  const { ops, diagnostics, packages } = context;
  const level = `subckt:${cell.name}`;
  const report = (
    severity: RnlExportDiagnostic["severity"],
    code: string,
    message: string,
    objectIds: StableId[],
  ) =>
    diagnostics.push({
      severity,
      code,
      message,
      documentId: document.id,
      objectIds,
    });

  // Printed names: Instance -> card name, Base Net -> node.
  const references = new Map(
    cell.instances.map((instance) => [instance.id, instance.reference]),
  );
  const logical = resolveDocumentLogicalNets(document);
  const printedNets = new Map(cell.nets.map((net) => [net.id, net.name]));
  const netOf = (baseNetId: string): string | undefined => {
    const id = logical.byBaseNetId.get(baseNetId)?.id;
    return id ? printedNets.get(id) : undefined;
  };
  const netOfPin = (instanceId: string, pinName: string) => {
    const net = document.nets.find((candidate) =>
      candidate.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pinName,
      ),
    );
    return net ? netOf(net.id) : undefined;
  };

  // Pins a wire or a contact reaches: a variant that hides one is drawn
  // whole instead, since RNL draws a wire only to a pin.
  const evidence = deriveDocumentContactEvidence(document, context.resolver);
  const reached = new Set<string>();
  const reach = (endpoint: RouteEndpoint) => {
    if (endpoint.kind === "terminal")
      reached.add(`${endpoint.instanceId}\u0000${endpoint.pinName}`);
  };
  for (const route of document.routes) {
    reach(route.start);
    for (const leg of route.legs)
      if (leg.to.kind === "endpoint") reach(leg.to.endpoint);
  }
  for (const contact of evidence.contacts) contact.endpoints.forEach(reach);

  // Parts and glyphs.
  const terminalsOf = new Map<StableId, (pin: string) => number | undefined>();
  const usageOf = new Map<StableId, string>();
  const counters = new Map<string, number>();
  const nextName = (prefix: string) => {
    const count = (counters.get(prefix) ?? 0) + 1;
    counters.set(prefix, count);
    return `%${prefix}${count}`;
  };
  const drawnPorts = new Set<string>();
  for (const instance of document.instances) {
    let symbol = rnlSymbolFor(instance.symbolId, instance.symbolVariantId);
    const block = symbol ? undefined : blockTerminals(instance, context);
    if (!symbol && !block) {
      report(
        "error",
        "RNL_NO_SYMBOL",
        `${describe(instance)} has no RNL symbol`,
        [instance.id],
      );
      continue;
    }
    if (block)
      report(
        "warning",
        "RNL_BLOCK_STAND_IN",
        `${describe(instance)} is drawn with RNL's stand-in box: its block symbol is not exported yet`,
        [instance.id],
      );
    const hidden = symbol?.undrawnPins.find((pin) =>
      reached.has(`${instance.id}\u0000${pin.acPin}`),
    );
    if (symbol && hidden) {
      const whole = rnlSymbolFor(instance.symbolId, null);
      if (whole && whole !== symbol) {
        report(
          "warning",
          "RNL_HIDDEN_PIN_WIRED",
          `${describe(instance)} hides pin ${hidden.acPin}, which a wire reaches; it is drawn as ${whole.symbol}`,
          [instance.id],
        );
        symbol = whole;
      }
    }
    if (!instance.placement) {
      report(
        "warning",
        "RNL_NOT_PLACED",
        `${describe(instance)} is not placed on the drawing; RNL leaves it without a position`,
        [instance.id],
      );
    }
    const placement = instance.placement;
    let orient: RnlOrient | undefined;
    if (placement) {
      const result = rnlOrient(placement);
      if (!result.ok) {
        report(
          "error",
          "RNL_ROTATION_NOT_QUARTER",
          `${describe(instance)} is turned ${placement.rotation}°; RNL only turns parts in quarter turns`,
          [instance.id],
        );
        continue;
      }
      orient = result.orient;
    }
    if (symbol?.package === "analog-canvas")
      report(
        "warning",
        "RNL_NOT_STANDARD_SYMBOL",
        `${describe(instance)} is drawn with ${symbol.symbol} from the analog-canvas package, not the standard package`,
        [instance.id],
      );
    if (symbol) packages.add(symbol.package);
    const mapped = symbol;
    terminalsOf.set(
      instance.id,
      mapped ? (pin) => terminalOfPin(mapped, pin) : block!,
    );
    const where =
      placement && orient
        ? {
            at: rnlPlace(placement.position, orient, symbol?.offset ?? [0, 0]),
            orient,
          }
        : {};
    const definition = symbol && GLYPH_DEFINITIONS[symbol.symbol];
    if (symbol && definition) {
      const pin = symbol.pins[0]?.acPin;
      const net = pin ? netOfPin(instance.id, pin) : undefined;
      if (!net) {
        report(
          "warning",
          "RNL_GLYPH_UNCONNECTED",
          `${describe(instance)} meets no net; RNL draws a glyph only on a net`,
          [instance.id],
        );
        continue;
      }
      const name = nextName(USAGE_PREFIX[definition]!);
      usageOf.set(instance.id, name);
      if (definition === "$IOPORT") drawnPorts.add(net);
      ops.push({
        level,
        op: "add-usage",
        name,
        definition,
        attach: { p: rnlName("&", net) },
        symbol: symbol.symbol,
        ...where,
      });
      continue;
    }
    const reference = references.get(instance.id);
    if (!reference) {
      report(
        "warning",
        "RNL_NOT_NETLISTED",
        `${describe(instance)} is not in the netlist, so RNL cannot name it`,
        [instance.id],
      );
      continue;
    }
    ops.push({
      level,
      op: "set",
      object: rnlName("#", reference),
      ...(symbol ? { symbol: symbol.symbol } : {}),
      ...where,
    });
  }

  // A Cell Pin drawn as ground or supply, or not drawn at all, gets no port tag.
  const undrawnPorts = cell.ports
    .map((port) => port.name)
    .filter((name) => !drawnPorts.has(name));
  if (undrawnPorts.length)
    ops.push({
      level,
      op: "remove-from",
      items: undrawnPorts.map((name) => rnlName("&", name)),
      set: "$PORT_FILL_SET",
    });

  // Junctions are named points; the dots come below.
  const pointOf = new Map<StableId, string>();
  const points = new Map<string, RnlOp & { op: "add-point" }>();
  for (const junction of document.junctions) {
    const name = nextName("j");
    pointOf.set(junction.id, name);
    const op = {
      level,
      op: "add-point" as const,
      name,
      at: toRnlPoint(junction.position),
    };
    points.set(name, op);
    ops.push(op);
  }

  const vertex = (endpoint: RouteEndpoint): RnlVertex | undefined => {
    if (endpoint.kind === "junction") {
      const point = pointOf.get(endpoint.junctionId);
      return point ? { point } : undefined;
    }
    const usage = usageOf.get(endpoint.instanceId);
    if (usage) return { usage, role: "p" };
    const reference = references.get(endpoint.instanceId);
    const terminal = terminalsOf.get(endpoint.instanceId)?.(endpoint.pinName);
    return reference && terminal
      ? { terminal: `${rnlName("#", reference)}:${terminal}` }
      : undefined;
  };

  // A wire that runs through a contact without ending there (a T joint) is
  // joined there in Analog Canvas; RNL joins only at the vertices a wire
  // lists, so the contact's point or pin goes into its list where it passes.
  const through = new Map<
    StableId,
    { point: { x: number; y: number }; vertex: RnlVertex }[]
  >();
  for (const contact of evidence.contacts) {
    const own = contact.endpoints.map(vertex).find((item) => item);
    if (!own) continue;
    const touches = (endpoint: RouteEndpoint) =>
      contact.endpoints.some((item) => sameEndpoint(item, endpoint));
    const routeIds = new Set(
      contact.incidents
        .filter((incident) => incident.kind === "route")
        .map((incident) => incident.objectId),
    );
    for (const routeId of routeIds) {
      const route = document.routes.find((item) => item.id === routeId);
      const last = route?.legs.at(-1)?.to;
      if (
        !route ||
        touches(route.start) ||
        (last?.kind === "endpoint" && touches(last.endpoint))
      )
        continue;
      const list = through.get(routeId) ?? [];
      list.push({ point: contact.point, vertex: own });
      through.set(routeId, list);
    }
  }
  const pointOfEndpoint = (endpoint: RouteEndpoint) =>
    resolveEndpointPoint(document, context.resolver, endpoint);

  // Wires, every bend written, so RNL draws them as drawn.
  for (const route of document.routes) {
    const net = netOf(route.netId);
    const corners = [
      { place: pointOfEndpoint(route.start), vertex: vertex(route.start) },
      ...route.legs.map((leg) =>
        leg.to.kind === "bend"
          ? {
              place: leg.to.position,
              vertex: { at: toRnlPoint(leg.to.position) } as RnlVertex,
            }
          : {
              place: pointOfEndpoint(leg.to.endpoint),
              vertex: vertex(leg.to.endpoint),
            },
      ),
    ];
    const via: (RnlVertex | undefined)[] = [];
    corners.forEach((corner, index) => {
      via.push(corner.vertex);
      const next = corners[index + 1];
      if (!next || !corner.place || !next.place) return;
      const from = corner.place;
      const to = next.place;
      const passes = (through.get(route.id) ?? [])
        .filter(({ point }) => onSegment(point, from, to))
        .sort(
          (a, b) =>
            Math.hypot(a.point.x - from.x, a.point.y - from.y) -
            Math.hypot(b.point.x - from.x, b.point.y - from.y),
        );
      for (const pass of passes) via.push(pass.vertex);
    });
    if (!net || via.some((item) => !item)) {
      report(
        "warning",
        "RNL_WIRE_UNNAMED",
        `Wire ${route.id} reaches something RNL cannot name; it is left out`,
        [route.id],
      );
      continue;
    }
    const style: Record<string, string> = {};
    if (route.presentation === "bulk-dashed") style.linestyle = "dashed";
    if (route.presentation === "power-rail") style.linestyle = "bold";
    if (route.styleOverride?.lineStyle)
      style.linestyle = route.styleOverride.lineStyle;
    if (route.styleOverride?.color) style.linecolor = route.styleOverride.color;
    if (route.styleOverride?.arrow)
      report(
        "warning",
        "RNL_WIRE_ARROW",
        `Wire ${route.id} shows a direction arrow, which RNL wires do not draw`,
        [route.id],
      );
    ops.push({
      level,
      op: "add-wire",
      nets: [rnlName("&", net)],
      via: via as RnlVertex[],
      mode: "straight",
      ...(Object.keys(style).length ? { style } : {}),
    });
  }

  // Contacts: things that touch are joined by a wire of no length, since RNL
  // never connects by position; and the dots Analog Canvas draws are written.
  for (const contact of evidence.contacts) {
    const net = netOf(contact.netId);
    if (net && contact.endpoints.length > 1) {
      const via = contact.endpoints.map(vertex);
      if (via.every((item) => item))
        ops.push({
          level,
          op: "add-wire",
          nets: [rnlName("&", net)],
          via: via as RnlVertex[],
          mode: "straight",
        });
    }
    if (!contactRequiresJunctionDot(contact)) continue;
    const junction = contact.endpoints.find(
      (endpoint) => endpoint.kind === "junction",
    );
    const point =
      junction?.kind === "junction" ? pointOf.get(junction.junctionId) : null;
    if (point) {
      points.get(point)!.junction = true;
      continue;
    }
    ops.push({
      level,
      op: "add-usage",
      name: nextName("dot"),
      definition: "$JUNCTION",
      attach: { p: toRnlPoint(contact.point) },
    });
  }
}

/**
 * For a block with no RNL symbol of its own — a drawn Cell or an external
 * subcircuit — the terminal each pin connects: its port's position in the
 * printed `.subckt`, whose ports RNL reads from the netlist.
 */
function blockTerminals(
  instance: Instance,
  { project, ir }: ExportContext,
): ((pin: string) => number | undefined) | undefined {
  const binding = instance.netlist?.binding;
  if (binding?.kind === "subcircuit") {
    const child = project.documents.find(
      (document) => document.id === binding.childDocumentId,
    );
    const printed = ir.cells.find(
      (cell) => cell.id === binding.childDocumentId,
    );
    if (!child || !printed) return undefined;
    // A printed port is keyed by its logical Net; the block's pin by its Cell Pin.
    const logical = resolveDocumentLogicalNets(child);
    return (pin) => {
      const terminal = child.netlist?.terminals.find(
        (item) => item.name === pin,
      );
      const net = terminal && logical.byBaseNetId.get(terminal.netId)?.id;
      const index = printed.ports.findIndex(
        (port) => port.id === net || (!net && port.name === pin),
      );
      return index < 0 ? undefined : index + 1;
    };
  }
  if (binding?.kind === "external-subcircuit") {
    const master = ir.externalMasters?.find(
      (item) => item.id === binding.definitionId,
    );
    if (!master) return undefined;
    return (pin) => {
      const index = master.terminals.findIndex((item) => item.name === pin);
      return index < 0 ? undefined : index + 1;
    };
  }
  return undefined;
}

function sameEndpoint(a: RouteEndpoint, b: RouteEndpoint): boolean {
  return a.kind === "junction"
    ? b.kind === "junction" && a.junctionId === b.junctionId
    : b.kind === "terminal" &&
        a.instanceId === b.instanceId &&
        a.pinName === b.pinName;
}

/** Whether a point lies on a segment strictly between its ends. */
function onSegment(
  point: { x: number; y: number },
  from: { x: number; y: number },
  to: { x: number; y: number },
): boolean {
  const cross =
    (to.x - from.x) * (point.y - from.y) - (to.y - from.y) * (point.x - from.x);
  if (Math.abs(cross) > 1e-9) return false;
  const dot =
    (point.x - from.x) * (to.x - from.x) + (point.y - from.y) * (to.y - from.y);
  const length = (to.x - from.x) ** 2 + (to.y - from.y) ** 2;
  return dot > 1e-9 && dot < length - 1e-9;
}

function describe(instance: Instance): string {
  return instance.reference
    ? `${instance.reference} (${instance.symbolId})`
    : instance.symbolId;
}
