import { createReferenceIndex } from "@icm/devices";
import { type Instance, type SchematicDocument } from "@icm/model";
import { externalSubcircuitSymbolId } from "@icm/symbols";

import { callSymbolFromDefinition } from "./call-symbols.js";
import { acOrientation } from "./orientation.js";
import { acPosition } from "./place.js";
import { RNL_SYMBOLS } from "./symbol-map.js";
import { acRichText } from "./text.js";
import {
  type RnlSymbolDefinitionView,
  rnlIdName,
  isOrient,
  PART_GRID,
} from "./rnl-snapshot.js";
import {
  acSymbolFor,
  switchControl,
  clockedByLabel,
  phaseSwitchSymbol,
  gateCallSymbol,
  paintOf,
  cellSymbolOf,
  cellArtwork,
  externalArtwork,
} from "./import-symbols.js";
import { type LevelScope, type RnlHiddenLabels } from "./import-scope.js";

/** The parts a level places, and what the drawing shows of each. */
export interface PlacedParts {
  placed: Instance[];
  /** The labels the drawing shows on each part, by its id. */
  shows: ReadonlyMap<string, { name: boolean; values: boolean }>;
  /** A switch's phase, by its id: the net its CTRL pin met. */
  phaseNets: ReadonlyMap<string, string>;
  /** The placed parts the drawing shows without their name, their values or both. */
  hiddenLabels: RnlHiddenLabels[];
}

/**
 * Gives a part a name where that gives it no Reference issue it does not
 * have already: no other part of the Cell has it, as SPICE compares names
 * without case, and the part takes names of its prefix (a call of a Cell
 * keeps its X). Else the part keeps its name, and this returns the issues
 * the name would give it.
 */
export function nameIfFree(
  { project, document }: LevelScope,
  instance: Instance,
  name: string,
): string[] {
  const issues = () =>
    new Set(
      createReferenceIndex(document, project)
        .issues.filter((issue) => issue.instanceId === instance.id)
        .map((issue) => issue.code),
    );
  const before = issues();
  const printed = instance.reference;
  instance.reference = name;
  const after = [...issues()].filter((code) => !before.has(code));
  if (after.length) {
    if (printed === undefined) delete instance.reference;
    else instance.reference = printed;
  }
  return after;
}

/**
 * The level's parts, placed, turned and in the variant their symbol stands
 * for, and the Cells' blocks their symbols lay out: the Cell's own, and
 * those of the Cells its calls draw with the symbol the file defines.
 */
export function placeParts(scope: LevelScope): PlacedParts {
  const { project, document, model, symbols, warn, instanceOf, snap } = scope;
  const hiddenLabels: RnlHiddenLabels[] = [];
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

  /** Renames a part's pins, wherever the import has them, by `names`. */
  const renamePins = (
    instance: Instance,
    names: ReadonlyMap<string, string>,
  ) => {
    const rename = <T extends { instanceId: string; pinName: string }>(
      terminal: T,
    ): T =>
      terminal.instanceId === instance.id && names.has(terminal.pinName)
        ? { ...terminal, pinName: names.get(terminal.pinName)! }
        : terminal;
    for (const net of document.nets) net.terminals = net.terminals.map(rename);
    for (const net of document.importReference?.nets ?? [])
      net.terminals = net.terminals.map((terminal) =>
        "pinName" in terminal ? rename(terminal) : terminal,
      );
    const provenance = instance.importProvenance;
    if (provenance?.terminalMapping)
      provenance.terminalMapping = provenance.terminalMapping.map((entry) =>
        names.has(entry.pinName)
          ? { ...entry, pinName: names.get(entry.pinName)! }
          : entry,
      );
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
    const artwork = cellArtwork(cell, definition);
    if (artwork)
      project.componentDefinitions = [
        ...(project.componentDefinitions ?? []).filter(
          (item) => item.symbol.id !== artwork.symbol.id,
        ),
        artwork,
      ];
    else if (!layout.exact)
      warn(
        "RNL_IMPORT_BLOCK_APPROXIMATE",
        `${cell.name}'s block is drawn as a box: RNL draws it otherwise, or off the grid`,
      );
  };
  const drawnExternals = new Set<string>();
  const drawExternal = (
    definitionId: string,
    drawn: RnlSymbolDefinitionView,
  ) => {
    if (drawnExternals.has(definitionId)) return;
    drawnExternals.add(definitionId);
    const definition = project.externalSubcircuitDefinitions.find(
      (item) => item.id === definitionId,
    );
    const artwork = definition && externalArtwork(definition, drawn);
    if (!artwork) return;
    project.componentDefinitions = [
      ...(project.componentDefinitions ?? []).filter(
        (item) => item.symbol.id !== artwork.symbol.id,
      ),
      artwork,
    ];
  };
  const own = model.symbol?.value ? symbols.get(model.symbol.value) : null;
  if (own?.definition) layOut(document, own.definition);

  // Parts: placed, turned and in the variant their symbol stands for.
  const unplaced: string[] = [];
  const placed: Instance[] = [];
  // The symbol each part is drawn as, where the file names it (Canvas 0.4).
  const variantOf = new Map(
    model.objects.flatMap((object) => {
      const part = object.attach?.["part"];
      const symbol = object.params?.["symbol"];
      const card = typeof part === "string" ? rnlIdName(part, "#") : null;
      return object.kind === "usage" &&
        object.definition === "$CANVAS_VARIANT" &&
        card !== null &&
        typeof symbol === "string"
        ? [[card.toLowerCase(), symbol] as const]
        : [];
    }),
  );
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
    const gateCall =
      symbol && !symbol.default
        ? gateCallSymbol(symbol, orient, instance)
        : null;
    // A called block's call symbol draws the block the part already is.
    const blockCall =
      symbol && !symbol.default && !gateCall
        ? callSymbolFromDefinition(symbol)
        : null;
    const mapped =
      gateCall ??
      (blockCall?.ac === instance.symbolId
        ? { row: blockCall, orient }
        : null) ??
      (symbol && !symbol.default
        ? (acSymbolFor(
            symbol,
            orient,
            instance,
            pinNames,
            name === null ? undefined : variantOf.get(name.toLowerCase()),
          ) ?? phaseSwitchSymbol(symbol, orient, instance))
        : null);
    if (
      symbol &&
      !mapped &&
      !symbol.default &&
      (!symbol.level ||
        symbol.name.startsWith("$CANVAS_CALL_") ||
        RNL_SYMBOLS.some((row) => row.inline && row.symbol === symbol.name))
    )
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
      // A gate's call, or a symbol taken by terminal, renames the part's pins.
      if (mapped.pins) renamePins(instance, mapped.pins);
    }
    // A Spectre card the conversion named for SPICE, which starts a card
    // with its element's letter (a subcircuit call M1 as XM1, the ammeter's
    // vsource A1 as VA1), has its Spectre name again where the part as drawn
    // can have it.
    if (
      name !== null &&
      instance.reference !== undefined &&
      instance.reference.length === name.length + 1 &&
      /^[a-z]/iu.test(instance.reference) &&
      instance.reference.slice(1).toLowerCase() === name.toLowerCase()
    )
      nameIfFree(scope, instance, name);
    const turn = mapped?.orient ?? orient;
    instance.placement = {
      position: snap(
        acPosition(at, turn, mapped?.row.offset ?? [0, 0]),
        PART_GRID,
      ),
      ...acOrientation(turn),
    };
    Object.assign(instance, paintOf(object));
    placed.push(instance);
    // A Cell's call drawn with the symbol the file defines for it: the
    // Cell's block takes that layout, its pins where the symbol has them.
    // A gate's call symbol draws the gate, not the Cell's block.
    const binding = instance.netlist?.binding;
    const child =
      symbol?.definition && !gateCall && binding?.kind === "subcircuit"
        ? project.documents.find((item) => item.id === binding.childDocumentId)
        : undefined;
    if (child && symbol?.definition) layOut(child, symbol.definition);
    // An external subcircuit's call drawn with the symbol the file defines
    // for it: its block takes that artwork, each pin where the symbol has it.
    if (
      !mapped &&
      symbol?.definition &&
      binding?.kind === "external-subcircuit" &&
      instance.symbolId === externalSubcircuitSymbolId(binding.definitionId)
    )
      drawExternal(binding.definitionId, symbol.definition);
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
  return { placed, shows, phaseNets, hiddenLabels };
}

/**
 * A label the drawing does not show still names a part's clock: the one the
 * import gave it stays, hidden; a switch that had a CTRL pin takes the name
 * of the net that pin met.
 */
export function hideClockLabels(
  { document }: LevelScope,
  { placed, shows, phaseNets }: PlacedParts,
): void {
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
}
