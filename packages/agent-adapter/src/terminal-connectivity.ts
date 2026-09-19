import { resolveDocumentLogicalNets } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";

/** Document-local terminal equivalence, independent of routes and net IDs.
 * This is not a claim about device parameters, bulk defaults or hierarchy.
 */
export function terminalConnectivity(document: SchematicDocument): string {
  const resolution = resolveDocumentLogicalNets(document);
  const groups = new Map<string, string[]>();
  for (const net of document.nets) {
    const id = resolution.byBaseNetId.get(net.id)?.id ?? net.id;
    const terminals = groups.get(id) ?? [];
    for (const terminal of net.terminals)
      terminals.push(JSON.stringify([terminal.instanceId, terminal.pinName]));
    groups.set(id, terminals);
  }
  return JSON.stringify(
    [...groups.values()]
      .map((terminals) => [...new Set(terminals)].sort())
      .filter((terminals) => terminals.length > 1)
      .map((terminals) => JSON.stringify(terminals))
      .sort(),
  );
}
