import { deriveStableId } from "@icm/model";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function endpointJunctionId(value: unknown): string | undefined {
  if (!isRecord(value) || value.kind !== "junction") return undefined;
  return typeof value.junctionId === "string" ? value.junctionId : undefined;
}

function railOwnsAnchor(
  routes: readonly Record<string, unknown>[],
  netId: string,
  anchorId: string,
): boolean {
  return routes.some((route) => {
    if (route.presentation !== "power-rail" || route.netId !== netId) {
      return false;
    }
    const finalLeg = records(route.legs).at(-1);
    const finalTarget = isRecord(finalLeg?.to) ? finalLeg.to : undefined;
    const finalEndpoint =
      finalTarget?.kind === "endpoint" ? finalTarget.endpoint : undefined;
    return (
      endpointJunctionId(route.start) === anchorId ||
      endpointJunctionId(finalEndpoint) === anchorId
    );
  });
}

function migratedTerminalId(
  documentId: string,
  annotationId: string,
  occupiedIds: ReadonlySet<string>,
): string {
  let ordinal = 1;
  while (true) {
    const candidate = deriveStableId(
      "cell-terminal",
      documentId,
      "power-rail",
      annotationId,
      ...(ordinal === 1 ? [] : [String(ordinal)]),
    );
    if (!occupiedIds.has(candidate)) return candidate;
    ordinal += 1;
  }
}

/** Schema 57 makes a locally authored Power Rail an explicit formal Cell Pin.
 * The visible power-label owns the terminal, so migration does not invent a
 * hidden interface Instance or change physical Net membership. */
export function upgradeSchema56To57(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  const documents = records(raw.documents);
  for (const document of documents) {
    const documentId =
      typeof document.id === "string" ? document.id : "unknown-document";
    const netlist = isRecord(document.netlist) ? document.netlist : undefined;
    if (!netlist) continue;
    const terminals = records(netlist.terminals);
    const terminalIds = new Set(
      terminals.flatMap((terminal) =>
        typeof terminal.id === "string" ? [terminal.id] : [],
      ),
    );
    const routes = records(document.routes);
    const evidence = records(document.connectivityEvidence);

    for (const annotation of records(document.annotations)) {
      if (
        annotation.kind !== "power-label" ||
        typeof annotation.id !== "string" ||
        typeof annotation.netId !== "string"
      ) {
        continue;
      }
      const binding = isRecord(annotation.binding)
        ? annotation.binding
        : undefined;
      const anchor = isRecord(annotation.anchor)
        ? annotation.anchor
        : undefined;
      if (
        binding?.kind !== "net-name" ||
        anchor?.kind !== "object" ||
        typeof anchor.objectId !== "string" ||
        !railOwnsAnchor(routes, annotation.netId, anchor.objectId)
      ) {
        continue;
      }
      const claim = evidence.find((candidate) => {
        const owner = isRecord(candidate.owner) ? candidate.owner : undefined;
        return (
          candidate.kind === "name-claim" &&
          candidate.netId === annotation.netId &&
          candidate.scope === "local" &&
          candidate.powerDomain === "vdd" &&
          typeof candidate.name === "string" &&
          owner?.kind === "power-marker" &&
          owner.objectId === annotation.id
        );
      });
      if (!claim || typeof claim.name !== "string") continue;

      const terminalId = migratedTerminalId(
        documentId,
        annotation.id,
        terminalIds,
      );
      terminalIds.add(terminalId);
      terminals.push({
        id: terminalId,
        name: claim.name,
        netId: annotation.netId,
        direction: "inout",
        interfaceInstanceIds: [],
        interfaceAnnotationId: annotation.id,
      });
      annotation.binding = { kind: "cell-terminal-name", terminalId };
    }
    netlist.terminals = terminals;
  }
  return { ...raw, schemaVersion: 57 };
}
