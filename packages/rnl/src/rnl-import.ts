import {
  resolveDocumentStyleProfile,
  supplyMarkerForSymbol,
} from "@icm/derived";
import {
  deriveStableId,
  type CircuitProject,
  type Instance,
  type RouteBranch,
  type RouteEndpoint,
  type SchematicDocument,
  type StableId,
} from "@icm/model";

type Junction = SchematicDocument["junctions"][number];

import { acOrientation, composeOrient, type RnlOrient } from "./orientation.js";
import { acPosition, AC_UNITS_PER_RNL_UNIT } from "./place.js";
import { RNL_SYMBOLS, type RnlSymbol } from "./symbol-map.js";
import { acRichText, type RnlRun } from "./text.js";

/**
 * The parts of the rnl runtime's snapshot the import reads (its
 * `snapshot.d.ts`; rnl-dev `notes/rnl-editor-interface/spec-draft.md`, 3):
 * the host circuit to check against and the model to draw from. Scene
 * coordinates, y up; ids written as RNL writes them.
 */
export interface RnlSnapshot {
  dialect: string;
  packages: readonly { name: string; version: string }[];
  levels: readonly RnlLevelSnapshot[];
  diagnostics: readonly { severity: string; message: string }[];
  failed: string | null;
}

type Slot<T> = { readonly value: T | null };
type Point = readonly [number, number];

export interface RnlLevelSnapshot {
  /** `subckt:NAME` or `file:PATH`. */
  id: string;
  kind: string;
  name: string;
  host?: {
    ports: readonly string[];
    instances: readonly {
      id: string;
      subckt: boolean;
      master: string | null;
      terminals: readonly { n: number; name: string | null; net: string }[];
    }[];
    nets: readonly { id: string; global: boolean; port: boolean }[];
  };
  model?: {
    symbols: readonly RnlSymbolRef[];
    objects: readonly RnlObjectView[];
    points: readonly {
      id: string;
      at: Slot<Point>;
      junction: boolean;
    }[];
    wires: readonly RnlWireView[];
    texts: readonly RnlTextView[];
  };
}

export interface RnlSymbolRef {
  id: string;
  name: string;
  package: string | null;
  level: string | null;
  /** The viewer's own stand-in box. */
  default: boolean;
  /** A symbol the document defines, as it defines it; null for a package's. */
  definition?: RnlSymbolDefinitionView | null;
}

export interface RnlSymbolDefinitionView {
  box: Point | readonly [number, number, number, number];
  pins: readonly {
    /** Each a port's name or a terminal's number, as text. */
    terminals: readonly string[];
    at: Point;
    /** The exit direction in degrees: 0 right, 90 up, 180 left, 270 down. */
    dir: number | null;
  }[];
  prims: readonly {
    shape: string;
    points: readonly Point[];
    params?: Readonly<Record<string, string | number>>;
  }[];
}

export interface RnlObjectView {
  id: string;
  kind: string;
  host: readonly string[];
  definition: string | null;
  attach: Readonly<Record<string, string | Point>> | null;
  symbol: Slot<string>;
  at: Slot<Point>;
  orient: Slot<string>;
  pins: readonly {
    terminals: readonly string[];
    at: Point;
    dir: number | null;
    nets: readonly string[];
  }[];
}

export type RnlSnapshotVertex =
  | { terminal: string }
  | { point: string }
  | { usage: string; role: string }
  | { at: Point };

export interface RnlWireView {
  id: string;
  nets: readonly string[];
  via: readonly RnlSnapshotVertex[];
  points: readonly Point[];
  mode: string;
  style: Readonly<Record<string, string | number | boolean>>;
}

export interface RnlTextView {
  id: string;
  attach: string | null;
  key: string | null;
  markup: Slot<string>;
  /** False for a label its symbol alone gives. */
  written: boolean;
  lines: readonly (readonly RnlRun[])[];
  anchor: Point;
  halign: string;
  valign: string;
  rotate: number;
  size: number | null;
  style: Readonly<Record<string, string | number | boolean>>;
}

export interface RnlImportDiagnostic {
  /** An error leaves the drawing out; a warning keeps what could be drawn. */
  severity: "error" | "warning";
  code: string;
  message: string;
  /** The Cell it is about, when it is about one. */
  documentId?: StableId;
}

/** The standard series and Analog Canvas package the mapping table is for. */
const MAPPED_VERSIONS: Readonly<Record<string, string>> = {
  "analog-canvas-extensions": "0.1",
};
const STD_VERSION = "0.3";

/**
 * The name an RNL id names, without its prefix (`#M1` → `M1`), quotes
 * undone (`&"vdd!"` → `vdd!`); null for an id that is not a plain name,
 * such as a statement's place.
 */
function rnlIdName(id: string, prefix: string): string | null {
  if (!id.startsWith(prefix)) return null;
  const name = id.slice(prefix.length);
  if (name.startsWith('"')) {
    const end = name.lastIndexOf('"');
    return end > 0 ? name.slice(1, end).replaceAll('""', '"') : null;
  }
  return /^[^\s:@]+$/u.test(name) ? name : null;
}

/** An RNL terminal id, `#M1:3`, as its instance's name and terminal number. */
function terminalOf(id: string): { name: string; n: number } | null {
  const colon = id.lastIndexOf(":");
  const name = colon > 0 ? rnlIdName(id.slice(0, colon), "#") : null;
  const n = Number(id.slice(colon + 1));
  return name && Number.isInteger(n) && n > 0 ? { name, n } : null;
}

/** A scene point as an Analog Canvas point: ten units to one, y down. */
const acPoint = ([x, y]: Point) => ({
  x: Math.round(x * AC_UNITS_PER_RNL_UNIT * 1e6) / 1e6 + 0,
  y: Math.round(-y * AC_UNITS_PER_RNL_UNIT * 1e6) / 1e6 + 0,
});

/** The orientation that undoes `orient`. */
function inverse(orient: RnlOrient): RnlOrient {
  const codes: RnlOrient[] = [
    "R0",
    "R90",
    "R180",
    "R270",
    "MX",
    "MY",
    "MXR90",
    "MYR90",
  ];
  return codes.find((code) => composeOrient(code, orient) === "R0")!;
}

const isOrient = (value: string | null): value is RnlOrient =>
  value !== null &&
  ["R0", "R90", "R180", "R270", "MX", "MY", "MXR90", "MYR90"].includes(value);

/**
 * The Analog Canvas symbol a part RNL draws with `symbol`, turned `orient`,
 * reads back as: of the symbol's rows, the one whose Analog Canvas
 * orientation needs no mirror (an op-amp turned MX is the plain op-amp,
 * unturned the inputs-swapped one), the part's own symbol first, and only a
 * symbol whose pins keep the part's pin names, so its connections stand.
 */
function acSymbolFor(
  symbol: RnlSymbolRef,
  orient: RnlOrient,
  instance: Pick<Instance, "symbolId">,
  pinNames: readonly string[],
): { row: RnlSymbol; orient: RnlOrient } | null {
  const rows = RNL_SYMBOLS.filter(
    (row) =>
      row.ac !== null &&
      row.symbol === symbol.name &&
      family(row.package) === family(symbol.package) &&
      pinNames.every(
        (pin) =>
          row.pins.some((item) => item.acPin === pin) ||
          row.undrawnPins.some((item) => item.acPin === pin),
      ),
  );
  const ranked = rows
    .map((row) => ({ row, orient: composeOrient(orient, inverse(row.orient)) }))
    .sort(
      (a, b) =>
        Number(a.orient.startsWith("M")) - Number(b.orient.startsWith("M")) ||
        Number(a.row.ac !== instance.symbolId) -
          Number(b.row.ac !== instance.symbolId),
    );
  return ranked[0] ?? null;
}

/**
 * The standard package and its parts are one family: a build may bring them
 * as one file, as the toolkit's preview does, and their names never clash.
 */
const family = (name: string | null) =>
  name?.startsWith("rnl-std") ? "rnl-std" : name;

/** The Cell a level draws: a subcircuit by its name, the file level by the flat Cell. */
function documentOf(
  project: CircuitProject,
  level: RnlLevelSnapshot,
): SchematicDocument | undefined {
  const name = level.kind === "file" ? "__flat__" : level.name.toLowerCase();
  return project.documents.find(
    (document) => document.netlist?.name.toLowerCase() === name,
  );
}

/**
 * A Project the SPICE / SCS importer made from a rich netlist, drawn as the
 * netlist's RNL draws it (rnl-dev `notes/analog-canvas-rnl-import-export.md`,
 * 6): parts placed, turned and in the variant their RNL symbol stands for;
 * wires with every bend, split where they run through a pin or point; and
 * junction points. The electrical part is the importer's, unchanged.
 */
export function applyRnlSnapshot(
  project: CircuitProject,
  snapshot: RnlSnapshot,
): { project: CircuitProject; diagnostics: RnlImportDiagnostic[] } {
  const diagnostics: RnlImportDiagnostic[] = [];
  if (snapshot.failed) {
    diagnostics.push({
      severity: "error",
      code: "RNL_IMPORT_UNREADABLE",
      message: `RNL could not read the file: ${snapshot.failed}`,
    });
    return { project, diagnostics };
  }
  for (const item of snapshot.diagnostics)
    if (item.severity === "error")
      diagnostics.push({
        severity: "warning",
        code: "RNL_IMPORT_RNL_ERROR",
        message: `RNL: ${item.message}`,
      });
  for (const { name, version } of snapshot.packages) {
    const wanted = name.startsWith("rnl-std")
      ? STD_VERSION
      : MAPPED_VERSIONS[name];
    if (wanted && version !== wanted)
      diagnostics.push({
        severity: "warning",
        code: "RNL_IMPORT_PACKAGE_VERSION",
        message: `${name} ${version} is not the version Analog Canvas maps (${wanted}); its symbols may read back wrong`,
      });
  }
  const next = structuredClone(project);
  for (const level of snapshot.levels) {
    if (!level.model) continue;
    const document = documentOf(next, level);
    if (!document) {
      if (level.model.objects.some((object) => object.at.value))
        diagnostics.push({
          severity: "warning",
          code: "RNL_IMPORT_NO_CELL",
          message: `RNL draws ${level.name}, which the netlist import made no Cell for`,
        });
      continue;
    }
    applyLevel(next, document, level, level.model, diagnostics);
  }
  return { project: next, diagnostics };
}

function applyLevel(
  project: CircuitProject,
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  model: NonNullable<RnlLevelSnapshot["model"]>,
  diagnostics: RnlImportDiagnostic[],
): void {
  const warn = (code: string, message: string) =>
    diagnostics.push({
      severity: "warning",
      code,
      message,
      documentId: document.id,
    });
  const symbols = new Map(model.symbols.map((symbol) => [symbol.id, symbol]));
  const byName = new Map(
    document.instances.map((instance) => [instance.id.toLowerCase(), instance]),
  );
  const instanceOf = (name: string) =>
    document.instances.find((instance) => instance.id === name) ??
    byName.get(name.toLowerCase());

  // Nets by their RNL name, from the import's own record of the names.
  const nets = new Map(
    (document.importReference?.nets ?? []).map((net) => [
      net.name.toLowerCase(),
      net.id,
    ]),
  );
  const netOf = (id: string) => {
    const name = rnlIdName(id, "&");
    return name === null ? undefined : nets.get(name.toLowerCase());
  };

  /** A part's terminal as its Analog Canvas pin, by the import's own mapping. */
  const pinOf = (instance: Instance, n: number) =>
    instance.importProvenance?.terminalMapping?.find(
      (terminal) => terminal.sourcePosition === n - 1,
    )?.pinName;

  // Analog Canvas keeps parts on its 10-unit grid and wire corners on its
  // 2-unit one; a point RNL puts between is moved to the nearest.
  let snapped = 0;
  const snap = (point: { x: number; y: number }, grid: number) => {
    const x = Math.round(point.x / grid) * grid + 0;
    const y = Math.round(point.y / grid) * grid + 0;
    if (Math.abs(x - point.x) > NEAR || Math.abs(y - point.y) > NEAR)
      snapped += 1;
    return { x, y };
  };

  // Parts: placed, turned and in the variant their symbol stands for.
  const unplaced: string[] = [];
  const laidOut = new Set<string>();
  for (const object of model.objects) {
    if (object.kind !== "instance") continue;
    const name = rnlIdName(object.host[0] ?? object.id, "#");
    const instance = name === null ? undefined : instanceOf(name);
    if (!instance) {
      warn(
        "RNL_IMPORT_NO_PART",
        `RNL draws ${object.id}, which the netlist import has no part for`,
      );
      continue;
    }
    const at = object.at.value;
    const orient = object.orient.value;
    if (!at || !isOrient(orient)) {
      unplaced.push(instance.id);
      continue;
    }
    const symbol = object.symbol.value
      ? symbols.get(object.symbol.value)
      : undefined;
    const pinNames =
      instance.importProvenance?.terminalMapping?.map(
        (terminal) => terminal.pinName,
      ) ?? [];
    const mapped =
      symbol && !symbol.default && !symbol.level
        ? acSymbolFor(symbol, orient, instance, pinNames)
        : null;
    if (symbol && !mapped && !symbol.default && !symbol.level)
      warn(
        "RNL_IMPORT_UNMAPPED_SYMBOL",
        `${instance.id} is drawn with ${symbol.name}, which Analog Canvas has no symbol for; it keeps its own`,
      );
    if (mapped) {
      instance.symbolId = mapped.row.ac!;
      if (mapped.row.variant) instance.symbolVariantId = mapped.row.variant;
      else delete instance.symbolVariantId;
    }
    const turn = mapped?.orient ?? orient;
    instance.placement = {
      position: snap(
        acPosition(at, turn, mapped?.row.offset ?? [0, 0]),
        PART_GRID,
      ),
      ...acOrientation(turn),
    };
    // A Cell's call drawn with the symbol the file defines for it: the
    // Cell's block takes that layout, its pins where the symbol has them.
    const binding = instance.netlist?.binding;
    const child =
      symbol?.definition && binding?.kind === "subcircuit"
        ? project.documents.find((item) => item.id === binding.childDocumentId)
        : undefined;
    if (child && symbol?.definition && !laidOut.has(child.id)) {
      laidOut.add(child.id);
      const layout = cellSymbolOf(child, symbol.definition);
      child.presentation.cellSymbol = layout.cellSymbol;
      if (!layout.exact)
        warn(
          "RNL_IMPORT_BLOCK_APPROXIMATE",
          `${child.name}'s block is drawn as a box: RNL draws it otherwise, or off the grid`,
        );
    }
  }
  if (unplaced.length)
    warn(
      "RNL_IMPORT_UNPLACED",
      `${unplaced.length} parts have no place in the RNL and stay on the shelf: ${unplaced.join(", ")}`,
    );

  // Ground pins Analog Canvas adds: a Cell printed as a subcircuit that meets
  // ground takes a pin for it, VSS (or GND, GND__2 …), which its drawing
  // shows as ground, never as a port. On such a pin the Cell's ground is
  // ground again, as drawn; its callers' ground reaches it as before.
  const usagesOn = (definition: string) =>
    new Set(
      model.objects.flatMap((object) => {
        const attached = object.attach?.["p"];
        const netId =
          object.kind === "usage" &&
          object.definition === definition &&
          typeof attached === "string"
            ? netOf(attached)
            : undefined;
        return netId ? [netId] : [];
      }),
    );
  const groundNets = usagesOn("$GROUND");
  const portNets = usagesOn("$IO_PORT");
  const groundPins = new Set<string>();
  for (const terminal of [...(document.netlist?.terminals ?? [])])
    if (
      groundNets.has(terminal.netId) &&
      !portNets.has(terminal.netId) &&
      /^(?:VSS|GND(?:__\d+)?)$/iu.test(terminal.name)
    ) {
      removeGroundPin(project, document, terminal);
      groundPins.add(terminal.netId);
    }

  // Glyphs: each usage of a virtual element on an Analog Canvas glyph. A
  // Cell Pin is the importer's own, moved where RNL draws it; ground and
  // supply glyphs are added on their nets, each claiming its supply.
  const glyphOf = new Map<string, { instanceId: string; pinName: string }>();
  const movedPins = new Set<string>();
  const marks = new Map<string, number>();
  /** Marks read once the wires are routes, and figures, by usage. */
  const later: RnlObjectView[] = [];
  for (const object of model.objects) {
    if (object.kind !== "usage" || !object.definition) continue;
    if (LATER.has(object.definition)) {
      later.push(object);
      continue;
    }
    const attached = object.attach?.["p"];
    const netId = typeof attached === "string" ? netOf(attached) : undefined;
    const at = object.at.value;
    const orient = object.orient.value;
    const symbol = object.symbol.value
      ? symbols.get(object.symbol.value)
      : undefined;
    if (object.definition === "$JUNCTION") continue; // dots are derived
    const mapped =
      symbol && isOrient(orient)
        ? acSymbolFor(symbol, orient, { symbolId: "" }, [])
        : null;
    const placementOf = () =>
      at && mapped
        ? {
            position: snap(
              acPosition(at, mapped.orient, mapped.row.offset),
              PART_GRID,
            ),
            ...acOrientation(mapped.orient),
          }
        : null;
    // A port the Cell has, drawn as a port or as a supply: the importer's
    // own Cell Pin, moved where RNL draws it, in the glyph RNL draws.
    if (object.definition === "$IO_PORT" || object.definition === "$SUPPLY") {
      const terminal = document.netlist?.terminals.find(
        (item) =>
          item.netId === netId &&
          item.interfaceInstanceIds.some((id) => !movedPins.has(id)),
      );
      const pinId = terminal?.interfaceInstanceIds.find(
        (id) => !movedPins.has(id),
      );
      const pin = pinId === undefined ? undefined : instanceOf(pinId);
      if (pin) {
        movedPins.add(pin.id);
        glyphOf.set(object.id, { instanceId: pin.id, pinName: "P" });
        if (mapped) pin.symbolId = mapped.row.ac!;
        pin.placement = placementOf() ?? pin.placement;
        continue;
      }
      if (object.definition === "$IO_PORT") {
        warn(
          "RNL_IMPORT_PORT_UNMATCHED",
          `${object.id} draws a port on ${String(attached)}, which is not one of the Cell's ports`,
        );
        continue;
      }
    }
    if (object.definition === "$GROUND" || object.definition === "$SUPPLY") {
      // A ground glyph names its net 0, so it goes only on ground; a supply
      // glyph claims its net by the net's own name. Anything else is drawn
      // as a picture, which the netlist does not read.
      const net = document.nets.find((item) => item.id === netId);
      const named = document.importReference?.nets.find(
        (item) => item.id === netId,
      );
      const ground = object.definition === "$GROUND";
      const isGround =
        (netId !== undefined && groundPins.has(netId)) ||
        (named?.name === "0" && named.scope === "global");
      const pinName = mapped?.row.pins[0]?.acPin;
      if (!net || !mapped || !pinName || (ground && !isGround)) {
        if (mapped && at) {
          document.drafting ??= { objects: [] };
          document.drafting.objects.push({
            id: deriveStableId("drafting", document.id, level.id, object.id),
            locked: false,
            zIndex: document.drafting.objects.length,
            anchor: { kind: "free", position: placementOf()!.position },
            kind: "floating-symbol",
            symbolId: mapped.row.ac!,
            transform: acOrientation(mapped.orient),
          });
        }
        warn(
          "RNL_IMPORT_GLYPH_AS_PICTURE",
          `${object.id} draws ${object.definition} on ${String(attached)}, which is not ${ground ? "ground" : "a net of this Cell"}; it is drawn as a picture`,
        );
        continue;
      }
      const id = deriveStableId("glyph", document.id, level.id, object.id);
      document.instances.push({
        id,
        symbolId: mapped.row.ac!,
        placement: placementOf(),
      });
      net.terminals.push({ instanceId: id, pinName });
      const supply = supplyMarkerForSymbol(mapped.row.ac!);
      if (supply)
        document.connectivityEvidence.push({
          id: deriveStableId("connectivity-evidence", document.id, id),
          kind: "name-claim",
          netId: net.id,
          owner: { kind: "power-marker", objectId: id },
          powerDomain: supply.domain,
          ...(ground
            ? { name: supply.name, scope: supply.scope }
            : {
                name: named?.name ?? rnlIdName(String(attached), "&") ?? "VDD",
                scope: named?.scope ?? "local",
              }),
        });
      glyphOf.set(object.id, { instanceId: id, pinName });
      continue;
    }
    marks.set(object.definition, (marks.get(object.definition) ?? 0) + 1);
  }

  // Named points that wires meet become junctions, on the net of the first.
  const junctions = new Map<string, Junction>();
  for (const wire of model.wires)
    for (const vertex of wire.via) {
      if (!("point" in vertex) || junctions.has(vertex.point)) continue;
      const point = model.points.find((item) => item.id === vertex.point);
      const netId = wire.nets[0] && netOf(wire.nets[0]);
      if (!point?.at.value || !netId) continue;
      junctions.set(vertex.point, {
        id: deriveStableId("junction", document.id, level.id, vertex.point),
        netId,
        position: snap(acPoint(point.at.value), CORNER_GRID),
      });
    }
  document.junctions.push(...junctions.values());

  // Wires: a route from each pin or point to the next, through its bends.
  const endpointOf = (vertex: RnlSnapshotVertex): RouteEndpoint | null => {
    if ("terminal" in vertex) {
      const terminal = terminalOf(vertex.terminal);
      const instance = terminal && instanceOf(terminal.name);
      const pinName = instance && pinOf(instance, terminal.n);
      return instance && pinName
        ? { kind: "terminal", instanceId: instance.id, pinName }
        : null;
    }
    if ("point" in vertex) {
      const junction = junctions.get(vertex.point);
      return junction ? { kind: "junction", junctionId: junction.id } : null;
    }
    if ("usage" in vertex) {
      const glyph = glyphOf.get(vertex.usage);
      return glyph ? { kind: "terminal", ...glyph } : null;
    }
    return null;
  };
  let skipped = 0;
  /** Each route made, with its corners in Analog Canvas coordinates. */
  const drawn: { route: RouteBranch; corners: { x: number; y: number }[] }[] =
    [];
  model.wires.forEach((wire, wireIndex) => {
    const netId = wire.nets.length === 1 ? netOf(wire.nets[0]!) : undefined;
    if (!netId) {
      skipped += 1;
      return;
    }
    // Every vertex that is a pin or point ends one route and starts the next.
    const runs: number[][] = [];
    let run: number[] = [];
    wire.via.forEach((vertex, index) => {
      run.push(index);
      if (!("at" in vertex) && run.length > 1) {
        runs.push(run);
        run = [index];
      }
    });
    runs.forEach((indices, runIndex) => {
      const vertices = indices.map((index) => wire.via[index]!);
      // A wire of no length joins things that touch; Analog Canvas joins
      // them by touching.
      const places = indices.map((index) => wire.points[index]);
      if (
        places.every(
          (place) =>
            place && place[0] === places[0]![0] && place[1] === places[0]![1],
        )
      )
        return;
      const start = endpointOf(vertices[0]!);
      const end = endpointOf(vertices.at(-1)!);
      if (!start || !end || sameEndpoint(start, end)) {
        skipped += 1;
        return;
      }
      const bends = vertices
        .slice(1, -1)
        .flatMap((vertex) =>
          "at" in vertex ? [snap(acPoint(vertex.at), CORNER_GRID)] : [],
        );
      const id = (part: string, index = 0) =>
        deriveStableId(
          part,
          document.id,
          level.id,
          String(wireIndex),
          String(runIndex),
          String(index),
        );
      const route: RouteBranch = {
        id: id("route"),
        netId,
        start,
        legs: [
          ...bends.map((position, index) => ({
            id: id("leg", index),
            to: { kind: "bend" as const, bendId: id("bend", index), position },
            mode: "manual" as const,
          })),
          {
            id: id("leg", bends.length),
            to: { kind: "endpoint" as const, endpoint: end },
            mode: "manual" as const,
          },
        ],
      };
      document.routes.push(route);
      drawn.push({
        route,
        corners: places.map((place) => acPoint(place!)),
      });
    });
  });
  if (skipped)
    warn(
      "RNL_IMPORT_WIRE_SKIPPED",
      `${skipped} wires end somewhere Analog Canvas cannot name, or join several nets; they are left out`,
    );

  // Marks on wires, and figures.
  const headLength = resolveDocumentStyleProfile(document.presentation)
    .annotations.arrowHeadLength;
  /** The route leg a point lies on, and how far along it. */
  const legAt = (point: { x: number; y: number }) => {
    for (const { route, corners } of drawn)
      for (let index = 0; index + 1 < corners.length; index++) {
        const from = corners[index]!;
        const to = corners[index + 1]!;
        const length = Math.hypot(to.x - from.x, to.y - from.y);
        const along =
          ((point.x - from.x) * (to.x - from.x) +
            (point.y - from.y) * (to.y - from.y)) /
          (length || 1);
        const across =
          ((to.x - from.x) * (point.y - from.y) -
            (to.y - from.y) * (point.x - from.x)) /
          (length || 1);
        if (
          length &&
          Math.abs(across) < NEAR &&
          along > -NEAR &&
          along < length + NEAR
        )
          return { route, corners, index, from, to, length, t: along / length };
      }
    return null;
  };
  for (const object of later) {
    const at = object.at.value ?? null;
    const attached = object.attach?.["p"];
    const place = Array.isArray(attached) ? (attached as Point) : at;
    const orient = object.orient.value ?? "R0";
    if (!place || !isOrient(orient) || orient.startsWith("M")) {
      marks.set(object.definition!, (marks.get(object.definition!) ?? 0) + 1);
      continue;
    }
    const unit = UNIT[orient as "R0" | "R90" | "R180" | "R270"];
    const point = acPoint(place);
    if (object.definition === "$FIGURE") {
      const symbol = object.symbol.value
        ? symbols.get(object.symbol.value)
        : undefined;
      const mapped =
        symbol && acSymbolFor(symbol, orient, { symbolId: "" }, []);
      if (!mapped) {
        marks.set("$FIGURE", (marks.get("$FIGURE") ?? 0) + 1);
        continue;
      }
      document.drafting ??= { objects: [] };
      const position = acPosition(place, mapped.orient, mapped.row.offset);
      document.drafting.objects.push({
        id: deriveStableId("drafting", document.id, level.id, object.id),
        locked: false,
        zIndex: document.drafting.objects.length,
        anchor: { kind: "free", position },
        kind: "floating-symbol",
        symbolId: mapped.row.ac!,
        transform: acOrientation(mapped.orient),
      });
      continue;
    }
    if (object.definition === "$ARROW") {
      // The head's tip, half a head ahead of its point, on the wire.
      const tip = {
        x: point.x + unit.x * (headLength / 2),
        y: point.y + unit.y * (headLength / 2),
      };
      const leg = legAt(tip);
      if (!leg) {
        marks.set("$ARROW", (marks.get("$ARROW") ?? 0) + 1);
        continue;
      }
      const last = leg.corners.at(-1)!;
      const atEnd =
        Math.abs(last.x - tip.x) < NEAR && Math.abs(last.y - tip.y) < NEAR;
      leg.route.styleOverride = {
        ...leg.route.styleOverride,
        arrow: atEnd ? "end" : "middle",
      };
      continue;
    }
    // $CURRENT_ARROW: a current marker on the wire it sits on, its label beside.
    const leg = legAt(point);
    const label = model.texts.find((text) => text.attach === object.id);
    const content = label ? acRichText(label.lines) : null;
    if (!leg || !content) {
      marks.set("$CURRENT_ARROW", (marks.get("$CURRENT_ARROW") ?? 0) + 1);
      continue;
    }
    const dx = (leg.to.x - leg.from.x) / leg.length;
    const dy = (leg.to.y - leg.from.y) / leg.length;
    const along = dx * unit.x + dy * unit.y;
    const labelPoint = acPoint(label!.anchor);
    const normalOffset =
      Math.round(
        ((labelPoint.x - point.x) * -dy + (labelPoint.y - point.y) * dx) * 1e6,
      ) /
        1e6 +
      0;
    document.annotations.push({
      id: deriveStableId("annotation", document.id, level.id, object.id),
      kind: "route-marker",
      content,
      anchor: {
        kind: "route",
        routeId: leg.route.id,
        legId: leg.route.legs[leg.index]!.id,
        t: Math.round(leg.t * 1e9) / 1e9,
        normalOffset: Math.abs(along) > 0.5 ? normalOffset : 0,
        direction: along < 0 ? "reverse" : "forward",
        // An arrow across its wire is the one set level.
        orientation: Math.abs(along) > 0.5 ? "follow" : "horizontal",
        fallbackPosition: point,
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
      markerKind: "current",
    });
  }
  for (const [definition, count] of marks)
    warn(
      "RNL_IMPORT_MARK_SKIPPED",
      `${count} ${definition} marks are not read back yet`,
    );
  if (snapped)
    warn(
      "RNL_IMPORT_SNAPPED",
      `${snapped} places and corners RNL puts off Analog Canvas's grid are moved onto it`,
    );
}

/**
 * Undo a ground pin Analog Canvas added to a Cell: the importer's port and
 * its Cell Pin go, and each call stops passing a node to it.
 */
function removeGroundPin(
  project: CircuitProject,
  document: SchematicDocument,
  terminal: NonNullable<SchematicDocument["netlist"]>["terminals"][number],
): void {
  const pins = new Set(terminal.interfaceInstanceIds);
  document.instances = document.instances.filter(
    (instance) => !pins.has(instance.id),
  );
  for (const net of document.nets)
    net.terminals = net.terminals.filter((item) => !pins.has(item.instanceId));
  document.netlist!.terminals = document.netlist!.terminals.filter(
    (item) => item !== terminal,
  );
  for (const caller of project.documents)
    for (const instance of caller.instances) {
      const binding = instance.netlist?.binding;
      if (
        binding?.kind !== "subcircuit" ||
        binding.childDocumentId !== document.id
      )
        continue;
      for (const net of caller.nets)
        net.terminals = net.terminals.filter(
          (item) =>
            item.instanceId !== instance.id || item.pinName !== terminal.name,
        );
      const provenance = instance.importProvenance;
      if (provenance?.terminalMapping)
        provenance.terminalMapping = provenance.terminalMapping.filter(
          (item) => item.pinName !== terminal.name,
        );
    }
}

type CellSymbol = NonNullable<SchematicDocument["presentation"]["cellSymbol"]>;

/** Analog Canvas's block pins and bodies keep to its 10-unit grid. */
const onGrid = (value: number) => Math.round(value / 10) * 10 + 0;

/** The side of a block a pin leaving at `dir` degrees stands on. */
const SIDE: Readonly<Record<number, "east" | "north" | "west" | "south">> = {
  0: "east",
  90: "north",
  180: "west",
  270: "south",
};

/**
 * A Cell's block layout from the symbol the file defines for it: each pin on
 * the side it leaves by, at its distance along that side, and the body the
 * symbol's centred rectangle draws. Exact for a block Analog Canvas wrote; a
 * symbol drawn otherwise, or off the grid, comes in as the nearest box.
 */
function cellSymbolOf(
  child: SchematicDocument,
  definition: RnlSymbolDefinitionView,
): { cellSymbol: CellSymbol; exact: boolean } {
  const terminals = child.netlist?.terminals ?? [];
  let exact = true;
  const pinPlacements = definition.pins.flatMap((pin) => {
    const key = pin.terminals[0] ?? "";
    const terminal = /^\d+$/u.test(key)
      ? terminals[Number(key) - 1]
      : terminals.find((item) => item.name.toLowerCase() === key.toLowerCase());
    const side = pin.dir === null ? undefined : SIDE[pin.dir];
    if (!terminal || !side) {
      exact = false;
      return [];
    }
    const { x, y } = acPoint(pin.at);
    const along = side === "east" || side === "west" ? y : x;
    if (onGrid(along) !== along) exact = false;
    return [{ terminalId: terminal.id, side, offset: onGrid(along) }];
  });
  const body = definition.prims.find(
    (prim) =>
      prim.shape === "rectangle" &&
      prim.points.length === 1 &&
      prim.points[0]![0] === 0 &&
      prim.points[0]![1] === 0,
  );
  const width = onGrid(Number(body?.params?.["width"]) * 10);
  const height = onGrid(Number(body?.params?.["height"]) * 10);
  if (!body || !(width > 0) || !(height > 0)) exact = false;
  return {
    cellSymbol: {
      pinPlacements,
      ...(body && width > 0 && height > 0
        ? { minimumBodySize: { width, height } }
        : {}),
    },
    exact,
  };
}

/** Marks read once the wires are routes, and figures. */
const LATER = new Set(["$ARROW", "$CURRENT_ARROW", "$FIGURE"]);

/**
 * How near two points are the same, in Analog Canvas units: RNL keeps
 * coordinates to a millionth of its unit, ten of Analog Canvas's.
 */
const NEAR = 1e-3;

/** Analog Canvas grids: a part's place, and a wire's corner or junction. */
const PART_GRID = 10;
const CORNER_GRID = 2;

/** Which way a mark turned by a quarter turn points, in Analog Canvas axes. */
const UNIT = {
  R0: { x: 1, y: 0 },
  R90: { x: 0, y: -1 },
  R180: { x: -1, y: 0 },
  R270: { x: 0, y: 1 },
} as const;

function sameEndpoint(a: RouteEndpoint, b: RouteEndpoint): boolean {
  return a.kind === "junction"
    ? b.kind === "junction" && a.junctionId === b.junctionId
    : b.kind === "terminal" &&
        a.instanceId === b.instanceId &&
        a.pinName === b.pinName;
}
