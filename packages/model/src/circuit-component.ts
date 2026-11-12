import type {
  CellSymbolArtwork,
  ComponentDefinition,
  ExternalSubcircuitDefinition,
  SymbolDefinition,
  SymbolTerminalMapping,
  ProjectModelSource,
} from "./schema.js";
import {
  isOptionalSupplyPin,
  type ComponentInterfaceIssue,
} from "./component-interface.js";
import { ComponentDefinitionSchema } from "./schema/component-definition.js";
import { deriveStableId } from "./ids.js";

/** Raw authoring text may still name the owner from which this draft was copied. */
export function resolveCircuitArtworkDraft(
  component: ComponentDefinition,
  owner: ExternalSubcircuitDefinition,
  origin: NonNullable<
    NonNullable<ProjectModelSource["draft"]>["authoring"]
  >[number]["artworkOrigin"],
): ComponentDefinition {
  if (!origin || component.circuitBinding?.definitionId !== origin.definitionId)
    return component;
  return {
    ...component,
    circuitBinding: {
      definitionId: owner.id,
      terminals: component.circuitBinding.terminals.map((mapping) => {
        const terminalId =
          origin.terminalIds[mapping.terminalId] ??
          owner.terminals.find(
            (terminal) =>
              deriveStableId(
                "model-terminal",
                origin.definitionId,
                terminal.name,
              ) === mapping.terminalId,
          )?.id ??
          mapping.terminalId;
        return { ...mapping, terminalId };
      }),
    },
  };
}

/** Explicit native removal forks only the departing graphical contacts and mappings. */
export function removeCircuitComponentTerminals(
  component: ComponentDefinition,
  terminalIds: readonly string[],
): ComponentDefinition {
  const removed =
    component.circuitBinding?.terminals.filter((mapping) =>
      terminalIds.includes(mapping.terminalId),
    ) ?? [];
  if (removed.length === 0) return component;
  const pins = new Set(
    removed.flatMap((mapping) =>
      "pinName" in mapping ? [mapping.pinName] : [],
    ),
  );
  const symbol = structuredClone(component.symbol);
  symbol.id = deriveStableId(
    "circuit-interface-symbol",
    symbol.id,
    JSON.stringify(removed.map((mapping) => mapping.terminalId).sort()),
  );
  symbol.pins = symbol.pins.filter((pin) => !pins.has(pin.name));
  symbol.variants = symbol.variants.map((variant) => ({
    ...variant,
    hiddenPinNames: variant.hiddenPinNames.filter((name) => !pins.has(name)),
    ...(variant.auxiliaryPins
      ? {
          auxiliaryPins: variant.auxiliaryPins.filter(
            (pin) => !pins.has(pin.name),
          ),
        }
      : {}),
  }));
  if (symbol.pins.length === 0) symbol.hierarchicalBlock = true;
  return ComponentDefinitionSchema.parse({
    ...component,
    symbol,
    circuitBinding: {
      ...component.circuitBinding!,
      terminals: component.circuitBinding!.terminals.filter(
        (mapping) => !terminalIds.includes(mapping.terminalId),
      ),
    },
  });
}

export class CircuitComponentMappingError extends Error {
  constructor(issue: ComponentInterfaceIssue) {
    super(`${issue.path.join(".")}: ${issue.message}`);
  }
}

/**
 * Initialize only a complete, exact same-name correspondence to the selected
 * owner; an optional supply pin no terminal names stays unmapped.
 */
export function initializeCircuitComponent(
  component: ComponentDefinition,
  definition: ExternalSubcircuitDefinition,
): ComponentDefinition {
  if (component.circuitBinding) return component;
  const names = component.symbol.pins.map((pin) => pin.name);
  const terminals = new Set(definition.terminals.map((t) => t.name));
  if (
    new Set(names).size !== names.length ||
    terminals.size !== definition.terminals.length ||
    !definition.terminals.every((terminal) => names.includes(terminal.name)) ||
    !component.symbol.pins.every(
      (pin) =>
        terminals.has(pin.name) || isOptionalSupplyPin(component.symbol, pin),
    )
  )
    return component;
  return ComponentDefinitionSchema.parse({
    ...component,
    circuitBinding: {
      definitionId: definition.id,
      terminals: definition.terminals.map((terminal) => ({
        terminalId: terminal.id,
        pinName: terminal.name,
      })),
    },
  });
}

/** An owner terminal custom artwork maps: stable identity and formal name. */
export interface MappedSymbolTerminal {
  readonly id: string;
  readonly name: string;
  readonly signalMembers?: readonly { id: string; name: string }[];
}

/**
 * The correspondence rule shared by source-backed `circuitBinding` and a
 * Cell's custom block artwork: every owner terminal mapped exactly once, to
 * one graphical pin or an explicit supply; every graphical pin but an
 * optional supply pin mapped exactly once. Paths are relative to an object
 * holding `symbol` and `terminals`; `noun` names the owner's terminals.
 */
function symbolTerminalMappingIssues(
  symbol: SymbolDefinition,
  mappings: readonly SymbolTerminalMapping[],
  terminals: readonly MappedSymbolTerminal[],
  noun = "native terminal",
): ComponentInterfaceIssue[] {
  const issues: ComponentInterfaceIssue[] = [];
  const report = (path: (string | number)[], message: string) =>
    issues.push({ path, message });
  const Noun = noun[0]!.toUpperCase() + noun.slice(1);
  const terminalIds = new Set(terminals.map((t) => t.id));
  const pins = new Set(symbol.pins.map((p) => p.name));
  const mappedIds = new Set<string>();
  const mappedPins = new Set<string>();
  for (const [index, mapping] of mappings.entries()) {
    const path = ["terminals", index];
    if (!terminalIds.has(mapping.terminalId))
      report(
        [...path, "terminalId"],
        `Unknown ${noun}; repair the Pin mapping`,
      );
    if (mappedIds.has(mapping.terminalId))
      report([...path, "terminalId"], `${Noun} is mapped more than once`);
    mappedIds.add(mapping.terminalId);
    if (!("pinName" in mapping)) continue;
    if (!pins.has(mapping.pinName))
      report([...path, "pinName"], `Unknown graphical pin ${mapping.pinName}`);
    if (mappedPins.has(mapping.pinName))
      report(
        [...path, "pinName"],
        `Graphical pin ${mapping.pinName} maps different ${noun}s`,
      );
    mappedPins.add(mapping.pinName);
  }
  for (const terminal of terminals)
    if (!mappedIds.has(terminal.id))
      report(
        ["terminals"],
        `Map ${noun} ${terminal.name} to a graphical pin or an explicit supply`,
      );
  // A supply pin the artwork draws only on request may stay unmapped: it
  // then draws nothing, and the supply mapping, if any, is a property
  // terminal as with artwork that has no such pin (#1833).
  for (const pin of symbol.pins)
    if (!mappedPins.has(pin.name) && !isOptionalSupplyPin(symbol, pin))
      report(["symbol", "pins"], `Map graphical pin ${pin.name} to a ${noun}`);
  return issues;
}

/** One correspondence authority for Project validation, Apply and symbol resolution. */
export function circuitComponentIssues(
  component: ComponentDefinition,
  definition: ExternalSubcircuitDefinition,
): ComponentInterfaceIssue[] {
  const binding = component.circuitBinding;
  if (!binding || binding.definitionId !== definition.id)
    return [
      {
        path: ["circuitBinding", "definitionId"],
        message: "Select the native circuit owner for this artwork",
      },
    ];
  return symbolTerminalMappingIssues(
    component.symbol,
    binding.terminals,
    definition.terminals,
  ).map((issue) =>
    issue.path[0] === "terminals"
      ? { ...issue, path: ["circuitBinding", ...issue.path] }
      : issue,
  );
}

/** Drawing names are presentation; ordinary runtime endpoints use native names. */
export function circuitComponentTerminals(
  component: ComponentDefinition,
  definition: ExternalSubcircuitDefinition,
) {
  const issue = circuitComponentIssues(component, definition)[0];
  if (issue) throw new CircuitComponentMappingError(issue);
  return definition.terminals.map((terminal) => {
    const mapping = component.circuitBinding!.terminals.find(
      (item) => item.terminalId === terminal.id,
    )!;
    return {
      targetName: terminal.name,
      pinName: terminal.name,
      interaction:
        "supply" in mapping ? ("property" as const) : ("canvas" as const),
      ...("supply" in mapping ? { supply: mapping.supply } : {}),
    };
  });
}

/** Drawing names are presentation; ordinary runtime endpoints use native names. */
export function projectCircuitSymbol(
  component: ComponentDefinition,
  definition: ExternalSubcircuitDefinition,
): SymbolDefinition {
  const issue = circuitComponentIssues(component, definition)[0];
  if (issue) throw new CircuitComponentMappingError(issue);
  return projectMappedSymbol(
    component.symbol,
    component.circuitBinding!.terminals,
    definition.terminals,
  );
}

/**
 * Custom artwork as callers resolve it: each mapped graphical pin renamed to
 * its owner terminal's formal name (the drawn name stays its display name),
 * an unmapped optional supply pin dropped, a supply-mapped terminal an
 * implicit property pin. The mapping must already be valid
 * (symbolTerminalMappingIssues).
 */
function projectMappedSymbol(
  symbol: SymbolDefinition,
  mappings: readonly SymbolTerminalMapping[],
  terminals: readonly MappedSymbolTerminal[],
): SymbolDefinition {
  const terminalFor = new Map(
    mappings.flatMap((mapping) =>
      "pinName" in mapping
        ? [
            [
              mapping.pinName,
              terminals.find((t) => t.id === mapping.terminalId)!,
            ] as const,
          ]
        : [],
    ),
  );
  const rename = (name: string) => terminalFor.get(name)?.name ?? name;
  // An unmapped optional supply pin draws nothing (#1833). A mapped one is
  // its native terminal's pin, no supply: unwired, it is unconnected.
  const optional = new Set(
    symbol.pins
      .filter((pin) => isOptionalSupplyPin(symbol, pin))
      .map((pin) => pin.name),
  );
  const dropped = new Set(
    [...optional].filter((name) => !terminalFor.has(name)),
  );
  return {
    ...symbol,
    pins: [
      ...symbol.pins
        .filter((pin) => !dropped.has(pin.name))
        .map((pin) => {
          const members = terminalFor.get(pin.name)?.signalMembers;
          return {
            ...pin,
            name: rename(pin.name),
            ...(optional.has(pin.name) ? { role: "inout" } : {}),
            ...(members && members.length > 1
              ? { signalMembers: members.map(({ id, name }) => ({ id, name })) }
              : {}),
            presentation: {
              ...pin.presentation,
              displayName: pin.presentation.displayName ?? pin.name,
            },
          };
        }),
      ...mappings.flatMap((mapping) =>
        "supply" in mapping
          ? [
              {
                name: terminals.find((t) => t.id === mapping.terminalId)!.name,
                role: "inout",
                at: { x: 0, y: 0 },
                direction: "west" as const,
                presentation: { visibility: "implicit" as const },
              },
            ]
          : [],
      ),
    ],
    variants: symbol.variants.map((variant) => ({
      ...variant,
      hiddenPinNames: variant.hiddenPinNames
        .filter((name) => !dropped.has(name))
        .map(rename),
      ...(variant.auxiliaryPins
        ? {
            auxiliaryPins: variant.auxiliaryPins.map((pin) => ({
              ...pin,
              name: rename(pin.name),
            })),
          }
        : {}),
    })),
  };
}

/**
 * A Cell's custom block artwork against its Cell Pins (the projected
 * interface's ports): the source-backed correspondence rule, worded for
 * Cells. Paths are relative to the artwork.
 */
export function cellSymbolArtworkIssues(
  artwork: CellSymbolArtwork,
  ports: readonly MappedSymbolTerminal[],
): ComponentInterfaceIssue[] {
  return symbolTerminalMappingIssues(
    artwork.symbol,
    artwork.terminals,
    ports,
    "Cell Pin",
  ).map((issue) =>
    issue.path.length === 1 && issue.path[0] === "terminals"
      ? {
          ...issue,
          message: `${issue.message}: map it in Customize symbol, or reset the symbol to automatic`,
        }
      : issue,
  );
}

/** A Cell's custom block as its callers draw it, or null while its map is invalid. */
export function projectCellSymbolArtwork(
  artwork: CellSymbolArtwork,
  ports: readonly MappedSymbolTerminal[],
  identity: { readonly id: string; readonly name: string },
): SymbolDefinition | null {
  if (cellSymbolArtworkIssues(artwork, ports).length) return null;
  const { hierarchicalBlock: _block, ...symbol } = projectMappedSymbol(
    artwork.symbol,
    artwork.terminals,
    ports,
  );
  return {
    ...symbol,
    id: identity.id,
    name: identity.name,
    // A block that draws no pin is still a Cell's (empty) interface.
    ...(symbol.pins.length === 0 ? { hierarchicalBlock: true as const } : {}),
  };
}
