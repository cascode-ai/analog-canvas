import {
  type CircuitProject,
  type Instance,
  type SchematicDocument,
  type StableId,
} from "@icm/model";

import {
  type RnlLevelSnapshot,
  type LevelModel,
  rnlIdName,
  NEAR,
  type RnlSymbolRef,
} from "./rnl-snapshot.js";
import { type RnlPowerLabelPort } from "./import-pins.js";

export interface RnlImportDiagnostic {
  /** An error leaves the drawing out; a warning keeps what could be drawn. */
  severity: "error" | "warning";
  code: string;
  message: string;
  /** The Cell it is about, when it is about one. */
  documentId?: StableId;
}

/** A parameter the editor keeps that a part's card does not print. */
export interface KeptParameter {
  documentId: StableId;
  instanceId: StableId;
  name: string;
  text: string;
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

/**
 * The text the author wrote for a part's parameter, where the netlist writes
 * the same number otherwise (`$CANVAS_PARAMETER_TEXT`). It belongs to the
 * part, not to the drawing, so it stands whether the drawing does or not.
 */
export interface RnlParameterText {
  documentId: string;
  instanceId: string;
  parameter: string;
  text: string;
}

/** What every level's import adds up, across the project, each item naming its Document. */
export interface ImportRecords {
  diagnostics: RnlImportDiagnostic[];
  hiddenLabels: RnlHiddenLabels[];
  parameterTexts: RnlParameterText[];
  /** The Cell Pins the drawing does not place, each keyed by its Document (`pinKey`): an instance ID is the Document's own. */
  undrawnPins: Set<string>;
  powerLabelPorts: RnlPowerLabelPort[];
  /** The Cells' own names (Canvas 0.4), given once every level is read. */
  cellNames: { documentId: StableId; name: string }[];
  /** Parameters the cards do not print (Canvas 0.4), given back together. */
  keptParameters: KeptParameter[];
}

/**
 * One level's import, scoped to the Cell it draws: every part, net and pin
 * a phase looks up is this Document's own (a name means nothing in another
 * Cell), and every warning is about it.
 */
export interface LevelScope {
  readonly project: CircuitProject;
  readonly document: SchematicDocument;
  readonly level: RnlLevelSnapshot;
  readonly model: LevelModel;
  /** The dialect the file is written in, which spells its names. */
  readonly format: "spice" | "spectre";
  /** The level's symbols by their ids. */
  readonly symbols: ReadonlyMap<string, RnlSymbolRef>;
  warn(code: string, message: string): void;
  /** The Cell's part an RNL card name names. */
  instanceOf(name: string): Instance | undefined;
  /** The Cell's net an RNL net id (`&vout`) names. */
  netOf(id: string): StableId | undefined;
  /** A part's terminal as its Analog Canvas pin, by the import's own mapping. */
  pinOf(instance: Instance, n: number): string | undefined;
  /** A point on Analog Canvas's grid, counted when it moves. */
  snap(point: { x: number; y: number }, grid: number): { x: number; y: number };
  /** How many places and corners `snap` moved. */
  readonly snapped: number;
}

export function levelScope(
  project: CircuitProject,
  document: SchematicDocument,
  level: RnlLevelSnapshot,
  model: LevelModel,
  format: "spice" | "spectre",
  diagnostics: RnlImportDiagnostic[],
): LevelScope {
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
  // The conversion from Spectre also puts a card's designator before a name
  // that lacks it (M1 as XM1 when its master is a subcircuit, a resistor
  // load as Rload); such a card is found by the name after its first letter,
  // where that names one card only.
  const byConvertedName = new Map<string, Instance | null>();
  for (const instance of document.instances) {
    if (instance.id.length < 2) continue;
    const key = instance.id.slice(1).toLowerCase();
    byConvertedName.set(key, byConvertedName.has(key) ? null : instance);
  }
  const instanceOf = (name: string) =>
    document.instances.find((instance) => instance.id === name) ??
    byName.get(name.toLowerCase()) ??
    byReference.get(name.toLowerCase()) ??
    byConvertedName.get(name.toLowerCase()) ??
    undefined;

  // Nets by their RNL name, from the import's own record of the names. A
  // Spectre netlist escapes a name's other characters (`Vin\+`), which the
  // SCS import keeps; RNL names the net it means (`Vin+`).
  const nets = new Map<string, StableId>();
  for (const net of document.importReference?.nets ?? []) {
    nets.set(net.name.toLowerCase(), net.id);
    const plain = net.name.replace(/\\(.)/gu, "$1").toLowerCase();
    if (!nets.has(plain)) nets.set(plain, net.id);
  }
  // RNL reads SPICE's GND as ground, as ngspice does, where the import keeps
  // a Cell's GND as a net of that name (#1784): a wire RNL draws on 0 is on
  // that net, in a Cell that has no 0 of its own.
  const gnd = nets.get("gnd");
  if (!nets.has("0") && gnd !== undefined) nets.set("0", gnd);
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

  return {
    project,
    document,
    level,
    model,
    format,
    symbols,
    warn,
    instanceOf,
    netOf,
    pinOf,
    snap,
    get snapped() {
      return snapped;
    },
  };
}
