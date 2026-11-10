import {
  hasRnlCommentRecords,
  type LocalReviewDelivery,
  type ReviewComparison,
} from "@icm/agent-adapter";
import { assessImportReference } from "@icm/derived";
import type { CircuitProject, SourceSpan } from "@icm/model";
import {
  analyzeDesignNetlist,
  printDesignNetlist,
  type DesignNetlistIR,
} from "@icm/netlist";
import { symbolModelType } from "@icm/rnl";
import {
  compareCircuitIR,
  compileSpiceSources,
  decodeSourceContent,
  isSpectreSource,
  type SpiceSourceInput,
} from "@icm/spice";
import type { SymbolResolver } from "@icm/symbols";
import { prepareImportSources } from "../features/netlist-export/convert-import-sources";

const MAX_DIFFERENCES = 200;

export interface ReviewSource {
  entryPath: string;
  version: string;
  files: readonly SpiceSourceInput[];
}

/**
 * Cells whose drawing still lacks an Instance or a connection the import gave.
 * An imported Cell whose import reference is gone cannot count the
 * connections, and says so with null.
 */
export function incompleteCells(
  project: CircuitProject,
  resolver: SymbolResolver,
): LocalReviewDelivery["incompleteCells"] {
  return project.documents.flatMap((document) => {
    const unplacedInstances = document.instances.filter(
      ({ placement }) => !placement,
    ).length;
    const assessment = assessImportReference(document, resolver);
    const unroutedConnections = assessment.issues.some(
      ({ code }) => code === "IMPORT_REFERENCE_UNAVAILABLE",
    )
      ? null
      : assessment.guides.length;
    return unplacedInstances || unroutedConnections !== 0
      ? [
          {
            documentId: document.id,
            name: document.name,
            unplacedInstances,
            unroutedConnections,
          },
        ]
      : [];
  });
}

function statementKey({ fileId, start, end }: SourceSpan) {
  return `${fileId}:${start.offset}:${end.offset}`;
}

/** Type evidence from the placed symbols, keyed by the model names they call. */
function drawingModelTypes(project: CircuitProject, design: DesignNetlistIR) {
  const types = new Map<string, string | undefined>();
  for (const cell of design.cells) {
    const document = project.documents.find(({ id }) => id === cell.id);
    const symbols = new Map(
      document?.instances.map(({ id, symbolId }) => [id, symbolId]),
    );
    for (const card of cell.instances) {
      if (card.invocationKind !== "primitive" || !card.target) continue;
      const symbol = symbols.get(card.id);
      const type = symbol && symbolModelType(symbol, project);
      if (!type) continue;
      const name = card.target.toLowerCase();
      // Symbols of two kinds calling one model leave its type unknown.
      types.set(
        name,
        types.has(name) && types.get(name) !== type ? undefined : type,
      );
    }
  }
  return types;
}

async function prepareReference(
  inputs: readonly SpiceSourceInput[],
  entryPath: string,
) {
  const entry = inputs.find(({ path }) => path === entryPath);
  if (
    entry &&
    isSpectreSource(entry) &&
    hasRnlCommentRecords(decodeSourceContent(entry.bytes).text)
  ) {
    const [{ loadRnlRuntime }, { readRnlHost, rnlSubcircuitNames }] =
      await Promise.all([
        import("../features/netlist-export/rnl-runtime"),
        import("../features/netlist-export/rnl-import"),
      ]);
    const runtime = await loadRnlRuntime();
    if (!runtime) throw new Error("The native RNL host reader is unavailable");
    const snapshot = await readRnlHost(runtime, inputs, entryPath, "spectre");
    return prepareImportSources(inputs, rnlSubcircuitNames(snapshot));
  }
  return prepareImportSources(inputs);
}

async function compileReference(source: ReviewSource) {
  const prepared = await prepareReference(source.files, source.entryPath);
  const compiled = await compileSpiceSources(
    prepared.inputs,
    source.entryPath,
    {
      includeRoot: "workspace",
    },
  );
  return { ...compiled, prepared };
}

/**
 * The whole design, from the top Cell, against the netlist it was imported
 * from, with verify's structural comparator. Statements Canvas does not model
 * (unread includes, model cards, parameters, analyses) and import warnings are
 * listed in `notes`; they do not decide the result.
 */
export async function compareReviewSource(
  project: CircuitProject,
  source: ReviewSource,
): Promise<ReviewComparison> {
  const unavailable = (reasons: string[]): ReviewComparison => ({
    sourceVersion: source.version,
    status: "inconclusive",
    topology: "inconclusive",
    summary: "Structural comparison is incomplete",
    comparedCells: 0,
    reasons,
    notes: [],
    differences: [],
    detailsTruncated: false,
  });
  const documentId = project.topDocumentId;
  const actualDesign = analyzeDesignNetlist(project, {
    format: "spice",
    rootDocumentId: documentId,
  });
  if (
    !actualDesign.ir ||
    actualDesign.diagnostics.some(({ severity }) => severity === "error")
  )
    return unavailable([
      "The current structural export is blocked",
      ...actualDesign.diagnostics.slice(0, 12).map(({ message }) => message),
    ]);

  const actualPath = "canvas-review.sp";
  const actualFile = printDesignNetlist("spice", actualDesign.ir);
  let actual, reference;
  try {
    [actual, reference] = await Promise.all([
      compileSpiceSources(
        [
          {
            path: actualPath,
            bytes: new TextEncoder().encode(actualFile.text),
          },
        ],
        actualPath,
      ),
      compileReference(source),
    ]);
  } catch (error) {
    return unavailable([
      error instanceof Error ? error.message : String(error),
    ]);
  }
  if (
    !actual.successful ||
    !actual.ir ||
    !reference.successful ||
    !reference.ir
  )
    return unavailable([
      "The drawing or its netlist could not be compiled",
      ...[...actual.diagnostics, ...reference.diagnostics]
        .filter(({ severity }) => severity === "error")
        .slice(0, 12)
        .map(({ message }) => message),
    ]);
  const top = project.documents.find(({ id }) => id === documentId);
  const name = top?.sourceBinding?.cellName.toLowerCase();
  const expectedRoot = name
    ? reference.ir.cells.find((cell) => cell.name.toLowerCase() === name)?.name
    : reference.ir.topCells.length === 1
      ? reference.ir.topCells[0]
      : undefined;
  const actualRoot = actualDesign.ir.cells.find(
    ({ id }) => id === documentId,
  )?.name;
  if (!actualRoot || !expectedRoot)
    return unavailable([
      "The netlist has no single top Cell matching the Project's top Cell",
    ]);

  // Resolved local includes have already contributed their Cells to this IR.
  const resolvedIncludes = new Set(
    reference.bundle.dependencies
      .filter(
        ({ status, section }) =>
          status === "resolved" || (status === "duplicate" && !section),
      )
      .map(({ sourceRef }) => statementKey(sourceRef)),
  );
  const expected = {
    ...reference.ir,
    preservedStatements: reference.ir.preservedStatements.filter(
      (statement) =>
        !(
          statement.kind === "directive" &&
          statement.name === "include" &&
          resolvedIncludes.has(statementKey(statement.sourceRef))
        ),
    ),
  };
  const result = compareCircuitIR(
    actual.ir,
    expected,
    actualRoot,
    expectedRoot,
    {
      declarations: false,
      referenceSpans: true,
      actualModelTypes: drawingModelTypes(project, actualDesign.ir),
    },
  );
  const files = new Map(
    reference.bundle.files.map(({ id, path }) => [id, path]),
  );
  return {
    sourceVersion: source.version,
    status: result.status,
    topology: result.topology,
    summary: result.summary,
    comparedCells: result.comparedCells,
    reasons: result.reasons,
    notes: [
      ...new Set([
        ...result.notes,
        ...reference.prepared.diagnostics.map(({ message }) => message),
      ]),
    ],
    detailsTruncated: result.differences.length > MAX_DIFFERENCES,
    differences: result.differences
      .slice(0, MAX_DIFFERENCES)
      .map(({ expectedSource, ...difference }) => {
        const path = expectedSource && files.get(expectedSource.fileId);
        const location =
          path &&
          expectedSource &&
          reference.prepared.originalLocation(path, expectedSource.start.line);
        return location ? { ...difference, source: location } : difference;
      }),
  };
}

/**
 * Project Info's line for an imported Project: the same comparison the Agent
 * reads, and whether the layout was edited when the circuit still matches.
 */
export async function importedSourceStatus(
  project: CircuitProject,
  source: ReviewSource,
): Promise<string> {
  const { status, summary, reasons } = await compareReviewSource(
    project,
    source,
  );
  if (status === "different")
    return `Electrically differs from the imported netlist: ${summary}`;
  if (status === "inconclusive")
    return `Not fully compared with the imported netlist: ${reasons.slice(0, 2).join("; ") || summary}`;
  return project.documents.every(
    ({ sourceStatus }) => sourceStatus === "in-sync",
  )
    ? "Matches the imported netlist"
    : "Layout edited; electrically matches the imported netlist";
}
