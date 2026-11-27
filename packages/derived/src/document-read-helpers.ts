import type { Annotation, SchematicDocument } from "@icm/model";

import type { ResolvedDocumentLogicalNets } from "./logical-net.js";

/** Canonical key identifying one scalar/bus pin on an Instance. */
export function terminalPinKey(instanceId: string, pinName: string): string {
  return `${instanceId}\u0000${pinName}`;
}

/**
 * Base Net IDs carried by a Route or Junction: every member lane's Base Net
 * for a multi-bit bus conductor, or the single scalar `netId`.
 */
export function memberNetIds(item: {
  readonly netId: string;
  readonly members?: readonly { readonly netId: string }[] | undefined;
}): readonly string[] {
  return item.members?.length
    ? item.members.map((member) => member.netId)
    : [item.netId];
}

/** Resolve an iterable of Base Net IDs to their unique Logical Net IDs. */
export function logicalNetIdsOf(
  netIds: Iterable<string>,
  logicalNets: ResolvedDocumentLogicalNets,
): Set<string> {
  const result = new Set<string>();
  for (const netId of netIds) {
    const logicalId = logicalNets.byBaseNetId.get(netId)?.id;
    if (logicalId !== undefined) result.add(logicalId);
  }
  return result;
}

/**
 * Map every `(instanceId, pinName)` terminal to all Base Net IDs that own it
 * (preserving multi-bit bus pins that span multiple member Base Nets).
 */
export function buildTerminalBaseNetMap(
  document: Pick<SchematicDocument, "nets">,
): Map<string, Set<string>> {
  const netIdsByTerminalKey = new Map<string, Set<string>>();
  for (const net of document.nets) {
    for (const terminal of net.terminals) {
      const key = terminalPinKey(terminal.instanceId, terminal.pinName);
      const existing = netIdsByTerminalKey.get(key);
      if (existing) existing.add(net.id);
      else netIdsByTerminalKey.set(key, new Set([net.id]));
    }
  }
  return netIdsByTerminalKey;
}

/** Resolve the Base Net ID an annotation names, preferring its net-name binding. */
export function annotationNetId(
  annotation: Pick<Annotation, "netId" | "binding">,
): string | undefined {
  return annotation.binding?.kind === "net-name"
    ? annotation.binding.netId
    : annotation.netId;
}

/** Annotations not explicitly hidden (`visible !== false`). */
export function visibleDocumentAnnotations(
  document: Pick<SchematicDocument, "annotations">,
): Annotation[] {
  return document.annotations.filter(
    (annotation) => annotation.visible !== false,
  );
}
