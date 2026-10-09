import {
  ComponentDefinitionSchema,
  type ComponentDefinition,
  type Instance,
} from "@icm/model";
import {
  parseCircuitComponentPackage,
  type CircuitComponentResources,
} from "@icm/edit-engine";

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
  circuit?: CircuitComponentResources;
}
export interface ComponentLibraryPage {
  entries: SharedComponent[];
  nextCursor: string | null;
}

export const COMPONENT_DEFINITION_MAX_BYTES = 128 * 1024;
export const COMPONENT_LIBRARY_ID = /^[a-zA-Z0-9_-]{8,80}$/u;

/** The public library stores the same data as Project Code, never executable SVG. */
export interface SharedDefinitionPayload {
  definition: ComponentDefinition;
  circuit?: CircuitComponentResources;
}

export function parseSharedComponentPayload(value: {
  definition: unknown;
  circuit?: unknown;
}): SharedDefinitionPayload {
  const parsed =
    value.circuit !== undefined
      ? parseCircuitComponentPackage(value)
      : { definition: ComponentDefinitionSchema.parse(value.definition) };
  const { definition } = parsed;
  if (
    definition.generatedFrom ||
    (definition.symbol.hierarchicalBlock && !("circuit" in parsed))
  )
    throw new Error(
      "A shared component must be self-contained, without a Project Cell dependency",
    );
  if (definition.circuitBinding && !("circuit" in parsed))
    throw Error(
      "A source-bound component requires its complete native circuit package",
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
  if (
    new TextEncoder().encode(JSON.stringify(parsed)).byteLength >
    COMPONENT_DEFINITION_MAX_BYTES
  )
    throw new Error("Component definition is too large");
  return parsed;
}

export function parseSharedDefinition(value: unknown): ComponentDefinition {
  return parseSharedComponentPayload({ definition: value }).definition;
}

/** Each published revision has its own class identity; placed versions never float. */
export function publishedDefinition(
  definition: ComponentDefinition,
  id: string,
  revision: number,
): ComponentDefinition {
  return publishedComponentPayload({ definition }, id, revision).definition;
}

export function publishedComponentPayload(
  payload: SharedDefinitionPayload,
  id: string,
  revision: number,
): SharedDefinitionPayload {
  const snapshot = structuredClone(payload);
  const copy = snapshot.definition;
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
  if (snapshot.circuit) snapshot.circuit.externalDefinition.symbolId = symbolId;
  return parseSharedComponentPayload(snapshot);
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
