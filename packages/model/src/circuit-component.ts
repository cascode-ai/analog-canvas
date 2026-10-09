import type {
  ComponentDefinition,
  ExternalSubcircuitDefinition,
  SymbolDefinition,
  ProjectModelSource,
} from "./schema.js";
import type { ComponentInterfaceIssue } from "./component-interface.js";
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

/** Initialize only a complete, exact same-name correspondence to the selected owner. */
export function initializeCircuitComponent(
  component: ComponentDefinition,
  definition: ExternalSubcircuitDefinition,
): ComponentDefinition {
  if (component.circuitBinding) return component;
  const names = component.symbol.pins.map((pin) => pin.name);
  if (
    names.length !== definition.terminals.length ||
    new Set(names).size !== names.length ||
    !definition.terminals.every((terminal) => names.includes(terminal.name))
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

/** One correspondence authority for Project validation, Apply and symbol resolution. */
export function circuitComponentIssues(
  component: ComponentDefinition,
  definition: ExternalSubcircuitDefinition,
): ComponentInterfaceIssue[] {
  const binding = component.circuitBinding;
  const issues: ComponentInterfaceIssue[] = [];
  const report = (path: (string | number)[], message: string) =>
    issues.push({ path, message });
  if (!binding || binding.definitionId !== definition.id) {
    report(
      ["circuitBinding", "definitionId"],
      "Select the native circuit owner for this artwork",
    );
    return issues;
  }
  const terminalIds = new Set(definition.terminals.map((t) => t.id));
  const pins = new Set(component.symbol.pins.map((p) => p.name));
  const mappedIds = new Set<string>();
  const mappedPins = new Set<string>();
  for (const [index, mapping] of binding.terminals.entries()) {
    const path = ["circuitBinding", "terminals", index];
    if (!terminalIds.has(mapping.terminalId))
      report(
        [...path, "terminalId"],
        "Unknown native terminal; repair the Pin mapping",
      );
    if (mappedIds.has(mapping.terminalId))
      report(
        [...path, "terminalId"],
        "Native terminal is mapped more than once",
      );
    mappedIds.add(mapping.terminalId);
    if (!("pinName" in mapping)) continue;
    if (!pins.has(mapping.pinName))
      report([...path, "pinName"], `Unknown graphical pin ${mapping.pinName}`);
    if (mappedPins.has(mapping.pinName))
      report(
        [...path, "pinName"],
        `Graphical pin ${mapping.pinName} maps different native terminals`,
      );
    mappedPins.add(mapping.pinName);
  }
  for (const terminal of definition.terminals)
    if (!mappedIds.has(terminal.id))
      report(
        ["circuitBinding", "terminals"],
        `Map native terminal ${terminal.name} to a graphical pin or an explicit supply`,
      );
  for (const pin of pins)
    if (!mappedPins.has(pin))
      report(
        ["symbol", "pins"],
        `Map graphical pin ${pin} to a native terminal`,
      );
  return issues;
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
  const names = new Map(
    component.circuitBinding!.terminals.flatMap((mapping) =>
      "pinName" in mapping
        ? [
            [
              mapping.pinName,
              definition.terminals.find((t) => t.id === mapping.terminalId)!
                .name,
            ] as const,
          ]
        : [],
    ),
  );
  const rename = (name: string) => names.get(name) ?? name;
  return {
    ...component.symbol,
    pins: [
      ...component.symbol.pins.map((pin) => ({
        ...pin,
        name: rename(pin.name),
        presentation: {
          ...pin.presentation,
          displayName: pin.presentation.displayName ?? pin.name,
        },
      })),
      ...component.circuitBinding!.terminals.flatMap((mapping) =>
        "supply" in mapping
          ? [
              {
                name: definition.terminals.find(
                  (t) => t.id === mapping.terminalId,
                )!.name,
                role: "inout",
                at: { x: 0, y: 0 },
                direction: "west" as const,
                presentation: { visibility: "implicit" as const },
              },
            ]
          : [],
      ),
    ],
    variants: component.symbol.variants.map((variant) => ({
      ...variant,
      hiddenPinNames: variant.hiddenPinNames.map(rename),
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
