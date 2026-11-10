import { hasRnlCommentRecords } from "@icm/agent-adapter";
import { deviceDescriptor } from "@icm/devices";
import type { CircuitProject, SourceSpan } from "@icm/model";
import {
  analyzeDesignNetlist,
  printDesignNetlist,
  type DesignNetlistIR,
} from "@icm/netlist";
import {
  compareCircuitIR,
  compileSpiceSources,
  decodeSourceContent,
  isSpectreSource,
  type SpiceSourceInput,
} from "@icm/spice";
import { prepareImportSources } from "../features/netlist-export/convert-import-sources";

const MAX_DIFFERENCES = 200;

function statementKey({ fileId, start, end }: SourceSpan) {
  return `${fileId}:${start.offset}:${end.offset}`;
}

/** Type evidence from the actual placed symbols, keyed by their exported model names. */
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
      const known = symbol && deviceDescriptor(symbol, project);
      const type = known
        ? (known.mosBulkClass ??
          (known.symbolId === "diode"
            ? "d"
            : ["npn", "pnp"].find((id) => id === known.symbolId)))
        : undefined;
      const name = card.target.toLowerCase();
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

/** Compare the selected Cell and its descendants using verify's structural comparator. */
export async function compareReviewSource(
  project: CircuitProject,
  documentId: string,
  source: {
    entryPath: string;
    version: string;
    files: readonly SpiceSourceInput[];
  },
) {
  const unavailable = (reasons: string[]) => ({
    sourceVersion: source.version,
    status: "inconclusive" as const,
    topology: "inconclusive" as const,
    summary: "Structural comparison is incomplete",
    reasons,
    comparedCells: 0,
    differences: [],
    detailsTruncated: false,
    drawingChanged: false,
  });
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

  let prepared;
  try {
    prepared = await prepareReference(source.files, source.entryPath);
  } catch (error) {
    return unavailable([
      error instanceof Error ? error.message : String(error),
    ]);
  }
  const actualPath = "canvas-review.sp";
  const actualFile = printDesignNetlist("spice", actualDesign.ir);
  const [actual, reference] = await Promise.all([
    compileSpiceSources(
      [
        {
          path: actualPath,
          bytes: new TextEncoder().encode(actualFile.text),
        },
      ],
      actualPath,
    ),
    compileSpiceSources(prepared.inputs, source.entryPath, {
      includeRoot: "workspace",
    }),
  ]);
  if (
    !actual.successful ||
    !actual.ir ||
    !reference.successful ||
    !reference.ir
  )
    return unavailable([
      "The draft or original source could not be compiled",
      ...[...actual.diagnostics, ...reference.diagnostics]
        .filter(({ severity }) => severity === "error")
        .slice(0, 12)
        .map(({ message }) => message),
    ]);
  const root = project.documents.find(({ id }) => id === documentId);
  const name = root?.sourceBinding?.cellName.toLowerCase();
  const expectedRoot = name
    ? reference.ir.cells.find((cell) => cell.name.toLowerCase() === name)?.name
    : documentId === project.topDocumentId && reference.ir.topCells.length === 1
      ? reference.ir.topCells[0]
      : undefined;
  const actualRoot = actualDesign.ir.cells.find(
    ({ id }) => id === documentId,
  )?.name;
  if (!actualRoot || !expectedRoot)
    return unavailable([
      "The compared source must have an unambiguous root Cell",
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
      referenceSpans: true,
      actualModelTypes: drawingModelTypes(project, actualDesign.ir),
    },
  );
  const files = new Map(
    reference.bundle.files.map(({ id, path }) => [id, path]),
  );
  const comparedDocuments = new Set(actualDesign.ir.cells.map(({ id }) => id));
  const reasons = [
    ...result.reasons,
    ...prepared.diagnostics.map(({ message }) => message),
  ];
  const conversionIncomplete = prepared.diagnostics.length > 0;
  const status = conversionIncomplete
    ? ("inconclusive" as const)
    : result.status;
  return {
    ...result,
    status,
    summary: conversionIncomplete
      ? `Structural comparison is incomplete. ${result.summary}`
      : result.summary,
    reasons,
    sourceVersion: source.version,
    drawingChanged:
      status === "equal" &&
      project.documents.some(
        ({ id, sourceStatus }) =>
          comparedDocuments.has(id) && sourceStatus === "geometry-only-changed",
      ),
    detailsTruncated: result.differences.length > MAX_DIFFERENCES,
    differences: result.differences
      .slice(0, MAX_DIFFERENCES)
      .map(({ expectedSource, ...difference }) => {
        const path = expectedSource && files.get(expectedSource.fileId);
        const source =
          path &&
          expectedSource &&
          prepared.originalLocation(path, expectedSource.start.line);
        return source ? { ...difference, source } : difference;
      }),
  };
}
