// A Cell's author-drawn block symbol: raw Symbol JSON artwork and the map
// from its Cell Pins to graphical pins, stored on presentation.cellSymbol
// and drawn by every caller (Symbol DSL, source-backed custom artwork).
import { z } from "zod";
import {
  MAX_SIMULATION_INPUT_BYTES,
  SymbolDefinitionSchema,
  SymbolTerminalMappingSchema,
  cellSymbolArtworkIssues,
  foldNetName,
  isOptionalSupplyPin,
  routeEndpoints,
  type CellSymbolArtwork,
  type CircuitProject,
  type RouteEndpoint,
  type SymbolDefinition,
  type SymbolTerminalMapping,
} from "@icm/model";
import {
  createHierarchicalBlockSymbol,
  hierarchicalSymbolId,
  projectCellSymbolTerminals,
} from "@icm/symbols";
import type { ProjectStructureEdit } from "./project-transaction.js";
import { requireDocument } from "./cell-document-edits.js";
import { planSetCellSymbolPresentation } from "./hierarchy-planner.js";

/**
 * Transient authoring input, the fields of
 * `apply_model_source.definitions[].authoring` that apply to a Cell: a mode,
 * optional raw artwork and an optional complete Cell-Pin-name-keyed map.
 */
export const CellSymbolArtworkInputSchema = z.strictObject({
  symbolMode: z.enum(["automatic", "custom"]),
  artworkText: z.string().max(MAX_SIMULATION_INPUT_BYTES).optional(),
  pinMap: z
    .record(
      z.string().min(1),
      z.union([
        z.strictObject({ pinName: z.string().min(1) }),
        z.strictObject({ supply: z.enum(["VDD", "VSS"]) }),
      ]),
    )
    .optional(),
});
export type CellSymbolArtworkInput = z.infer<
  typeof CellSymbolArtworkInputSchema
>;

const ArtworkTextSchema = z.union([
  z.strictObject({
    symbol: SymbolDefinitionSchema,
    terminals: z.array(SymbolTerminalMappingSchema).optional(),
  }),
  SymbolDefinitionSchema,
]);

/** Raw artwork text: Symbol JSON, or `{ symbol, terminals? }` as stored. */
export function parseCellSymbolArtworkText(text: string): {
  symbol: SymbolDefinition;
  terminals?: SymbolTerminalMapping[];
} {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    throw new Error(
      `The artwork is not JSON: ${error instanceof Error ? error.message : String(error)}. Nothing was changed.`,
    );
  }
  const parsed = ArtworkTextSchema.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0]!;
    throw new Error(
      `The artwork is not a valid Symbol: ${issue.path.join(".") || "symbol"}: ${issue.message}. Nothing was changed.`,
    );
  }
  return "symbol" in parsed.data && !("schemaVersion" in parsed.data)
    ? {
        symbol: parsed.data.symbol,
        ...(parsed.data.terminals ? { terminals: parsed.data.terminals } : {}),
      }
    : { symbol: parsed.data as SymbolDefinition };
}

/**
 * The generated block as editable artwork, its pins named after the Cell
 * Pins and mapped one to one: what Customize symbol starts from.
 */
export function capturedCellSymbolArtwork(
  project: CircuitProject,
  documentId: string,
): CellSymbolArtwork {
  const document = requireDocument(project, documentId);
  if (!document.netlist) throw new Error(`Cell does not exist: ${documentId}`);
  const { artwork: _artwork, ...layout } =
    document.presentation.cellSymbol ?? {};
  const generated = createHierarchicalBlockSymbol({
    ...document,
    presentation: { ...document.presentation, cellSymbol: layout },
  })!;
  const terminals = projectCellSymbolTerminals(document);
  return {
    symbol: SymbolDefinitionSchema.parse({
      ...generated,
      // Signal members belong to the Cell Pin, not to the drawing.
      pins: generated.pins.map(({ signalMembers: _members, ...pin }) => pin),
    }),
    terminals: terminals.map((terminal) => ({
      terminalId: terminal.id,
      pinName: terminal.name,
    })),
  };
}

/**
 * An exact same-name correspondence, the way Apply initializes a
 * source-backed map: every Cell Pin names one graphical pin and every other
 * pin is an optional supply pin. Undefined otherwise.
 */
function sameNameMapping(
  symbol: SymbolDefinition,
  terminals: readonly { id: string; name: string }[],
): SymbolTerminalMapping[] | undefined {
  const pins = new Map(symbol.pins.map((pin) => [foldNetName(pin.name), pin]));
  if (pins.size !== symbol.pins.length) return undefined;
  const mapping = terminals.map((terminal) => {
    const pin = pins.get(foldNetName(terminal.name));
    return pin ? { terminalId: terminal.id, pinName: pin.name } : undefined;
  });
  if (mapping.some((item) => !item)) return undefined;
  const named = new Set(mapping.map((item) => item!.pinName));
  if (
    !symbol.pins.every(
      (pin) => named.has(pin.name) || isOptionalSupplyPin(symbol, pin),
    )
  )
    return undefined;
  return mapping as SymbolTerminalMapping[];
}

/**
 * Set or reset a Cell's custom block artwork (GUI Customize symbol and the
 * Agent's `set-cell-symbol-artwork`). Automatic removes the artwork and
 * keeps the automatic layout beside it. Custom takes `artworkText` (omitted:
 * the current artwork) and a complete `pinMap` keyed by Cell Pin name;
 * without one, the text's own `terminals`, the current map while it still
 * fits, or an exact same-name interface. Planned through
 * planSetCellSymbolPresentation, so every caller's wires follow their pins
 * and no connection is lost.
 */
export function planSetCellSymbolArtwork(
  project: CircuitProject,
  documentId: string,
  input: CellSymbolArtworkInput,
): ProjectStructureEdit[] {
  const candidate = CellSymbolArtworkInputSchema.parse(input);
  const document = requireDocument(project, documentId);
  if (!document.netlist) throw new Error(`Cell does not exist: ${documentId}`);
  const cell = document.netlist.name;
  const stored = document.presentation.cellSymbol;
  if (candidate.symbolMode === "automatic") {
    if (candidate.artworkText !== undefined || candidate.pinMap !== undefined)
      throw new Error(
        "An automatic symbol follows the Cell Pins; choose custom before supplying artwork or a pin map. Nothing was changed.",
      );
    if (!stored?.artwork) return [];
    const { artwork: _artwork, ...layout } = stored;
    return planSetCellSymbolPresentation(
      project,
      documentId,
      Object.keys(layout).length ? layout : null,
    );
  }
  const terminals = projectCellSymbolTerminals(document);
  if (candidate.artworkText === undefined && !stored?.artwork)
    throw new Error(
      `${cell} has no custom symbol yet: supply artworkText (Symbol JSON). Nothing was changed.`,
    );
  const parsed =
    candidate.artworkText === undefined
      ? stored!.artwork!
      : parseCellSymbolArtworkText(candidate.artworkText);
  let mapping: SymbolTerminalMapping[] | undefined;
  if (candidate.pinMap !== undefined) {
    const named = new Map<string, string>();
    for (const name of Object.keys(candidate.pinMap)) {
      const terminal = terminals.find(
        (item) => foldNetName(item.name) === foldNetName(name),
      );
      if (!terminal)
        throw new Error(
          `${cell} has no Pin "${name}"; its Pins: ${
            terminals.map((item) => item.name).join(", ") || "none"
          }. Nothing was changed.`,
        );
      if (named.has(terminal.id))
        throw new Error(
          `Pin ${terminal.name} is mapped twice. Nothing was changed.`,
        );
      named.set(terminal.id, name);
    }
    mapping = terminals.flatMap((terminal) => {
      const name = named.get(terminal.id);
      return name === undefined
        ? []
        : [{ terminalId: terminal.id, ...candidate.pinMap![name]! }];
    });
  } else if (parsed.terminals) {
    mapping = parsed.terminals;
  } else if (
    stored?.artwork &&
    cellSymbolArtworkIssues(
      { symbol: parsed.symbol, terminals: stored.artwork.terminals },
      terminals,
    ).length === 0
  ) {
    mapping = stored.artwork.terminals;
  } else {
    mapping = sameNameMapping(parsed.symbol, terminals);
  }
  if (!mapping)
    throw new Error(
      `${cell}'s artwork pins (${parsed.symbol.pins.map((pin) => pin.name).join(", ") || "none"}) do not name its Pins (${terminals.map((item) => item.name).join(", ") || "none"}) one to one: supply a pinMap. Nothing was changed.`,
    );
  const artwork: CellSymbolArtwork = {
    symbol: parsed.symbol,
    terminals: mapping,
  };
  const issues = cellSymbolArtworkIssues(artwork, terminals);
  if (issues.length)
    throw new Error(
      `${cell}'s custom symbol: ${issues.map((issue) => issue.message).join("; ")}. Nothing was changed.`,
    );
  // A property supply takes its Net in Properties: no caller may still have
  // a wire or a No Connect on it.
  const symbolId = hierarchicalSymbolId(cell);
  for (const mapping of artwork.terminals)
    for (const parent of "supply" in mapping ? project.documents : [])
      for (const instance of parent.instances) {
        const binding = instance.netlist?.binding;
        if (
          binding?.kind !== "subcircuit" ||
          binding.childDocumentId !== documentId ||
          instance.symbolId !== symbolId
        )
          continue;
        const name = terminals.find((t) => t.id === mapping.terminalId)!.name;
        const onPin = (endpoint: RouteEndpoint) =>
          endpoint.kind === "terminal" &&
          endpoint.instanceId === instance.id &&
          endpoint.pinName === name;
        if (
          parent.routes.some((route) => routeEndpoints(route).some(onPin)) ||
          parent.noConnects.some((mark) => onPin(mark.endpoint))
        )
          throw new Error(
            `${instance.reference ?? instance.id} in ${parent.name} has a wire or No Connect on ${name}: a property supply has none. Map ${name} to a graphical pin, or remove that wire first. Nothing was changed.`,
          );
      }
  if (JSON.stringify(stored?.artwork) === JSON.stringify(artwork)) return [];
  return planSetCellSymbolPresentation(project, documentId, {
    ...stored,
    artwork,
  });
}
