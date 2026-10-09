import { prepareDocumentFormulaArtifacts } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport, type NetlistFormat } from "@icm/netlist";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  compareCircuitIR,
  compileSpiceSources,
  DETAIL_DIFFERENCE_KINDS,
  TOPOLOGY_DIFFERENCE_KINDS,
  type StructuralComparisonOptions,
} from "@icm/spice";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

/**
 * What a drawn workspace hands out (#1498): its netlist, its figure, and how
 * its netlist compares with a reference. The same export, render and
 * structural comparison the editor, the Gallery and the MCP's verify use.
 */

/** The structural netlist of the top Cell, or why it is blocked. */
export function workspaceNetlist(
  project: CircuitProject,
  format: NetlistFormat = "spice",
): { status: "ready" | "blocked"; text: string | null; messages: string[] } {
  const result = createDesignNetlistExport(project, { format });
  const messages = result.diagnostics
    .filter((diagnostic) => diagnostic.severity === "error")
    .map((diagnostic) => diagnostic.message);
  return result.status === "ready"
    ? { status: "ready", text: result.file.text, messages }
    : { status: "blocked", text: null, messages };
}

/** The top Cell as the formal SVG the editor exports and the Gallery shows. */
export async function workspaceSvg(project: CircuitProject): Promise<string> {
  const document = project.documents.find(
    (candidate) => candidate.id === project.topDocumentId,
  )!;
  const prepared = await prepareDocumentFormulaArtifacts(document);
  try {
    return renderDocumentSvg(
      document,
      createProjectSymbolResolver(project, builtInSymbols),
    );
  } finally {
    prepared.release();
  }
}

export interface NetlistComparison {
  status: "match" | "mismatch" | "inconclusive";
  summary?: string;
  topology?: unknown;
  counts?: Record<string, number>;
  reasons: string[];
  differences?: unknown[];
}

/**
 * Compare two SPICE netlists device by device and node by node, by name, as
 * MCP `verify` compares a drawing with an expected netlist. Each side must
 * have one top Cell unless `cell` names the reference's.
 */
export async function compareNetlists(
  actual: string,
  reference: string,
  options: { cell?: string; compare?: StructuralComparisonOptions } = {},
): Promise<NetlistComparison> {
  const compile = (text: string) =>
    compileSpiceSources(
      [{ path: "comparison.cir", bytes: new TextEncoder().encode(text) }],
      "comparison.cir",
    );
  const [drawn, expected] = await Promise.all([
    compile(actual),
    compile(reference),
  ]);
  if (!drawn.successful || !expected.successful || !drawn.ir || !expected.ir)
    return {
      status: "inconclusive",
      reasons: [
        !drawn.successful || !drawn.ir
          ? "The drawing's netlist could not be compiled"
          : "The reference netlist could not be compiled",
      ],
    };
  const drawnRoot =
    drawn.ir.topCells.length === 1 ? drawn.ir.topCells[0] : undefined;
  const expectedRoot =
    options.cell ??
    (expected.ir.topCells.length === 1 ? expected.ir.topCells[0] : undefined);
  if (!drawnRoot || !expectedRoot)
    return {
      status: "inconclusive",
      reasons: ["Name the reference's root Cell: it has several top Cells"],
    };
  const result = compareCircuitIR(
    drawn.ir,
    expected.ir,
    drawnRoot,
    expectedRoot,
    options.compare,
  );
  return {
    status:
      result.status === "equal"
        ? "match"
        : result.status === "different"
          ? "mismatch"
          : "inconclusive",
    summary: result.summary,
    topology: result.topology,
    counts: Object.fromEntries(
      [...TOPOLOGY_DIFFERENCE_KINDS, ...DETAIL_DIFFERENCE_KINDS].map((kind) => [
        kind,
        result.differences.filter((difference) => difference.kind === kind)
          .length,
      ]),
    ),
    reasons: result.reasons,
    differences: result.differences.slice(0, 200),
  };
}
