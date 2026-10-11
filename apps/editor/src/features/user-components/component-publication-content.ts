import {
  parseSharedComponentPayload,
  type SharedDefinitionPayload,
} from "./component-library-contract";

/** Versioned, exact package comparison. Only owned packaging identities disappear. */
export const COMPONENT_CONTENT_VERSION = 1;

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, ordered(item)]),
    );
  return value;
}

export function componentPublicationContent(
  payload: SharedDefinitionPayload,
): string {
  const copy = structuredClone(
    parseSharedComponentPayload({
      definition: payload.definition,
      ...(payload.circuit ? { circuit: payload.circuit } : {}),
    }),
  );
  delete copy.definition.libraryOrigin;
  copy.definition.symbol.id = "owned-symbol";
  if (copy.definition.electrical) {
    copy.definition.electrical.id = "owned-electrical";
    copy.definition.electrical.symbolId = "owned-symbol";
  }
  if (copy.definition.subcircuit) {
    copy.definition.subcircuit.id = "owned-subcircuit";
    copy.definition.subcircuit.symbolId = "owned-symbol";
  }
  if (copy.circuit) {
    const owner = copy.circuit.externalDefinition;
    delete owner.libraryOrigin;
    const terminals = new Map(
      owner.terminals.map((terminal, index) => [
        terminal.id,
        `owned-terminal-${index}`,
      ]),
    );
    owner.id = "owned-circuit";
    const terminalIdentity = (id: string) => {
      const mapped = terminals.get(id);
      if (!mapped)
        throw Error(
          "Symbol presentation references a terminal outside its native owner.",
        );
      return mapped;
    };
    if (owner.symbolId) owner.symbolId = "owned-symbol";
    for (const terminal of owner.terminals)
      terminal.id = terminalIdentity(terminal.id);
    for (const placement of owner.presentation?.pinPlacements ?? [])
      placement.terminalId = terminalIdentity(placement.terminalId);
    const binding = copy.definition.circuitBinding!;
    binding.definitionId = "owned-circuit";
    for (const terminal of binding.terminals)
      terminal.terminalId = terminalIdentity(terminal.terminalId);
    copy.circuit.source.id = "owned-source";
    copy.circuit.source.revision = 1;
    if (owner.implementation?.kind === "source")
      owner.implementation.sourceId = "owned-source";
  }
  return JSON.stringify(
    ordered({ version: COMPONENT_CONTENT_VERSION, ...copy }),
  );
}

export async function componentContentDigest(content: string): Promise<string> {
  return [
    ...new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content)),
    ),
  ]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
