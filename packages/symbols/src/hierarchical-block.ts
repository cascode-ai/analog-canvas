import {
  deriveStableId,
  projectCellInterface,
  semanticTextDocument,
} from "@icm/model";
import type {
  CellSymbolPinPlacement,
  CellSymbolPresentation,
  CircuitProject,
  ComponentDefinitionSource,
  SchematicDocument,
} from "@icm/model";

import {
  createHierarchicalBlockGeometry,
  hierarchicalBlockBodySize,
  hierarchicalBlockPinSlots,
  type HierarchicalBlockLayoutOptions,
  type HierarchicalBlockPinSlot,
  type HierarchicalBlockTerminal,
} from "./hierarchical-block-geometry.js";
import { resolvePdkSymbolMappingForTerminalOrder } from "./pdk-registry.js";
import { SymbolDefinitionSchema } from "./schema.js";
import type { SymbolDefinition } from "./schema.js";

export {
  freeHierarchicalBlockOffsets,
  hierarchicalBlockBodySize,
  type HierarchicalBlockPinSlot,
} from "./hierarchical-block-geometry.js";

export function hierarchicalSymbolId(cellName: string): string {
  return deriveStableId("hierarchical-symbol", cellName.toLowerCase());
}

/** External symbols are keyed by immutable definition identity, never master spelling. */
export function externalSubcircuitSymbolId(definitionId: string): string {
  return deriveStableId("external-subcircuit-symbol", definitionId);
}

/** Shared generic block artwork contract, independent of its definition owner. */
export interface BlockSymbolLayout {
  id: string;
  name: string;
  terminals: readonly HierarchicalBlockTerminal[];
  presentation?: CellSymbolPresentation | undefined;
}

export function createBlockSymbol(
  layout: BlockSymbolLayout,
  options: HierarchicalBlockLayoutOptions = {},
): SymbolDefinition {
  const positional = createHierarchicalBlockGeometry(
    layout.terminals,
    layout.presentation,
    options,
  );
  return SymbolDefinitionSchema.parse({
    ...positional,
    pins: positional.pins.map((pin) => ({
      ...pin,
      presentation: {
        ...pin.presentation,
        nameContent:
          layout.terminals.find((terminal) => terminal.name === pin.name)
            ?.nameContent ?? semanticTextDocument(pin.name, "formal-port"),
      },
    })),
    id: layout.id,
    name: layout.name,
    hierarchicalBlock: true,
    variants: [],
  });
}

type CellSymbolSource = Pick<SchematicDocument, "netlist"> &
  Partial<Pick<SchematicDocument, "annotations">>;

/** Same representative declaration as the effective interface, including its authored format. */
export function projectCellSymbolTerminals(
  document: CellSymbolSource,
): HierarchicalBlockTerminal[] {
  return projectCellInterface(document.netlist).ports.map((port) => {
    const terminal = document.netlist!.terminals.find(
      (item) => item.id === port.id,
    )!;
    const annotation = document.annotations?.find(
      (item) =>
        (item.binding?.kind === "cell-terminal-name" &&
          item.binding.terminalId === port.id) ||
        (!item.binding &&
          (item.id === terminal.interfaceAnnotationId ||
            (item.kind === "instance-label" &&
              item.anchor.kind === "object" &&
              terminal.interfaceInstanceIds.includes(item.anchor.objectId)))),
    );
    return {
      ...port,
      nameContent:
        annotation?.formatOverride ??
        (!annotation?.binding ? annotation?.content : undefined) ??
        semanticTextDocument(port.name, "formal-port"),
    };
  });
}

export function createHierarchicalBlockSymbol(
  document: Pick<SchematicDocument, "name" | "sourceBinding" | "netlist"> & {
    readonly presentation?: SchematicDocument["presentation"];
    readonly annotations?: SchematicDocument["annotations"];
  },
  options: HierarchicalBlockLayoutOptions = {},
): SymbolDefinition | null {
  // The current netlist name is the local Cell identity. sourceBinding keeps
  // import provenance and intentionally does not change when the local Cell is
  // renamed, so it must not select the runtime symbol identity.
  const cellName = document.netlist?.name;
  const terminals = projectCellSymbolTerminals(document);
  if (!cellName) return null;
  return createBlockSymbol(
    {
      id: hierarchicalSymbolId(cellName),
      name: document.name,
      terminals,
      presentation: document.presentation?.cellSymbol,
    },
    options,
  );
}

/** The Cells some Cell of the Project has placed. */
export function placedCellDocumentIds(
  project: Pick<CircuitProject, "documents">,
): Set<string> {
  return new Set(
    project.documents.flatMap((parent) =>
      parent.instances.flatMap((instance) =>
        instance.netlist?.binding?.kind === "subcircuit"
          ? [instance.netlist.binding.childDocumentId]
          : [],
      ),
    ),
  );
}

/** The block's Pin rows, in the order an automatic slot is taken. */
const ROW_PITCH = 20;

/**
 * Sides for the Pins with no stored placement, from where their Ports are
 * drawn in the Cell (#1319): left of the drawing's middle on the block's
 * west side, right of it on the east, in their drawn order from top to
 * bottom. sram6t drew bl left and blb right, and its block had them the
 * other way round, mirrored against its own schematic. A Port on the
 * middle, or not drawn, keeps the automatic rule.
 */
function drawnPinPlacements(
  document: SchematicDocument,
): CellSymbolPinPlacement[] {
  const stored = document.presentation.cellSymbol?.pinPlacements ?? [];
  const positions = document.instances.flatMap((instance) =>
    instance.placement ? [instance.placement.position] : [],
  );
  if (!positions.length) return [];
  const xs = positions.map((position) => position.x);
  const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
  const ys = positions.map((position) => position.y);
  const level = (Math.min(...ys) + Math.max(...ys)) / 2;
  const drawnAt = (terminalId: string) => {
    const terminal = document.netlist?.terminals.find(
      (item) => item.id === terminalId,
    );
    return document.instances.find(
      (instance) => instance.id === terminal?.interfaceInstanceIds[0],
    )?.placement?.position;
  };
  const sides = { west: [], east: [], north: [], south: [] } as Record<
    "west" | "east" | "north" | "south",
    { terminalId: string; x: number; y: number }[]
  >;
  for (const terminal of projectCellSymbolTerminals(document)) {
    if (stored.some((placement) => placement.terminalId === terminal.id))
      continue;
    const at = drawnAt(terminal.id);
    if (!at) continue;
    // A Port drawn on the middle line takes the end it is drawn at. A
    // differential pair's tail, drawn below the pair, had no side, and the
    // automatic layout put it between outp and inp, three names in 20 units.
    sides[
      at.x < middle
        ? "west"
        : at.x > middle
          ? "east"
          : at.y > level
            ? "south"
            : at.y < level
              ? "north"
              : "west"
    ].push({ terminalId: terminal.id, ...at });
  }
  // The rows sit a little below the middle under a top Pin, a little above
  // it over a bottom one: the body grows evenly from its middle, and a top
  // name needs room above the first row only. A DAC unit with VDD on top
  // and four Pins down its left took 160 high with its rows from the
  // middle up, and 120 with them centred 10 below it.
  const ends = new Set([
    ...stored.map((placement) => placement.side),
    ...(["north", "south"] as const).filter((side) => sides[side].length),
  ]);
  const centre =
    ends.has("north") === ends.has("south") ? 0 : ends.has("north") ? 10 : -10;
  return (["west", "east", "north", "south"] as const).flatMap((side) => {
    const across = side === "north" || side === "south";
    const taken = new Set(
      stored
        .filter((placement) => placement.side === side)
        .map((placement) => placement.offset),
    );
    const count = sides[side].length;
    // A top or bottom Pin is centred along its end; the side rows follow the
    // top and bottom ones.
    let offsets = Array.from(
      { length: count },
      (_, index) =>
        (across ? 0 : centre) +
        ROW_PITCH * index -
        (ROW_PITCH / 2) * (count - 1),
    );
    if (offsets.some((offset) => taken.has(offset))) {
      offsets = [];
      for (let step = 0; offsets.length < count; step += 1) {
        const offset = (step % 2 ? -1 : 1) * Math.ceil(step / 2) * ROW_PITCH;
        if (!taken.has(offset)) offsets.push(offset);
      }
      offsets.sort((a, b) => a - b);
    }
    return sides[side]
      .sort((a, b) => (across ? a.x - b.x : a.y - b.y || a.x - b.x))
      .map((entry, index) => ({
        terminalId: entry.terminalId,
        side,
        offset: offsets[index]!,
      }));
  });
}

/**
 * The symbol a Cell no parent has placed yet shows, and the one its first
 * placement keeps (planPlaceCellInstance): Pins on the side their Ports are
 * drawn on (#1319), and a body with room for top and bottom Pin names
 * (#1327). A placed block's Pins never move, so this applies only before.
 */
export function unplacedCellSymbol(
  document: SchematicDocument,
): CellSymbolPresentation | undefined {
  const current = document.presentation.cellSymbol;
  const drawn = drawnPinPlacements(document);
  const base: CellSymbolPresentation | undefined = drawn.length
    ? {
        ...current,
        pinPlacements: [...(current?.pinPlacements ?? []), ...drawn],
      }
    : current;
  const terminals = projectCellSymbolTerminals(document);
  const fitted = hierarchicalBlockBodySize(terminals, base, {
    fitNames: true,
  });
  const plain = hierarchicalBlockBodySize(terminals, base);
  return fitted.width === plain.width && fitted.height === plain.height
    ? base
    : { ...base, minimumBodySize: fitted };
}

/**
 * Where every Pin of a Cell's block stands as its callers see it, in
 * interface order (#1320): a placed Cell's stored placements and automatic
 * slots; for a Cell no parent has placed yet, the layout its first placement
 * would store (unplacedCellSymbol).
 */
export function cellSymbolPinSlots(
  project: Pick<CircuitProject, "documents">,
  document: SchematicDocument,
): HierarchicalBlockPinSlot[] {
  return hierarchicalBlockPinSlots(
    projectCellSymbolTerminals(document),
    placedCellDocumentIds(project).has(document.id)
      ? document.presentation.cellSymbol
      : unplacedCellSymbol(document),
  );
}

export function createProjectHierarchicalSymbols(
  project: Pick<CircuitProject, "documents" | "topDocumentId"> &
    Partial<Pick<CircuitProject, "externalSubcircuitDefinitions">>,
  baseDefinitions: readonly SymbolDefinition[] = [],
): SymbolDefinition[] {
  // A Cell no parent has placed yet shows the symbol its first placement
  // keeps (unplacedCellSymbol); a placed block's Pins never move.
  const placed = placedCellDocumentIds(project);
  const internal = project.documents.flatMap((document) => {
    // Top is an entry point, not a restriction on Cell reuse. First placement
    // and definition preview must resolve before a caller exists.
    const definition = createHierarchicalBlockSymbol(
      placed.has(document.id)
        ? document
        : {
            ...document,
            presentation: {
              ...document.presentation,
              cellSymbol: unplacedCellSymbol(document),
            },
          },
    );
    return definition ? [definition] : [];
  });
  const external = (project.externalSubcircuitDefinitions ?? []).flatMap(
    (definition) => {
      const mapping =
        definition.presentation || definition.implementation
          ? undefined
          : resolvePdkSymbolMappingForTerminalOrder(
              definition.name,
              definition.terminals.map((terminal) => terminal.name),
            );
      const mappedDefinition = mapping
        ? baseDefinitions.find((candidate) => candidate.id === mapping.symbolId)
        : undefined;
      if (mappedDefinition) {
        const { id: _baseId, name: _baseName, ...artwork } = mappedDefinition;
        return [
          SymbolDefinitionSchema.parse({
            ...artwork,
            id: externalSubcircuitSymbolId(definition.id),
            name: definition.name,
            hierarchicalBlock: true,
          }),
        ];
      }
      return [
        createBlockSymbol({
          id: externalSubcircuitSymbolId(definition.id),
          name:
            definition.implementation?.kind === "placeholder"
              ? `${definition.name} [unimplemented]`
              : definition.name,
          terminals: definition.terminals,
          presentation: definition.presentation,
        }),
      ];
    },
  );
  return [...internal, ...external];
}

/** Authored inputs of generated blocks; used to invalidate only changed
 * interfaces/presentations while retaining captured artwork across releases. */
export function projectSymbolSources(
  project: Pick<CircuitProject, "documents" | "topDocumentId"> &
    Partial<Pick<CircuitProject, "externalSubcircuitDefinitions">>,
) {
  const sources = new Map<string, ComponentDefinitionSource>();
  for (const document of project.documents) {
    if (!document.netlist) continue;
    sources.set(hierarchicalSymbolId(document.netlist.name), {
      name: document.name,
      terminals: projectCellSymbolTerminals(document).map(
        ({ id, name, direction, nameContent }) => ({
          id,
          name,
          direction,
          ...(nameContent ? { nameContent } : {}),
        }),
      ),
      ...(document.presentation.cellSymbol
        ? { presentation: document.presentation.cellSymbol }
        : {}),
    });
  }
  for (const definition of project.externalSubcircuitDefinitions ?? [])
    sources.set(externalSubcircuitSymbolId(definition.id), {
      name: definition.name,
      terminals: definition.terminals,
      ...(definition.presentation
        ? { presentation: definition.presentation }
        : {}),
    });
  return sources;
}
