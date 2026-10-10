import { z } from "zod";
import {
  ComponentDefinitionSchema,
  MAX_SIMULATION_INPUT_BYTES,
  ModelSourceAuthoringDraftsSchema,
  circuitComponentIssues,
  deriveStableId,
  initializeCircuitComponent,
  resolveCircuitArtworkDraft,
  type ExternalSubcircuitDefinition,
  type ComponentDefinition,
} from "@icm/model";

/** Transient authoring input; only the ordinary Apply result becomes executable. */
export const CircuitAuthoringInputSchema = z.strictObject({
  symbolMode: z.enum(["automatic", "custom"]),
  artworkText: z.string().max(MAX_SIMULATION_INPUT_BYTES).optional(),
  artworkOrigin: ModelSourceAuthoringDraftsSchema.element.shape.artworkOrigin,
  terminalDirections: z
    .record(z.string().min(1), z.enum(["input", "output", "inout", "passive"]))
    .optional(),
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
export type CircuitAuthoringInput = z.infer<typeof CircuitAuthoringInputSchema>;

/** GUI preview and source Apply derive the same formal IDs, order and defaults. */
export function modelSourceInterface(
  id: string,
  sourceId: string,
  entry: {
    name: string;
    ports: string[];
    parameters: { name: string; rawText: string }[];
  },
  previous?: ExternalSubcircuitDefinition,
  portMap: Record<string, string | null> = {},
): ExternalSubcircuitDefinition {
  return {
    ...previous,
    id,
    name: entry.name,
    terminals: entry.ports.map((name) => {
      const old = previous?.terminals.find(
        (t) =>
          (Object.hasOwn(portMap, t.name) ? portMap[t.name] : t.name) === name,
      );
      return old
        ? { ...old, name }
        : {
            id: deriveStableId("model-terminal", id, name),
            name,
            direction: "passive",
          };
    }),
    formalParameters: entry.parameters.map((p) => ({
      name: p.name,
      defaultValue: p.rawText,
    })),
    interfaceStatus: "declared",
    implementation: { kind: "source", sourceId, entry: entry.name },
  };
}

/** Names are authoring conveniences; the checked result uses stable native IDs. */
export function resolveCircuitAuthoring(
  owner: ExternalSubcircuitDefinition,
  input: CircuitAuthoringInput,
  captures: readonly ComponentDefinition[] = [],
) {
  const candidate = CircuitAuthoringInputSchema.parse(input);
  const directions: Record<
    string,
    ExternalSubcircuitDefinition["terminals"][number]["direction"]
  > = {};
  for (const [name, direction] of Object.entries(
    candidate.terminalDirections ?? {},
  )) {
    const terminal = owner.terminals.find((t) => t.name === name);
    if (!terminal) throw Error(`Unknown native terminal ${name} in directions`);
    directions[terminal.id] = direction;
  }
  if (candidate.symbolMode === "automatic") {
    if (
      candidate.pinMap !== undefined ||
      candidate.artworkText !== undefined ||
      candidate.artworkOrigin !== undefined
    )
      throw Error(
        "Automatic symbols follow native ports; choose Custom before supplying artwork or pin mapping.",
      );
    return { symbol: null, terminalDirections: directions };
  }
  const existing = captures.find(
    (component) => component.symbol.id === owner.symbolId,
  );
  if (candidate.artworkText === undefined && !existing)
    throw Error(
      "Custom artwork is required when no existing custom symbol is available.",
    );
  let component = resolveCircuitArtworkDraft(
    candidate.artworkText === undefined
      ? existing!
      : ComponentDefinitionSchema.parse(JSON.parse(candidate.artworkText)),
    owner,
    candidate.artworkOrigin,
  );
  if (candidate.pinMap !== undefined) {
    for (const name of Object.keys(candidate.pinMap))
      if (!owner.terminals.some((t) => t.name === name))
        throw Error(`Unknown native terminal ${name} in pin mapping`);
    component = {
      ...component,
      circuitBinding: {
        definitionId: owner.id,
        terminals: owner.terminals.flatMap((terminal) => {
          const mapping = candidate.pinMap![terminal.name];
          return mapping ? [{ terminalId: terminal.id, ...mapping }] : [];
        }),
      },
    };
  }
  component = initializeCircuitComponent(component, owner);
  const issue = circuitComponentIssues(component, owner)[0];
  const captured = captures.find(
    (value) => value.symbol.id === component.symbol.id,
  );
  if (
    !issue &&
    captured &&
    JSON.stringify(captured) !== JSON.stringify(component)
  ) {
    component = {
      ...component,
      symbol: {
        ...component.symbol,
        id: deriveStableId(
          "circuit-artwork",
          component.symbol.id,
          JSON.stringify(component),
        ),
      },
    };
  }
  return { symbol: component, terminalDirections: directions, issue };
}
