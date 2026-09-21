import type { ResultCatalog, Run } from "./contract.js";

/** Metadata only: selectors link representations without copying any samples. */
export function resultCatalog(
  run: Pick<
    Run,
    "id" | "preparedId" | "inputRevision" | "state" | "artifacts"
  > & {
    error?: Run["error"];
    result?: Pick<NonNullable<Run["result"]>, "outcome" | "data"> | undefined;
  },
  collection: ResultCatalog["collection"],
  signalTargets?: ResultCatalog["signalTargets"],
): ResultCatalog {
  const data = run.result?.data;
  return {
    schemaVersion: 1,
    runId: run.id,
    preparedId: run.preparedId,
    inputRevision: run.inputRevision,
    ...(signalTargets ? { signalTargets: structuredClone(signalTargets) } : {}),
    execution:
      run.state === "cancelled" || run.state === "lost"
        ? run.state
        : (run.result?.outcome.status ??
          (run.state === "finished" ? "failed" : "pending")),
    collection,
    ...(run.error ? { error: structuredClone(run.error) } : {}),
    files: run.artifacts.map((file) => ({ ...file })),
    datasets: (data?.analyses ?? []).map((analysis, analysisIndex) => {
      const axis =
        analysis.analysis === "tran"
          ? { name: "time", unit: "s" }
          : analysis.analysis === "ac" || analysis.analysis === "noise"
            ? { name: "frequency", unit: "Hz" }
            : analysis.analysis === "dc"
              ? { name: analysis.sweep.name, unit: analysis.sweep.unit }
              : undefined;
      const pointCount =
        analysis.analysis === "op"
          ? 1
          : analysis.analysis === "tran"
            ? analysis.timeSeconds.length
            : analysis.analysis === "dc"
              ? analysis.sweep.values.length
              : analysis.frequencyHz.length;
      const signals = (analysis.probes ?? []).map(
        ({ name, quantity, unit }) => ({ name, quantity, unit }),
      );
      if (analysis.analysis === "noise") {
        signals.push(
          {
            name: "outputNoiseDensity",
            quantity: "noise-density",
            unit: analysis.units.outputDensity,
          },
          {
            name: "inputNoiseDensity",
            quantity: "noise-density",
            unit: analysis.units.inputDensity,
          },
        );
      }
      const scalarRepresentations = (name: string) =>
        run.artifacts
          .filter((file) => file.role === "result")
          .map((file) => ({
            artifactId: file.id,
            fileId: file.fileId ?? file.id,
            selector: `/data/analyses/${analysisIndex}/${name}`,
          }));
      const scalars =
        analysis.analysis === "noise"
          ? [
              ...(analysis.integratedOutputNoise === undefined
                ? []
                : [
                    {
                      name: "integratedOutputNoise",
                      quantity: "integrated-output-noise",
                      unit: analysis.units.integratedOutput,
                      representations: scalarRepresentations(
                        "integratedOutputNoise",
                      ),
                    },
                  ]),
              ...(analysis.integratedInputNoise === undefined
                ? []
                : [
                    {
                      name: "integratedInputNoise",
                      quantity: "integrated-input-noise",
                      unit: analysis.units.integratedInput,
                      representations: scalarRepresentations(
                        "integratedInputNoise",
                      ),
                    },
                  ]),
            ]
          : [];
      const representations: ResultCatalog["datasets"][number]["representations"] =
        [];
      for (const file of run.artifacts) {
        if (file.role === "result")
          representations.push({
            artifactId: file.id,
            fileId: file.fileId ?? file.id,
            selector: `/data/analyses/${analysisIndex}`,
          });
        if (file.role === "table" && file.analysisIndex === analysisIndex)
          representations.push({
            artifactId: file.id,
            fileId: file.fileId ?? file.id,
            selector: "",
          });
        if (file.role === "raw") {
          for (const plot of data?.rawPlots ?? []) {
            if (
              plot.analysisIndex !== analysisIndex &&
              !analysis.rawPlotOrdinals?.includes(plot.ordinal)
            )
              continue;
            if (plot.artifactPath !== file.sourcePath) continue;
            representations.push({
              artifactId: file.id,
              fileId: file.fileId ?? file.id,
              selector: `plot:${plot.artifactPlotOrdinal ?? plot.ordinal}`,
            });
          }
        }
      }
      return {
        id: `${run.id}:analysis:${analysisIndex}`,
        analysisIndex,
        analysis: analysis.analysis,
        plotName: analysis.plotName,
        pointCount,
        ...(axis ? { axis } : {}),
        signals,
        ...(scalars.length > 0 ? { scalars } : {}),
        representations,
      };
    }),
  };
}
