/**
 * Materialize a bounded simulation receipt from its immutable JSON artifacts.
 * The receipt remains the control-plane response; artifacts remain the single
 * source for arrays omitted from a preview.
 */
export async function materializeSimulationRunEvidence(run, readJsonArtifact) {
  if (!run.resultPreview) return run;

  const artifacts = new Map(
    run.artifacts.map((artifact) => [artifact.name, artifact]),
  );
  const resultArtifact = artifacts.get("result.json");
  if (!resultArtifact)
    throw new Error("A bounded simulation receipt has no result.json artifact");

  const result = await readJsonArtifact(resultArtifact);
  const outputArtifact = artifacts.get("outputs.json");
  const specArtifact = artifacts.get("specs.json");
  const outputs = outputArtifact
    ? await readJsonArtifact(outputArtifact)
    : undefined;
  const outputData = specArtifact
    ? {
        schemaVersion: 1,
        analyses: [],
        diagnostics: [],
        ...outputs,
        specs: await readJsonArtifact(specArtifact),
      }
    : outputs;

  return {
    ...run,
    result,
    ...(outputData === undefined ? {} : { outputData }),
    resultPreview: false,
  };
}
