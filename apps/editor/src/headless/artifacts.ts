import { prepareDocumentFormulaArtifacts } from "@icm/derived";
import type { CircuitProject } from "@icm/model";
import { createDesignNetlistExport, type NetlistFormat } from "@icm/netlist";
import { embedFormalSvgFontsHeadless } from "@icm/exporters/headless-raster";
import { renderDocumentSvg } from "@icm/render-svg";
import {
  compareCircuitIR,
  compileSpiceSources,
  DETAIL_DIFFERENCE_KINDS,
  TOPOLOGY_DIFFERENCE_KINDS,
  type StructuralComparisonOptions,
} from "@icm/spice";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import {
  createNetlistExportProfile,
  type NetlistProfileId,
} from "../features/netlist-export/netlist-process-presets";
import {
  inferNetlistProcess,
  netlistModelInclude,
  netlistProcessProjection,
  prepareNetlistExample,
  processValueConversionCode,
} from "../features/netlist-export/netlist-process";

/**
 * What a drawn workspace hands out (#1498): its netlist, its figure, and how
 * its netlist compares with a reference. The same export, render and
 * structural comparison the editor, the Gallery and the MCP's verify use.
 */

export interface WorkspaceNetlistExport {
  status: "ready" | "blocked";
  text: string | null;
  messages: string[];
  /** What the export warned about, as `CODE: message`. */
  warnings: string[];
}

function exportProjectedNetlist(
  processed: ReturnType<typeof netlistProcessProjection>,
  format: NetlistFormat,
): WorkspaceNetlistExport {
  // A GPDK045 Spectre file names the kit's library where its reader keeps it.
  const result = createDesignNetlistExport(processed.project, {
    format,
    modelInclude: netlistModelInclude(processed.project, format),
  });
  const of = (severity: string) =>
    result.diagnostics.filter((diagnostic) => diagnostic.severity === severity);
  const messages = of("error").map((diagnostic) => diagnostic.message);
  const warnings = [
    ...processed.conversions.map(
      (conversion) =>
        `${processValueConversionCode(conversion)}: ${conversion.message}`,
    ),
    ...of("warning").map(
      (diagnostic) => `${diagnostic.code}: ${diagnostic.message}`,
    ),
  ];
  return result.status === "ready"
    ? { status: "ready", text: result.file.text, messages, warnings }
    : { status: "blocked", text: null, messages, warnings };
}

/**
 * Export one Process in several netlist formats without projecting the Project
 * again for each format.
 */
export function workspaceNetlistFormats<const F extends NetlistFormat>(
  project: CircuitProject,
  formats: readonly F[],
  process?: Exclude<NetlistProfileId, "custom">,
): Record<F, WorkspaceNetlistExport> {
  const processed = process
    ? netlistProcessProjection(project, process)
    : { project, conversions: [] };
  const results = {} as Record<F, WorkspaceNetlistExport>;
  for (const format of formats)
    results[format] = exportProjectedNetlist(processed, format);
  return results;
}

/**
 * The structural netlist of the top Cell, or why it is blocked. With a
 * `process` it exports as if Apply process had set it, as the editor's
 * read-netlist does, warning of each resistor and capacitor it converted by
 * value; the Project is left as it was.
 */
export function workspaceNetlist(
  project: CircuitProject,
  format: NetlistFormat = "spice",
  process?: Exclude<NetlistProfileId, "custom">,
): WorkspaceNetlistExport {
  return workspaceNetlistFormats(project, [format], process)[format];
}

/**
 * Export the saved drawing's netlist in several formats while preparing its
 * missing defaults once.
 */
export function savedWorkspaceNetlistFormats<const F extends NetlistFormat>(
  project: CircuitProject,
  formats: readonly F[],
): Record<F, WorkspaceNetlistExport> {
  const own = createNetlistExportProfile(
    inferNetlistProcess(project, "abstract"),
  );
  return workspaceNetlistFormats(prepareNetlistExample(project, own), formats);
}

/**
 * The drawing's netlist in its own Process, as the Netlist panel shows it
 * once its missing defaults are filled: parts bound to nothing take the
 * Process's devices, authored models and values stay. The Process is the
 * one its transistors name, Abstract when none does.
 */
export function savedWorkspaceNetlist(
  project: CircuitProject,
  format: NetlistFormat = "spice",
): WorkspaceNetlistExport {
  return savedWorkspaceNetlistFormats(project, [format])[format];
}

/**
 * The top Cell as the formal SVG the editor exports, its text faces embedded
 * so it draws the same on every computer (#2427).
 */
export async function workspaceSvg(project: CircuitProject): Promise<string> {
  const document = project.documents.find(
    (candidate) => candidate.id === project.topDocumentId,
  )!;
  const prepared = await prepareDocumentFormulaArtifacts(document);
  try {
    return await embedFormalSvgFontsHeadless(
      renderDocumentSvg(
        document,
        createProjectSymbolResolver(project, builtInSymbols),
      ),
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
