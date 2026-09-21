import type { Run } from "./contract.js";

/** Status projection, independent of sample count. Complete data is file-backed. */
export function runReceipt(view: Run): Run {
  const { outputData: _outputs, result, catalog, ...summary } = view;
  const resultSummary = result
    ? (() => {
        const { data: _data, ...rest } = result;
        return {
          ...rest,
          log: "",
          diagnostics: result.diagnostics
            .slice(0, 16)
            .map((d) => ({ ...d, text: d.text.slice(0, 512) })),
        };
      })()
    : undefined;
  return structuredClone({
    ...summary,
    ...(resultSummary ? { result: resultSummary } : {}),
    details: view.details ?? {
      operation: "catalog",
      runId: view.id,
      ...(catalog
        ? {
            execution: catalog.execution,
            collection: catalog.collection,
            datasetCount: catalog.datasets.length,
            fileCount: catalog.files.length,
          }
        : {}),
      diagnostics: {
        total: result?.diagnostics.length ?? 0,
        shown: Math.min(result?.diagnostics.length ?? 0, 16),
        textMayBeShortened:
          result?.diagnostics.some((d) => d.text.length > 512) ?? false,
      },
      outputDiagnostics: _outputs?.diagnostics.length ?? 0,
      specs: {
        available: _outputs?.specs !== undefined,
        total: _outputs?.specs?.results.length ?? 0,
        passed:
          _outputs?.specs?.results.filter((s) => s.judgment === "pass")
            .length ?? 0,
        failed:
          _outputs?.specs?.results.filter((s) => s.judgment === "failed")
            .length ?? 0,
        notEvaluated:
          _outputs?.specs?.results.filter((s) => s.judgment === "not-evaluated")
            .length ?? 0,
        unconstrained:
          _outputs?.specs?.results.filter((s) => s.judgment === "unconstrained")
            .length ?? 0,
      },
    },
    resultPreview: true,
  });
}

/** Called only after evidence publication succeeds; failed publication keeps its source. */
export function releaseRunData(view: Run): Run {
  if (view.result) {
    const { data: _data, ...result } = view.result;
    view = { ...view, result };
  }
  if (view.outputData)
    view = { ...view, outputData: { ...view.outputData, analyses: [] } };
  return view;
}
