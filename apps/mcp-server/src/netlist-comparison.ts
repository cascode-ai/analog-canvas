import { compileSpiceSources, compareCircuitIR } from "@icm/spice";
import { AGENT_API_VERSION } from "@icm/agent-adapter";
import type { AgentSessionClient } from "@icm/agent-client";

/** Uses the existing read-only structural export; never stages or edits a file. */
export async function compareExpectedNetlist(
  client: AgentSessionClient,
  documentId: string,
  expected: { text: string; cell?: string | undefined },
  details = false,
) {
  const exported = await client.projectResource({
    apiVersion: AGENT_API_VERSION,
    requestId: crypto.randomUUID(),
    operation: "read-netlist",
    rootDocumentId: documentId,
    format: "spice",
  });
  if (!exported.ok || exported.operation !== "read-netlist")
    return {
      status: "inconclusive",
      reasons: [
        exported.ok ? "Unexpected export response" : exported.error.message,
      ],
    };
  if (exported.netlist.status !== "ready" || exported.netlist.text === null)
    return {
      status: "inconclusive",
      reasons: ["Current structural export is blocked"],
      diagnostics: exported.netlist.diagnostics,
    };
  const compile = (text: string) =>
    compileSpiceSources(
      [{ path: "comparison.cir", bytes: new TextEncoder().encode(text) }],
      "comparison.cir",
    );
  const [actual, reference] = await Promise.all([
    compile(exported.netlist.text),
    compile(expected.text),
  ]);
  if (
    !actual.successful ||
    !reference.successful ||
    !actual.ir ||
    !reference.ir
  )
    return {
      status: "inconclusive",
      reasons: ["Structural SPICE could not be compiled"],
      diagnostics: [...actual.diagnostics, ...reference.diagnostics],
    };
  const actualRoot =
    actual.ir.topCells.length === 1 ? actual.ir.topCells[0] : undefined;
  const expectedRoot =
    expected.cell ??
    (reference.ir.topCells.length === 1 ? reference.ir.topCells[0] : undefined);
  if (!actualRoot || !expectedRoot)
    return {
      status: "inconclusive",
      reasons: [
        "Select an unambiguous root Cell; expectedNetlist.cell selects the reference root",
      ],
    };
  const result = compareCircuitIR(
    actual.ir,
    reference.ir,
    actualRoot,
    expectedRoot,
  );
  const counts = Object.fromEntries(
    ["interface", "device", "target", "parameter", "connection", "scope"].map(
      (kind) => [
        kind,
        result.differences.filter((d) => d.kind === kind).length,
      ],
    ),
  );
  return {
    status: result.status,
    counts,
    reasons: result.reasons,
    comparedCells: result.comparedCells,
    basis: "structural-export",
    structureRevision: exported.structureRevision,
    ...(details
      ? {
          differences: result.differences.slice(0, 200),
          detailsTruncated: result.differences.length > 200,
        }
      : {}),
  };
}
