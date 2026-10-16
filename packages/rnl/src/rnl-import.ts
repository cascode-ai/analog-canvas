import {
  drawnSwitchControl,
  resolveDocumentStyleProfile,
  richTextMetrics,
  supplyMarkerForSymbol,
} from "@icm/derived";
import { deviceDescriptor } from "@icm/devices";
import {
  deriveStableId,
  flattenRichText,
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
    /** A subcircuit's own symbol, by its id in `symbols`. */
    symbol?: Slot<string>;
    /** The scene's graphics (13.4), in the order written. */
    shapes?: readonly RnlShapeView[];
  };
}

export interface RnlShapeView {
  id: string;
  /** line, rectangle, circle, ellipse, arc or bezier. */
  shape: string;
  /** A centred shape's centre, else its points. */
  points: readonly Point[];
  params: Readonly<Record<string, string | number>>;
  style: Readonly<Record<string, string | number | boolean>>;
  /** bottom, middle or top. */
  layer: string;
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

/** What closes a switch Analog Canvas draws: the phase its label names, its CTRL pin, or a chopper's clock. */
const switchControl = (symbolId: string) => {
  const definition = deviceDescriptor(symbolId);
  return definition ? drawnSwitchControl(definition) : null;
};

/** Whether a part is clocked by the phase its label names, as switches and choppers are. */
const clockedByLabel = (instance: Pick<Instance, "symbolId">) => {
  const control = switchControl(instance.symbolId);
  return control === "phase" || control === "chopper";
};

/**
 * The symbol of a switch the netlist import brought in with a CTRL pin that
 * RNL draws as one its label clocks: every switch Analog Canvas draws prints
 * the same card, so only the drawing says which it was.
 */
function phaseSwitchSymbol(
  symbol: RnlSymbolRef,
  orient: RnlOrient,
  instance: Pick<Instance, "symbolId">,
): { row: RnlSymbol; orient: RnlOrient } | null {
  if (switchControl(instance.symbolId) !== "pin") return null;
  const found = acSymbolFor(symbol, orient, instance, ["1", "2"]);
  return found?.row.ac && switchControl(found.row.ac) === "phase"
    ? found
    : null;
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
): {
  project: CircuitProject;
  diagnostics: RnlImportDiagnostic[];
  hiddenLabels: RnlHiddenLabels[];
} {
  const diagnostics: RnlImportDiagnostic[] = [];
  const hiddenLabels: RnlHiddenLabels[] = [];
  if (snapshot.failed) {
    diagnostics.push({
      severity: "error",
      code: "RNL_IMPORT_UNREADABLE",
      message: `RNL could not read the file: ${snapshot.failed}`,
    });
    return { project, diagnostics, hiddenLabels };
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
    applyLevel(next, document, level, level.model, diagnostics, hiddenLabels);
  }
  return { project: next, diagnostics, hiddenLabels };
}

/**
 * A part the drawing places but shows without its name, its values or both.
 * A file Analog Canvas writes shows each label it showed and clears those its
 * standard symbols bring, so a label missing from the drawing was hidden.
 */
export interface RnlHiddenLabels {
  documentId: string;
  instanceId: string;
  name: boolean;
  values: boolean;
}

function applyLevel(
  project: CircuitProject,
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  model: NonNullable<RnlLevelSnapshot["model"]>,
  diagnostics: RnlImportDiagnostic[],
  hiddenLabels: RnlHiddenLabels[],
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
  // A card the conversion from Spectre renamed (S1 as XS1) is found by the
  // part's reference, which the import keeps as the card was written.
  const byReference = new Map(
    document.instances.flatMap((instance) =>
      instance.reference
        ? [[instance.reference.toLowerCase(), instance] as const]
        : [],
    ),
  );
  const instanceOf = (name: string) =>
    document.instances.find((instance) => instance.id === name) ??
    byName.get(name.toLowerCase()) ??
    byReference.get(name.toLowerCase());

  /**
   * A switch the import brought in with a CTRL pin, drawn as one its label
   * clocks: its switched pins are 1 and 2, and the net its CTRL pin met is
   * the phase its label names (`phaseNets`); a net nothing else meets goes.
   */
  const phaseNets = new Map<string, string>();
  const clockByLabel = (instance: Instance) => {
    const pins: Readonly<Record<string, string>> = { P: "1", N: "2" };
    const controls = new Set<string>();
    for (const net of document.nets) {
      net.terminals = net.terminals.flatMap((terminal) => {
        if (terminal.instanceId !== instance.id) return [terminal];
        if (terminal.pinName === "CTRL") {
          controls.add(net.id);
          return [];
        }
        const pinName = pins[terminal.pinName];
        return [pinName ? { ...terminal, pinName } : terminal];
      });
    }
    for (const id of controls) {
      const name = document.importReference?.nets.find(
        (item) => item.id === id,
      )?.name;
      if (name) phaseNets.set(instance.id, name);
    }
    const emptied = new Set(
      document.nets
        .filter((net) => controls.has(net.id) && !net.terminals.length)
        .map((net) => net.id),
    );
    document.nets = document.nets.filter((net) => !emptied.has(net.id));
    document.connectivityEvidence = document.connectivityEvidence.filter(
      (evidence) => !emptied.has(evidence.netId),
    );
    const provenance = instance.importProvenance;
    if (provenance?.terminalMapping)
      provenance.terminalMapping = provenance.terminalMapping.flatMap(
        (entry) => {
          const pinName = pins[entry.pinName];
          return pinName ? [{ ...entry, pinName }] : [];
        },
      );
  };

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

  // The Cell's own block, as its level's symbol draws it (9.2.6), or as a
  // call of it is drawn.
  const laidOut = new Set<string>();
  const layOut = (
    cell: SchematicDocument,
    definition: RnlSymbolDefinitionView,
  ) => {
    if (laidOut.has(cell.id)) return;
    laidOut.add(cell.id);
    const layout = cellSymbolOf(cell, definition);
    cell.presentation.cellSymbol = layout.cellSymbol;
    if (!layout.exact)
      warn(
        "RNL_IMPORT_BLOCK_APPROXIMATE",
        `${cell.name}'s block is drawn as a box: RNL draws it otherwise, or off the grid`,
      );
  };
  const own = model.symbol?.value ? symbols.get(model.symbol.value) : null;
  if (own?.definition) layOut(document, own.definition);

  // Parts: placed, turned and in the variant their symbol stands for.
  const unplaced: string[] = [];
  const placed: Instance[] = [];
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
        ? (acSymbolFor(symbol, orient, instance, pinNames) ??
          phaseSwitchSymbol(symbol, orient, instance))
        : null;
    if (symbol && !mapped && !symbol.default && !symbol.level)
      warn(
        "RNL_IMPORT_UNMAPPED_SYMBOL",
        `${instance.id} is drawn with ${symbol.name}, which Analog Canvas has no symbol for; it keeps its own`,
      );
    if (mapped) {
      const pinSwitch = switchControl(instance.symbolId) === "pin";
      instance.symbolId = mapped.row.ac!;
      if (mapped.row.variant) instance.symbolVariantId = mapped.row.variant;
      else delete instance.symbolVariantId;
      if (pinSwitch && switchControl(instance.symbolId) === "phase")
        clockByLabel(instance);
    }
    const turn = mapped?.orient ?? orient;
    instance.placement = {
      position: snap(
        acPosition(at, turn, mapped?.row.offset ?? [0, 0]),
        PART_GRID,
      ),
      ...acOrientation(turn),
    };
    placed.push(instance);
    // A Cell's call drawn with the symbol the file defines for it: the
    // Cell's block takes that layout, its pins where the symbol has them.
    const binding = instance.netlist?.binding;
    const child =
      symbol?.definition && binding?.kind === "subcircuit"
        ? project.documents.find((item) => item.id === binding.childDocumentId)
        : undefined;
    if (child && symbol?.definition) layOut(child, symbol.definition);
  }
  if (unplaced.length)
    warn(
      "RNL_IMPORT_UNPLACED",
      `${unplaced.length} parts have no place in the RNL and stay on the shelf: ${unplaced.join(", ")}`,
    );
  // The labels the drawing shows on each part it places, written or its
  // symbol's own; whatever it does not show stays hidden.
  const shows = new Map<string, { name: boolean; values: boolean }>();
  for (const text of model.texts) {
    const part = text.attach ? rnlIdName(text.attach, "#") : null;
    const instance = part === null ? undefined : instanceOf(part);
    if (!instance || !acRichText(text.lines)) continue;
    const shown = shows.get(instance.id) ?? { name: false, values: false };
    if (text.key === "name") shown.name = true;
    else if (
      text.key === "value" ||
      (text.key && instance.netlist?.parameters[text.key] !== undefined)
    )
      shown.values = true;
    shows.set(instance.id, shown);
  }
  for (const instance of placed) {
    const shown = shows.get(instance.id);
    if (!shown?.name || !shown.values)
      hiddenLabels.push({
        documentId: document.id,
        instanceId: instance.id,
        name: !shown?.name,
        values: !shown?.values,
      });
  }

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
      // The same port drawn again: one more Cell terminal of the port's name,
      // which joins it in the one port the netlist prints.
      const drawn = document.netlist?.terminals.find(
        (item) => item.netId === netId,
      );
      if (object.definition === "$IO_PORT" && drawn && netId) {
        const id = deriveStableId("cell-pin", document.id, level.id, object.id);
        document.instances.push({
          id,
          symbolId: mapped?.row.ac ?? "port",
          placement: placementOf(),
        });
        document.nets
          .find((item) => item.id === netId)
          ?.terminals.push({ instanceId: id, pinName: "P" });
        document.netlist!.terminals.push({
          id: deriveStableId("cell-terminal", document.id, level.id, object.id),
          name: drawn.name,
          netId,
          direction: drawn.direction,
          interfaceInstanceIds: [id],
        });
        movedPins.add(id);
        glyphOf.set(object.id, { instanceId: id, pinName: "P" });
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

  // Marks on wires, and figures. A current marker's label is the marker's.
  const consumed = new Set<string>();
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
    consumed.add(label!.id);
  }
  for (const [definition, count] of marks)
    warn(
      "RNL_IMPORT_MARK_SKIPPED",
      `${count} ${definition} marks are not read back yet`,
    );

  // Voltage markers: a label on a wire with + and − beside it, where
  // Analog Canvas puts them, is the marker it wrote.
  const polarity = resolveDocumentStyleProfile(
    document.presentation,
  ).annotations;
  const plainText = (text: RnlTextView) => {
    const run = text.lines.length === 1 ? text.lines[0]![0] : undefined;
    return text.lines[0]!.length === 1 && run?.kind === "text"
      ? run.text
      : null;
  };
  const signs = model.texts.filter(
    (text) =>
      text.attach === null &&
      text.written &&
      ["+", "−", "-"].includes(plainText(text) ?? ""),
  );
  for (const text of model.texts) {
    if (text.attach !== null || !text.written || signs.includes(text)) continue;
    const point = acPoint(text.anchor);
    const leg = legAt(point);
    const content = acRichText(text.lines);
    if (!leg || !content) continue;
    const angle =
      (Math.atan2(leg.to.y - leg.from.y, leg.to.x - leg.from.x) * 180) /
      Math.PI;
    for (const way of [
      { rotation: angle, direction: "forward", orientation: "follow" },
      { rotation: angle + 180, direction: "reverse", orientation: "follow" },
      { rotation: 0, direction: "forward", orientation: "horizontal" },
    ] as const) {
      const besideAt = (side: number) => {
        const offset = turnedBy(
          { x: -polarity.polarityOffsetX, y: side * polarity.polarityHalfGap },
          way.rotation,
        );
        return { x: point.x + offset.x, y: point.y + offset.y + 4 };
      };
      const signAt = (place: { x: number; y: number }, plus: boolean) =>
        signs.find((sign) => {
          const at = acPoint(sign.anchor);
          return (
            !consumed.has(sign.id) &&
            (plainText(sign) === "+") === plus &&
            Math.abs(at.x - place.x) < 0.6 &&
            Math.abs(at.y - place.y) < 0.6
          );
        });
      const plus = signAt(besideAt(-1), true);
      const minus = signAt(besideAt(1), false);
      if (!plus || !minus) continue;
      document.annotations.push({
        id: deriveStableId("annotation", document.id, level.id, text.id),
        kind: "route-marker",
        content,
        anchor: {
          kind: "route",
          routeId: leg.route.id,
          legId: leg.route.legs[leg.index]!.id,
          t: Math.round(leg.t * 1e9) / 1e9,
          normalOffset: 0,
          direction: way.direction,
          orientation: way.orientation,
          fallbackPosition: point,
        },
        alignment: (["start", "middle", "end"].includes(text.halign)
          ? text.halign
          : "middle") as "start" | "middle" | "end",
        rotation: 0,
        locked: false,
        markerKind: "voltage",
      });
      consumed.add(text.id);
      consumed.add(plus.id);
      consumed.add(minus.id);
      break;
    }
  }

  importTexts(document, level, model, {
    consumed,
    glyphOf,
    instanceOf,
    netOf,
  });
  // A label the drawing does not show still names a part's clock: the one
  // the import gave it stays, hidden; a switch that had a CTRL pin takes the
  // name of the net that pin met.
  for (const instance of placed) {
    if (!clockedByLabel(instance) || shows.get(instance.id)?.name) continue;
    const own = document.annotations.find(
      (item) =>
        item.kind === "instance-label" &&
        !item.binding &&
        item.anchor.kind === "object" &&
        item.anchor.objectId === instance.id,
    );
    if (own) {
      own.visible = false;
      continue;
    }
    const phase = phaseNets.get(instance.id);
    const at = instance.placement?.position;
    if (!phase || phase === instance.reference || !at) continue;
    document.annotations.push({
      id: `instance-label-${instance.id}`,
      kind: "instance-label",
      content: { runs: [{ kind: "text", value: phase }] },
      anchor: {
        kind: "object",
        objectId: instance.id,
        localOffset: { x: 0, y: -4 * PART_GRID },
        fallbackPosition: { x: at.x, y: at.y - 4 * PART_GRID },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
      visible: false,
    });
  }
  const unread = importShapes(document, level, model.shapes ?? []);
  if (unread)
    warn(
      "RNL_IMPORT_SHAPE_SKIPPED",
      `${unread} ellipses and arcs are not read back yet`,
    );
  if (snapped)
    warn(
      "RNL_IMPORT_SNAPPED",
      `${snapped} places and corners RNL puts off Analog Canvas's grid are moved onto it`,
    );
}

/**
 * The texts a level's RNL writes, as Analog Canvas labels and texts: a
 * part's name and values as its bound labels, a Cell Pin's name as its pin
 * label, a net's as a net label claiming the net by its own name, anything
 * else as a drawing text. Each stands where RNL puts it, on its baseline;
 * a label its symbol alone gives is left to the symbol.
 */
function importTexts(
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  model: NonNullable<RnlLevelSnapshot["model"]>,
  {
    consumed,
    glyphOf,
    instanceOf,
    netOf,
  }: {
    consumed: ReadonlySet<string>;
    glyphOf: ReadonlyMap<string, { instanceId: string; pinName: string }>;
    instanceOf: (name: string) => Instance | undefined;
    netOf: (id: string) => string | undefined;
  },
): void {
  const profile = resolveDocumentStyleProfile(document.presentation);
  const scaled = (size: number | null, base: number) => {
    const scale = size === null ? 1 : (size * AC_UNITS_PER_RNL_UNIT) / base;
    return Math.abs(scale - 1) > 1e-3
      ? { sizeScale: Math.round(scale * 1e4) / 1e4 }
      : {};
  };
  const labelled = new Set(
    document.annotations.flatMap((item) =>
      item.anchor.kind === "object" ? [item.anchor.objectId] : [],
    ),
  );
  model.texts.forEach((text, index) => {
    if (!text.written || consumed.has(text.id)) return;
    const content = acRichText(text.lines);
    if (!content) return;
    // Labels and texts stand on whole units.
    const exact = acPoint(text.anchor);
    const at = { x: Math.round(exact.x) + 0, y: Math.round(exact.y) + 0 };
    const id = deriveStableId("annotation", document.id, level.id, text.id);
    const rotation = ((360 - text.rotate) % 360) as 0 | 90 | 180 | 270;
    const alignment = (
      ["start", "middle", "end"].includes(text.halign) ? text.halign : "start"
    ) as "start" | "middle" | "end";
    const color =
      typeof text.style["textcolor"] === "string"
        ? { textColor: text.style["textcolor"] }
        : {};
    const shown = flattenRichText(content);
    const onObject = (instance: Instance) =>
      instance.placement
        ? {
            kind: "object" as const,
            objectId: instance.id,
            localOffset: {
              x: at.x - instance.placement.position.x,
              y: at.y - instance.placement.position.y,
            },
            fallbackPosition: at,
          }
        : { kind: "free" as const, position: at };
    const common = {
      alignment,
      rotation,
      locked: false,
      ...color,
    };

    // A part's labels, bound to its name or values.
    const part = text.attach && rnlIdName(text.attach, "#");
    const instance = part ? instanceOf(part) : undefined;
    const glyph = text.attach ? glyphOf.get(text.attach) : undefined;
    const pin = glyph && instanceOf(glyph.instanceId);
    const terminal = pin
      ? document.netlist?.terminals.find((item) =>
          item.interfaceInstanceIds.includes(pin.id),
        )
      : undefined;
    // A switch or chopper is clocked by the phase its label names: the label
    // holds that text itself, in place of one the import gave it.
    if (instance && text.key === "name" && clockedByLabel(instance)) {
      document.annotations = document.annotations.filter(
        (item) =>
          !(
            item.kind === "instance-label" &&
            !item.binding &&
            item.anchor.kind === "object" &&
            item.anchor.objectId === instance.id
          ),
      );
      labelled.add(instance.id);
      document.annotations.push({
        id: `instance-label-${instance.id}`,
        kind: "instance-label",
        content,
        anchor: onObject(instance),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }
    if (instance && text.key === "name" && !labelled.has(instance.id)) {
      labelled.add(instance.id);
      document.annotations.push({
        id: `instance-label-${instance.id}`,
        kind: "instance-label",
        binding: { kind: "instance-reference", instanceId: instance.id },
        ...(shown === instance.reference ? { formatOverride: content } : {}),
        anchor: onObject(instance),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }
    const parameter =
      text.key && text.key !== "value" && text.key !== "name"
        ? text.key
        : undefined;
    if (
      instance &&
      (text.key === "value" ||
        (parameter && instance.netlist?.parameters[parameter] !== undefined))
    ) {
      document.annotations.push({
        id,
        kind: "instance-value",
        binding: {
          kind: "instance-value",
          instanceId: instance.id,
          ...(parameter ? { parameter } : {}),
        },
        anchor: onObject(instance),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }
    if (pin && terminal && text.key === "name" && !labelled.has(pin.id)) {
      labelled.add(pin.id);
      document.annotations.push({
        id: `instance-label-${pin.id}`,
        kind: "instance-label",
        binding: { kind: "cell-terminal-name", terminalId: terminal.id },
        ...(shown === terminal.name ? { formatOverride: content } : {}),
        anchor: onObject(pin),
        ...common,
        ...scaled(text.size, profile.typography.instanceFontSize),
      });
      return;
    }

    // A net's label: the net named by its own name, which it already has.
    const netId = text.attach ? netOf(text.attach) : undefined;
    const named = document.importReference?.nets.find(
      (item) => item.id === netId,
    );
    if (netId && named) {
      document.annotations.push({
        id,
        kind: "net-label",
        binding: { kind: "net-name", netId },
        netId,
        ...(shown === named.name ? { formatOverride: content } : {}),
        anchor: { kind: "free", position: at },
        ...common,
        ...scaled(text.size, profile.typography.netFontSize),
      });
      document.connectivityEvidence.push({
        id: deriveStableId("connectivity-evidence", document.id, id),
        kind: "name-claim",
        netId,
        name: named.name,
        owner: { kind: "net-label", annotationId: id },
        scope: named.scope,
      });
      return;
    }

    // Anything else is a drawing text, bold unless RNL sets it plain.
    document.drafting ??= { objects: [] };
    const bold = text.style["bold"] === true || boldThroughout(text.lines);
    document.drafting.objects.push({
      id: deriveStableId(
        "drafting",
        document.id,
        level.id,
        text.id,
        String(index),
      ),
      locked: false,
      zIndex: document.drafting.objects.length,
      anchor: { kind: "free", position: at },
      kind: "text",
      content,
      alignment,
      rotation,
      ...(bold && !text.style["italic"] && !color.textColor && !text.size
        ? {}
        : {
            styleOverride: {
              ...(bold ? {} : { weight: "normal" as const }),
              ...(text.style["italic"] === true ? { italic: true } : {}),
              ...(color.textColor ? { color: color.textColor } : {}),
              ...scaled(text.size, richTextMetrics(profile).fontSize),
            },
          }),
    });
  });
}

/**
 * The scene's graphics as drawing objects, in the order RNL draws them: a
 * rectangle or circle as one, a closed line that is a turned rectangle as a
 * turned rectangle, a line or curve with an arrow as an arrow, any other as
 * a construction line (a cubic leg as the quadratic it was raised from, or
 * the nearest one). The bottom layer is the background plane. Ellipses and
 * arcs are not read yet; the count of them is returned.
 */
function importShapes(
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  shapes: readonly RnlShapeView[],
): number {
  if (!shapes.length) return 0;
  const profile = resolveDocumentStyleProfile(document.presentation);
  let unread = 0;
  document.drafting ??= { objects: [] };
  const objects = document.drafting.objects;
  const whole = ([x, y]: Point) => {
    const point = acPoint([x, y]);
    return { x: Math.round(point.x) + 0, y: Math.round(point.y) + 0 };
  };
  for (const shape of shapes) {
    const style = shape.style;
    const lineStyle =
      style["linestyle"] === "dashed" || style["linestyle"] === "dotted"
        ? style["linestyle"]
        : "solid";
    const color =
      typeof style["linecolor"] === "string" ? style["linecolor"] : undefined;
    const fillColor =
      shape.params["fill"] === "fillcolor" &&
      typeof style["fillcolor"] === "string"
        ? style["fillcolor"]
        : shape.params["fill"] === "linecolor"
          ? (color ?? profile.foreground)
          : undefined;
    const width = Number(style["linewidth"]);
    const strokeScale =
      width > 0
        ? Math.min(
            4,
            Math.max(
              0.25,
              (width * AC_UNITS_PER_RNL_UNIT) / profile.strokes.annotation,
            ),
          )
        : undefined;
    const styleOverride = {
      ...(color ? { color } : {}),
      ...(strokeScale && Math.abs(strokeScale - 1) > 1e-3
        ? { strokeScale: Math.round(strokeScale * 1e3) / 1e3 }
        : {}),
    };
    const base = (anchor: { x: number; y: number }) => ({
      id: deriveStableId("drafting", document.id, level.id, shape.id),
      locked: false,
      zIndex: objects.length,
      anchor: { kind: "free" as const, position: anchor },
    });
    const layer =
      shape.layer === "bottom" ? { layer: "background" as const } : {};
    const filled = fillColor ? { fillColor } : {};
    const points = shape.points.map(whole);
    if (shape.shape === "rectangle" || shape.shape === "circle") {
      const center = points[0]!;
      const size = (key: string) =>
        Math.max(
          1,
          Math.round(Number(shape.params[key]) * AC_UNITS_PER_RNL_UNIT),
        );
      objects.push(
        shape.shape === "rectangle"
          ? {
              ...base(center),
              kind: "rectangle",
              center,
              width: size("width"),
              height: size("height"),
              rotation: 0,
              lineStyle,
              ...layer,
              styleOverride: { ...styleOverride, ...filled },
            }
          : {
              ...base(center),
              kind: "circle",
              center,
              radius: size("radius"),
              lineStyle,
              ...layer,
              styleOverride: { ...styleOverride, ...filled },
            },
      );
      continue;
    }
    if (shape.shape !== "line" && shape.shape !== "bezier") {
      unread += 1;
      continue;
    }
    const turned =
      shape.shape === "line"
        ? turnedRectangle(shape.points.map((point) => acPoint(point)))
        : null;
    if (turned) {
      objects.push({
        ...base(turned.center),
        kind: "rectangle",
        ...turned,
        lineStyle,
        ...layer,
        styleOverride: { ...styleOverride, ...filled },
      });
      continue;
    }
    const path =
      shape.shape === "bezier"
        ? quadraticPath(points)
        : { points, controls: [] as ({ x: number; y: number } | null)[] };
    const arrow = String(shape.params["arrow"] ?? "none");
    if (arrow !== "none" && path.points.length >= 2) {
      const ends = {
        ...(arrow === "start" || arrow === "both"
          ? { arrowStart: "medium-arrow" as const }
          : {}),
        ...(arrow === "end" || arrow === "both"
          ? { arrowEnd: "medium-arrow" as const }
          : { arrowEnd: "none" as const }),
      };
      objects.push({
        ...base(path.points[0]!),
        kind: "arrow",
        from: { kind: "free", position: path.points[0]! },
        to: { kind: "free", position: path.points.at(-1)! },
        ...(path.points.length > 2
          ? { waypoints: path.points.slice(1, -1) }
          : {}),
        ...(path.controls.some(Boolean)
          ? { curveControls: path.controls }
          : {}),
        styleOverride: { ...styleOverride, ...ends },
      });
      continue;
    }
    objects.push({
      ...base(path.points[0]!),
      kind: "construction-line",
      points: path.points,
      ...(path.controls.some(Boolean) ? { curveControls: path.controls } : {}),
      lineStyle,
      ...(Object.keys(styleOverride).length ? { styleOverride } : {}),
    });
  }
  return unread;
}

/** A closed line round four right-angled corners, as a turned rectangle. */
function turnedRectangle(points: readonly { x: number; y: number }[]): {
  center: { x: number; y: number };
  width: number;
  height: number;
  rotation: number;
} | null {
  if (points.length !== 5) return null;
  const [a, b, c, d, e] = points as [
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
    { x: number; y: number },
  ];
  if (Math.abs(a.x - e.x) > 1 || Math.abs(a.y - e.y) > 1) return null;
  const side = (p: typeof a, q: typeof a) => ({ x: q.x - p.x, y: q.y - p.y });
  const ab = side(a, b);
  const bc = side(b, c);
  const cd = side(c, d);
  const right = (u: typeof ab, v: typeof ab) =>
    Math.abs(u.x * v.x + u.y * v.y) <=
    2 * (Math.hypot(u.x, u.y) + Math.hypot(v.x, v.y));
  if (
    !right(ab, bc) ||
    !right(bc, cd) ||
    Math.abs(ab.x + cd.x) > 2 ||
    Math.abs(ab.y + cd.y) > 2
  )
    return null;
  const width = Math.round(Math.hypot(ab.x, ab.y));
  const height = Math.round(Math.hypot(bc.x, bc.y));
  if (!width || !height) return null;
  const degrees = (Math.atan2(ab.y, ab.x) * 180) / Math.PI;
  return {
    center: {
      x: Math.round((a.x + c.x) / 2) + 0,
      y: Math.round((a.y + c.y) / 2) + 0,
    },
    width,
    height,
    rotation: Math.round(((degrees % 360) + 360) % 360) % 360,
  };
}

/**
 * A cubic Bézier path as Analog Canvas's: its ends, each leg's quadratic
 * control (null for a straight leg), the one a raised quadratic came from
 * or the nearest.
 */
function quadraticPath(points: readonly { x: number; y: number }[]): {
  points: { x: number; y: number }[];
  controls: ({ x: number; y: number } | null)[];
} {
  const ends = [points[0]!];
  const controls: ({ x: number; y: number } | null)[] = [];
  for (let index = 0; index + 3 < points.length; index += 3) {
    const [from, c1, c2, to] = points.slice(index, index + 4) as [
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
      { x: number; y: number },
    ];
    const third = (t: number) => ({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    });
    const near = (p: typeof from, q: typeof from) =>
      Math.abs(p.x - q.x) <= 1 && Math.abs(p.y - q.y) <= 1;
    const straight = near(c1, third(1 / 3)) && near(c2, third(2 / 3));
    ends.push(to);
    controls.push(
      straight
        ? null
        : {
            x:
              Math.round(
                (from.x + 1.5 * (c1.x - from.x) + to.x + 1.5 * (c2.x - to.x)) /
                  2,
              ) + 0,
            y:
              Math.round(
                (from.y + 1.5 * (c1.y - from.y) + to.y + 1.5 * (c2.y - to.y)) /
                  2,
              ) + 0,
          },
    );
  }
  return { points: ends, controls };
}

/** Whether every run of a text is bold, as a drawing text is by default. */
function boldThroughout(lines: readonly (readonly RnlRun[])[]): boolean {
  const runs = lines.flat();
  return runs.length > 0 && runs.every((run) => run.style.bold);
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

/** An offset turned clockwise by `rotation` degrees, y down, as Analog Canvas turns. */
function turnedBy(
  offset: { x: number; y: number },
  rotation: number,
): { x: number; y: number } {
  const radians = (rotation * Math.PI) / 180;
  return {
    x: offset.x * Math.cos(radians) - offset.y * Math.sin(radians),
    y: offset.x * Math.sin(radians) + offset.y * Math.cos(radians),
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
