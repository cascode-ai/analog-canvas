import {
  ComponentDefinitionSchema,
  type ComponentDefinition,
  type Instance,
} from "@icm/model";

export type ComponentLibraryStatus = "shared" | "official" | "deleted";
export interface SharedComponent {
  id: string;
  revision: number;
  authorId: string;
  author: string;
  status: ComponentLibraryStatus;
  createdAt: string;
  updatedAt: string;
  definition: ComponentDefinition;
}
export interface ComponentLibraryPage {
  entries: SharedComponent[];
  nextCursor: string | null;
}

export const COMPONENT_DEFINITION_MAX_BYTES = 128 * 1024;
export const COMPONENT_LIBRARY_ID = /^[a-zA-Z0-9_-]{8,80}$/u;

/** The public library stores the same data as Project Code, never executable SVG. */
export function parseSharedDefinition(value: unknown): ComponentDefinition {
  const definition = ComponentDefinitionSchema.parse(value);
  if (definition.generatedFrom || definition.symbol.hierarchicalBlock)
    throw new Error(
      "A shared component must be self-contained, without a Project Cell dependency",
    );
  if (!definition.symbol.name.trim() || definition.symbol.name.length > 100)
    throw new Error("Use a component name between 1 and 100 characters");
  if (
    new Set(definition.symbol.pins.map((pin) => pin.name)).size !==
    definition.symbol.pins.length
  )
    throw new Error("Pin names must be unique");
  if (
    new Set(definition.symbol.variants.map((variant) => variant.id)).size !==
    definition.symbol.variants.length
  )
    throw new Error("Variant names must be unique");
  if (JSON.stringify(definition).length > COMPONENT_DEFINITION_MAX_BYTES)
    throw new Error("Component definition is too large");
  return definition;
}

/** Each published revision has its own class identity; placed versions never float. */
export function publishedDefinition(
  definition: ComponentDefinition,
  id: string,
  revision: number,
): ComponentDefinition {
  const copy = structuredClone(definition);
  const symbolId = `user-${id}-r${revision}`;
  copy.symbol.id = symbolId;
  if (copy.electrical) {
    copy.electrical.id = `${symbolId}-electrical`;
    copy.electrical.symbolId = symbolId;
  }
  if (copy.subcircuit) {
    copy.subcircuit.id = `${symbolId}-subcircuit`;
    copy.subcircuit.symbolId = symbolId;
  }
  return parseSharedDefinition(copy);
}

export function sharedComponentNetlist(
  definition: ComponentDefinition,
): Instance["netlist"] {
  const electrical = definition.electrical;
  if (!electrical && !definition.subcircuit) return undefined;
  return {
    ...(definition.subcircuit
      ? {
          binding: {
            kind: "unresolved-subcircuit" as const,
            name: definition.subcircuit.target,
          },
        }
      : electrical?.targetPolicy === "builtin"
        ? {
            binding: {
              kind: "primitive" as const,
              deviceClass: electrical.deviceClass,
            },
          }
        : {}),
    parameters: Object.fromEntries(
      (electrical?.parameters ?? []).flatMap((parameter) =>
        parameter.defaultValue === undefined
          ? []
          : [[parameter.name, parameter.defaultValue]],
      ),
    ),
  };
}
