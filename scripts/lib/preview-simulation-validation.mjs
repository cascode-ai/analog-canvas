import {
  diagnosticSummary,
  object,
  parsedNoiseAnalysis,
  relativeValueError,
  transientAnalysis,
  validatePinnedEnvironment,
} from "./preview-simulation-validation-core.mjs";
export function validatePreviewSimulationResult(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  const execution = object(result.execution, "execution metadata");
  if (execution.target !== expectedTarget) {
    throw new Error(
      `[result:wrong-executor] requested ${expectedTarget}, but the Worker reported ${String(execution.target)}.`,
    );
  }

  const outcome = object(result.outcome, "simulation outcome");
  if (outcome.status !== "completed") {
    const layer = outcome.status === "timed-out" ? "run" : "simulation";
    throw new Error(
      `[${layer}:${String(outcome.status)}] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }

  const metadata = object(result.metadata, "run metadata");
  const input = object(metadata.input, "input metadata");
  const expectedRevision = `preview-smoke-${expectedTarget}`;
  if (input.inputRevision !== expectedRevision) {
    throw new Error(
      `[result:stale-input] requested ${expectedRevision}, but the Worker returned ${String(input.inputRevision)}.`,
    );
  }
  const environment = object(metadata.environment, "environment metadata");
  const { simulator } = validatePinnedEnvironment(environment, expectedTarget);

  const data = object(result.data, "parsed result data");
  if (!Array.isArray(data.analyses)) {
    throw new Error(`${expectedTarget} returned no parsed analyses.`);
  }
  const operatingPoint = data.analyses.find(
    (analysis) =>
      typeof analysis === "object" &&
      analysis !== null &&
      analysis.analysis === "op",
  );
  if (!operatingPoint || !Array.isArray(operatingPoint.probes)) {
    throw new Error(`${expectedTarget} returned no operating-point analysis.`);
  }
  const midpoint = operatingPoint.probes.find(
    (probe) =>
      typeof probe === "object" && probe !== null && probe.name === "v(mid)",
  );
  if (!midpoint || typeof midpoint.value !== "number") {
    throw new Error(`${expectedTarget} returned no scalar v(mid).`);
  }
  if (Math.abs(midpoint.value - 0.5) > 1e-12) {
    throw new Error(
      `${expectedTarget} solved the equal divider as ${midpoint.value}, expected 0.5.`,
    );
  }

  return {
    target: expectedTarget,
    value: midpoint.value,
    environmentFingerprint: environment.fingerprint,
    simulatorVersion: simulator.version,
  };
}

export function validateRcTransientResult(payload, expectedTarget) {
  const { tran } = transientAnalysis(payload, expectedTarget);
  if (
    tran.timeSeconds.length !== 1027 ||
    Math.abs(tran.timeSeconds.at(-1) - 1e-5) > 1e-15
  ) {
    throw new Error(`${expectedTarget} returned an unexpected RC time axis.`);
  }
  const output = tran.probes.find((probe) => probe?.name === "v(out)");
  if (!output || !Array.isArray(output.value)) {
    throw new Error(`${expectedTarget} returned no RC v(out) series.`);
  }
  const maximum = Math.max(...output.value);
  const last = output.value.at(-1);
  if (
    typeof last !== "number" ||
    Math.abs(maximum - 0.9932657010978244) > 1e-10 ||
    Math.abs(last - 0.006702329182061853) > 1e-10
  ) {
    throw new Error(
      `${expectedTarget} returned unexpected RC step values (max=${maximum}, last=${String(last)}).`,
    );
  }
  return { target: expectedTarget, pointCount: tran.timeSeconds.length };
}

export function validateDcDividerResult(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  if (object(result.outcome, "simulation outcome").status !== "completed") {
    throw new Error(
      `[simulation:dc] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }
  validatePinnedEnvironment(
    object(object(result.metadata, "run metadata").environment, "environment"),
    expectedTarget,
  );
  const data = object(result.data, "parsed result data");
  const dc = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "dc",
      )
    : null;
  if (!dc || !Array.isArray(dc.sweep?.values) || !Array.isArray(dc.probes)) {
    throw new Error(`${expectedTarget} returned no structured DC result.`);
  }
  if (dc.sweep.name !== "v(v-sweep)") {
    throw new Error(`${expectedTarget} returned an unexpected DC sweep axis.`);
  }
  const expectedAxis = [0, 0.5, 1, 1.5];
  if (
    dc.sweep.values.length !== expectedAxis.length ||
    dc.sweep.values.some((value, index) => value !== expectedAxis[index])
  ) {
    throw new Error(`${expectedTarget} returned unexpected DC sweep values.`);
  }
  const output = dc.probes.find((probe) => probe?.name === "v(out)");
  if (
    !output ||
    !Array.isArray(output.value) ||
    output.value.some(
      (value, index) => Math.abs(value - expectedAxis[index] / 2) > 1e-12,
    )
  ) {
    throw new Error(
      `${expectedTarget} returned an incorrect DC divider curve.`,
    );
  }
  return { target: expectedTarget, pointCount: expectedAxis.length };
}

export function validateResistorNoiseResult(payload, expectedTarget) {
  const { noise } = parsedNoiseAnalysis(payload, expectedTarget);
  if (noise.frequencyHz.length !== 7)
    throw new Error(`${expectedTarget} returned an unexpected Noise axis.`);
  const kelvin = 273.15 + 27;
  const boltzmann = 1.380649e-23;
  const expectedOutputDensity = Math.sqrt(4 * boltzmann * kelvin * 500);
  const firstOutput = noise.outputNoiseDensity[0];
  const firstInput = noise.inputNoiseDensity[0];
  if (
    typeof firstOutput !== "number" ||
    relativeValueError(firstOutput, expectedOutputDensity) > 2e-4 ||
    typeof firstInput !== "number" ||
    relativeValueError(firstInput, expectedOutputDensity * 2) > 2e-4
  )
    throw new Error(
      `${expectedTarget} returned resistor Noise inconsistent with 4kTR.`,
    );
  const expectedIntegrated = expectedOutputDensity * Math.sqrt(990);
  if (
    typeof noise.integratedOutputNoise !== "number" ||
    relativeValueError(noise.integratedOutputNoise, expectedIntegrated) >
      2e-4 ||
    typeof noise.integratedInputNoise !== "number" ||
    relativeValueError(noise.integratedInputNoise, expectedIntegrated * 2) >
      2e-4
  )
    throw new Error(`${expectedTarget} returned incorrect integrated Noise.`);
  return {
    target: expectedTarget,
    pointCount: noise.frequencyHz.length,
    outputDensity: firstOutput,
  };
}
