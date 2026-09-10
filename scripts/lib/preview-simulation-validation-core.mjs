import { profile, SHA256 } from "./preview-simulation-qualification.mjs";
export function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is absent or is not an object.`);
  }
  return value;
}

export function diagnosticSummary(payload) {
  if (!Array.isArray(payload.diagnostics)) return "no diagnostics";
  const messages = payload.diagnostics
    .map((item) =>
      typeof item === "object" && item !== null && "text" in item
        ? String(item.text)
        : "",
    )
    .filter(Boolean);
  return messages.length > 0
    ? messages.slice(0, 3).join(" | ")
    : "no diagnostics";
}

export function validatePinnedEnvironment(environment, target) {
  const simulator = object(environment.simulator, "simulator identity");
  const models = object(environment.models, "model identity");
  if (environment.reproducibility !== "pinned") {
    throw new Error(`${target} did not verify its runtime as pinned.`);
  }
  if (environment.profileId !== profile.id) {
    throw new Error(
      `${target} reported Profile ${String(environment.profileId)}, expected ${profile.id}.`,
    );
  }
  if (
    simulator.name !== profile.simulator.name ||
    simulator.version !== profile.simulator.version ||
    simulator.binarySha256 !== profile.simulator.binarySha256
  ) {
    throw new Error(`${target} does not match the Profile simulator identity.`);
  }
  if (
    models.id !== profile.models.id ||
    models.contentSha256 !== profile.models.contentSha256
  ) {
    throw new Error(`${target} does not match the Profile model identity.`);
  }
  if (environment.startupSha256 !== profile.startup.contentSha256) {
    throw new Error(`${target} does not match the Profile startup identity.`);
  }
  if (!SHA256.test(String(environment.fingerprint))) {
    throw new Error(`${target} returned no valid environment fingerprint.`);
  }
  return { simulator, models };
}

export function transientAnalysis(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  const execution = object(result.execution, "execution metadata");
  if (execution.target !== expectedTarget) {
    throw new Error(
      `[result:wrong-executor] requested ${expectedTarget}, but the Worker reported ${String(execution.target)}.`,
    );
  }
  if (object(result.outcome, "simulation outcome").status !== "completed") {
    throw new Error(
      `[simulation:tran] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }
  validatePinnedEnvironment(
    object(object(result.metadata, "run metadata").environment, "environment"),
    expectedTarget,
  );
  const data = object(result.data, "parsed result data");
  const tran = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "tran",
      )
    : null;
  if (
    !tran ||
    !Array.isArray(tran.timeSeconds) ||
    !Array.isArray(tran.probes)
  ) {
    throw new Error(`${expectedTarget} returned no structured TRAN result.`);
  }
  return { result, tran };
}

export function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);
}

export function relativeValueError(actual, expected, absoluteTolerance = 0) {
  return (
    Math.abs(actual - expected) /
    Math.max(Math.abs(expected), absoluteTolerance || Number.MIN_VALUE)
  );
}

export function parsedNoiseAnalysis(payload, expectedTarget) {
  const result = object(payload, "simulation response");
  if (object(result.execution, "execution metadata").target !== expectedTarget)
    throw new Error(`${expectedTarget} did not execute the Noise analysis.`);
  if (object(result.outcome, "simulation outcome").status !== "completed")
    throw new Error(
      `[simulation:noise] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  const environment = object(
    object(result.metadata, "run metadata").environment,
    "environment",
  );
  validatePinnedEnvironment(environment, expectedTarget);
  const data = object(result.data, "parsed result data");
  const noise = Array.isArray(data.analyses)
    ? data.analyses.find((analysis) => analysis?.analysis === "noise")
    : null;
  if (
    !noise ||
    !Array.isArray(noise.frequencyHz) ||
    !Array.isArray(noise.outputNoiseDensity) ||
    !Array.isArray(noise.inputNoiseDensity)
  )
    throw new Error(`${expectedTarget} returned no structured Noise result.`);
  return { result, environment, noise };
}
