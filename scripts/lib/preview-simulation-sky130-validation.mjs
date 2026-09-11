import { createHash } from "node:crypto";
import {
  extendedQualification,
  profile,
  qualification,
} from "./preview-simulation-qualification.mjs";
import {
  diagnosticSummary,
  object,
  parsedNoiseAnalysis,
  relativeError,
  relativeValueError,
  transientAnalysis,
  validatePinnedEnvironment,
} from "./preview-simulation-validation-core.mjs";

/** Source runs carry their model load in the prepared input, not a second GUI field. */
export function validateQualifiedModelSelection(
  result,
  expectedTarget,
  sourceInput,
) {
  const metadata = object(result.metadata, "run metadata");
  const selection = object(
    metadata.configuration,
    "configuration metadata",
  ).modelLibrary;
  if (selection !== null) {
    const modelLibrary = object(selection, "model selection");
    if (
      modelLibrary.directive === qualification.modelLibrary.directive &&
      modelLibrary.section === qualification.modelLibrary.section
    )
      return;
  } else if (sourceInput) {
    const dependency = sourceInput.dependencies?.find(
      (item) =>
        item.id === profile.models.id &&
        item.sha256 === profile.models.contentSha256,
    );
    const relative =
      dependency &&
      "../".repeat(sourceInput.entryPath.split("/").length - 1) +
        dependency.mountPath;
    const expectedLoad = `.lib "${relative}" ${qualification.modelLibrary.section}`;
    const input = object(metadata.input, "input metadata");
    if (
      dependency &&
      sourceInput.environment?.profileId === profile.id &&
      sourceInput.environment?.corner === qualification.modelLibrary.section &&
      sourceInput.testbench
        .split(/\r?\n/u)
        .some((line) => line.trim() === expectedLoad) &&
      createHash("sha256").update(sourceInput.testbench).digest("hex") ===
        input.testbenchSha256 &&
      sourceInput.inputRevision === input.inputRevision
    ) {
      validatePinnedEnvironment(
        object(metadata.environment, "environment metadata"),
        expectedTarget,
      );
      return;
    }
  }
  throw Error(
    `${expectedTarget} did not run the qualified model-library section with verified input evidence.`,
  );
}
export function validateHostedSky130TransientResult(
  payload,
  expectedTarget,
  expectedInputRevision,
  expectedVectors,
  sourceInput,
) {
  const { result, tran } = transientAnalysis(payload, expectedTarget);
  const metadata = object(result.metadata, "run metadata");
  const input = object(metadata.input, "input metadata");
  if (input.inputRevision !== expectedInputRevision) {
    throw new Error(`${expectedTarget} returned stale structured TRAN data.`);
  }
  validateQualifiedModelSelection(result, expectedTarget, sourceInput);
  const expected = qualification.expectedTran;
  if (
    tran.timeSeconds.length !== expected.pointCount ||
    Math.abs(tran.timeSeconds.at(-1) - expected.stopSeconds) >
      expected.timeAbsoluteTolerance
  ) {
    throw new Error(`${expectedTarget} returned an unexpected OTA time axis.`);
  }
  for (const binding of expectedVectors) {
    const probe = tran.probes.find(
      (candidate) => candidate?.name === binding.vector,
    );
    if (
      !probe ||
      !Array.isArray(probe.value) ||
      probe.value.length !== expected.pointCount
    ) {
      throw new Error(
        `${expectedTarget} returned no complete TRAN series for ${binding.vector}.`,
      );
    }
  }
  for (const [name, expectation] of Object.entries(expected.probes)) {
    const probe = tran.probes.find((candidate) => candidate?.name === name);
    if (!probe || !Array.isArray(probe.value)) {
      throw new Error(
        `${expectedTarget} returned no qualified TRAN series ${name}.`,
      );
    }
    const actual = {
      first: probe.value[0],
      minimum: Math.min(...probe.value),
      maximum: Math.max(...probe.value),
      last: probe.value.at(-1),
    };
    for (const key of ["first", "minimum", "maximum", "last"]) {
      if (
        typeof actual[key] !== "number" ||
        Math.abs(actual[key] - expectation[key]) > expectation.absoluteTolerance
      ) {
        throw new Error(
          `${expectedTarget} solved TRAN ${name}.${key} as ${String(actual[key])}, expected ${expectation[key]}.`,
        );
      }
    }
  }
  return { target: expectedTarget, pointCount: tran.timeSeconds.length };
}

export function validateHostedSky130NoiseResult(
  payload,
  expectedTarget,
  expectedInputRevision,
  _expectedVectors,
  sourceInput,
) {
  const { result, environment, noise } = parsedNoiseAnalysis(
    payload,
    expectedTarget,
  );
  const metadata = object(result.metadata, "run metadata");
  if (
    object(metadata.input, "input metadata").inputRevision !==
    expectedInputRevision
  )
    throw new Error(`${expectedTarget} returned stale structured Noise data.`);
  validateQualifiedModelSelection(result, expectedTarget, sourceInput);
  const expected = qualification.expectedNoise;
  if (environment.fingerprint !== expected.evidence.environmentFingerprint)
    throw new Error(
      `${expectedTarget} Noise evidence came from a different environment.`,
    );
  if (
    noise.frequencyHz.length !== expected.pointCount ||
    noise.outputNoiseDensity.length !== expected.pointCount ||
    noise.inputNoiseDensity.length !== expected.pointCount
  )
    throw new Error(
      `${expectedTarget} returned an incomplete OTA Noise result.`,
    );
  for (const sample of expected.samples) {
    const frequency = noise.frequencyHz[sample.index];
    const output = noise.outputNoiseDensity[sample.index];
    const input = noise.inputNoiseDensity[sample.index];
    if (
      typeof frequency !== "number" ||
      relativeValueError(frequency, sample.frequencyHz) >
        expected.frequencyRelativeTolerance ||
      typeof output !== "number" ||
      (Math.abs(output - sample.outputNoiseDensity) >
        expected.valueAbsoluteTolerance &&
        relativeValueError(
          output,
          sample.outputNoiseDensity,
          expected.valueAbsoluteTolerance,
        ) > expected.valueRelativeTolerance) ||
      typeof input !== "number" ||
      (Math.abs(input - sample.inputNoiseDensity) >
        expected.valueAbsoluteTolerance &&
        relativeValueError(
          input,
          sample.inputNoiseDensity,
          expected.valueAbsoluteTolerance,
        ) > expected.valueRelativeTolerance)
    )
      throw new Error(
        `${expectedTarget} returned unexpected OTA Noise at index ${sample.index}.`,
      );
  }
  for (const [key, expectedValue] of [
    ["integratedOutputNoise", expected.integratedOutputNoise],
    ["integratedInputNoise", expected.integratedInputNoise],
  ]) {
    const actual = noise[key];
    if (
      typeof actual !== "number" ||
      relativeValueError(
        actual,
        expectedValue,
        expected.valueAbsoluteTolerance,
      ) > expected.valueRelativeTolerance
    )
      throw new Error(
        `${expectedTarget} returned unexpected OTA ${key}: ${String(actual)}.`,
      );
  }
  if (JSON.stringify(noise.units) !== JSON.stringify(expected.units))
    throw new Error(`${expectedTarget} returned unexpected Noise units.`);
  return {
    target: expectedTarget,
    pointCount: noise.frequencyHz.length,
    integratedOutputNoise: noise.integratedOutputNoise,
    integratedInputNoise: noise.integratedInputNoise,
    environmentFingerprint: environment.fingerprint,
  };
}

export function validateHostedSky130Result(
  payload,
  expectedTarget,
  expectedInputRevision,
  expectedVectors,
  sourceInput,
) {
  const result = object(payload, "simulation response");
  const execution = object(result.execution, "execution metadata");
  if (execution.target !== expectedTarget) {
    throw new Error(
      `[result:wrong-executor] requested ${expectedTarget}, but the Worker reported ${String(execution.target)}.`,
    );
  }
  if (object(result.outcome, "simulation outcome").status !== "completed") {
    throw new Error(
      `[simulation:model-qualification] ${expectedTarget} did not complete: ${diagnosticSummary(result)}`,
    );
  }
  const metadata = object(result.metadata, "run metadata");
  const input = object(metadata.input, "input metadata");
  if (input.inputRevision !== expectedInputRevision) {
    throw new Error(
      `[result:stale-input] requested ${expectedInputRevision}, but the Worker returned ${String(input.inputRevision)}.`,
    );
  }
  validateQualifiedModelSelection(result, expectedTarget, sourceInput);
  const environment = object(metadata.environment, "environment metadata");
  validatePinnedEnvironment(environment, expectedTarget);

  const data = object(result.data, "parsed result data");
  const operatingPoint = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "op",
      )
    : null;
  if (!operatingPoint || !Array.isArray(operatingPoint.probes)) {
    throw new Error(`${expectedTarget} returned no qualified OP result.`);
  }

  const values = {};
  for (const [name, expected] of Object.entries(qualification.expectedProbes)) {
    const probe = operatingPoint.probes.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        candidate.name === name,
    );
    if (!probe || typeof probe.value !== "number") {
      throw new Error(`${expectedTarget} returned no scalar ${name}.`);
    }
    if (Math.abs(probe.value - expected.value) > expected.absoluteTolerance) {
      throw new Error(
        `${expectedTarget} solved ${name} as ${probe.value}, expected ${expected.value} ± ${expected.absoluteTolerance}.`,
      );
    }
    values[name] = probe.value;
  }

  const dc = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "dc",
      )
    : null;
  const expectedDc = qualification.expectedDc;
  if (!dc || !Array.isArray(dc.sweep?.values) || !Array.isArray(dc.probes)) {
    throw new Error(`${expectedTarget} returned no qualified DC result.`);
  }
  if (
    dc.sweep.name !== expectedDc.sweepName ||
    dc.sweep.values.length !== expectedDc.pointCount ||
    Math.abs(dc.sweep.values[0] - expectedDc.startValue) >
      expectedDc.absoluteTolerance ||
    Math.abs(dc.sweep.values.at(-1) - expectedDc.stopValue) >
      expectedDc.absoluteTolerance
  ) {
    throw new Error(`${expectedTarget} returned an unexpected OTA DC axis.`);
  }
  for (const binding of expectedVectors) {
    const probe = dc.probes.find(
      (candidate) => candidate?.name === binding.vector,
    );
    if (!probe || !Array.isArray(probe.value)) {
      throw new Error(
        `${expectedTarget} returned no DC series for ${binding.probeId} (${binding.vector}).`,
      );
    }
    if (probe.value.length !== expectedDc.pointCount) {
      throw new Error(
        `${expectedTarget} returned an incomplete DC series for ${binding.vector}.`,
      );
    }
  }
  for (const [name, expected] of Object.entries(expectedDc.probes)) {
    const probe = dc.probes.find((candidate) => candidate?.name === name);
    if (!probe || !Array.isArray(probe.value)) {
      throw new Error(
        `${expectedTarget} returned no qualified DC series ${name}.`,
      );
    }
    for (const sample of expected.samples) {
      const actual = probe.value[sample.index];
      if (
        typeof actual !== "number" ||
        Math.abs(actual - sample.value) > expectedDc.absoluteTolerance
      ) {
        throw new Error(
          `${expectedTarget} solved ${name}[${sample.index}] as ${String(actual)}, expected ${sample.value} ± ${expectedDc.absoluteTolerance}.`,
        );
      }
    }
  }

  const ac = Array.isArray(data.analyses)
    ? data.analyses.find(
        (analysis) =>
          typeof analysis === "object" &&
          analysis !== null &&
          analysis.analysis === "ac",
      )
    : null;
  if (!ac || !Array.isArray(ac.frequencyHz) || !Array.isArray(ac.probes)) {
    throw new Error(`${expectedTarget} returned no qualified AC result.`);
  }
  const expectedAc = qualification.expectedAc;
  if (ac.frequencyHz.length !== expectedAc.pointCount) {
    throw new Error(
      `${expectedTarget} returned ${ac.frequencyHz.length} AC points, expected ${expectedAc.pointCount}.`,
    );
  }
  const firstFrequency = ac.frequencyHz[0];
  const lastFrequency = ac.frequencyHz.at(-1);
  if (
    typeof firstFrequency !== "number" ||
    relativeError(firstFrequency, expectedAc.startHz) >
      expectedAc.frequencyRelativeTolerance ||
    typeof lastFrequency !== "number" ||
    relativeError(lastFrequency, expectedAc.stopHz) >
      expectedAc.frequencyRelativeTolerance
  ) {
    throw new Error(
      `${expectedTarget} returned an unexpected AC frequency axis (${String(firstFrequency)} .. ${String(lastFrequency)}).`,
    );
  }
  for (const binding of expectedVectors) {
    const probe = ac.probes.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        candidate.name === binding.vector,
    );
    if (!probe || !Array.isArray(probe.real) || !Array.isArray(probe.imag)) {
      throw new Error(
        `${expectedTarget} returned no AC series for ${binding.probeId} (${binding.vector}).`,
      );
    }
    if (
      probe.real.length !== expectedAc.pointCount ||
      probe.imag.length !== expectedAc.pointCount
    ) {
      throw new Error(
        `${expectedTarget} returned an incomplete AC series for ${binding.vector}.`,
      );
    }
  }
  for (const [name, expected] of Object.entries(expectedAc.probes)) {
    const probe = ac.probes.find(
      (candidate) =>
        typeof candidate === "object" &&
        candidate !== null &&
        candidate.name === name,
    );
    if (!probe || !Array.isArray(probe.real) || !Array.isArray(probe.imag)) {
      throw new Error(
        `${expectedTarget} returned no qualified AC series ${name}.`,
      );
    }
    for (const sample of expected.samples) {
      const real = probe.real[sample.index];
      const imag = probe.imag[sample.index];
      if (
        typeof real !== "number" ||
        typeof imag !== "number" ||
        Math.abs(real - sample.real) > sample.absoluteTolerance ||
        Math.abs(imag - sample.imag) > sample.absoluteTolerance
      ) {
        throw new Error(
          `${expectedTarget} solved ${name}[${sample.index}] as ${String(real)} + j${String(imag)}, expected ${sample.real} + j${sample.imag} ± ${sample.absoluteTolerance}.`,
        );
      }
    }
  }
  validateHostedSky130TransientResult(
    payload,
    expectedTarget,
    expectedInputRevision,
    expectedVectors,
    sourceInput,
  );
  return {
    target: expectedTarget,
    fixtureId: qualification.fixtureId,
    values,
    environmentFingerprint: environment.fingerprint,
  };
}

export function validateHostedSky130CornerResult(
  payload,
  expectedTarget,
  corner,
) {
  const expected = qualification.expectedCorners?.[corner];
  if (!expected)
    throw new Error(`No qualification evidence exists for ${corner}.`);
  const result = object(payload, "simulation response");
  if (object(result.execution, "execution metadata").target !== expectedTarget)
    throw new Error(`${expectedTarget} did not execute corner ${corner}.`);
  if (object(result.outcome, "simulation outcome").status !== "completed")
    throw new Error(`${expectedTarget} did not complete corner ${corner}.`);
  const metadata = object(result.metadata, "run metadata");
  const configuration = object(
    metadata.configuration,
    "configuration metadata",
  );
  const modelLibrary = object(configuration.modelLibrary, "model selection");
  if (
    modelLibrary.directive !== profile.models.library.directive ||
    modelLibrary.section !== corner
  )
    throw new Error(
      `${expectedTarget} loaded ${String(modelLibrary.section)}, expected corner ${corner}.`,
    );
  const environment = object(metadata.environment, "environment metadata");
  validatePinnedEnvironment(environment, expectedTarget);
  if (
    environment.fingerprint !==
    qualification.cornerEvidence.environmentFingerprint
  )
    throw new Error(
      `${expectedTarget} corner evidence came from a different environment.`,
    );
  const data = object(result.data, "parsed result data");
  const operatingPoint = Array.isArray(data.analyses)
    ? data.analyses.find((analysis) => analysis?.analysis === "op")
    : null;
  if (!operatingPoint || !Array.isArray(operatingPoint.probes))
    throw new Error(`${expectedTarget} returned no OP result for ${corner}.`);
  const readCurrent = (name) => {
    const probe = operatingPoint.probes.find(
      (candidate) => candidate?.name === name,
    );
    if (typeof probe?.value !== "number")
      throw new Error(`${expectedTarget} returned no ${name} for ${corner}.`);
    return probe.value;
  };
  const nfetCurrentA = readCurrent("i(vdn)");
  const pfetSourceCurrentA = readCurrent("i(vsp)");
  const tolerance = qualification.cornerEvidence.absoluteTolerance;
  if (
    Math.abs(nfetCurrentA - expected.nfetCurrentA) > tolerance ||
    Math.abs(pfetSourceCurrentA - expected.pfetSourceCurrentA) > tolerance
  )
    throw new Error(
      `${expectedTarget} returned unexpected ${corner} currents ` +
        `(NFET=${nfetCurrentA}, PFET=${pfetSourceCurrentA}).`,
    );
  return { corner, nfetCurrentA, pfetSourceCurrentA };
}

export function validateHostedSky130ExtendedDeviceResult(
  payload,
  expectedTarget,
  corner,
) {
  const expected = extendedQualification.expectedCorners?.[corner];
  if (!expected)
    throw new Error(`No extended-device evidence exists for ${corner}.`);
  const result = object(payload, "simulation response");
  if (object(result.execution, "execution metadata").target !== expectedTarget)
    throw new Error(
      `${expectedTarget} did not execute extended devices at ${corner}.`,
    );
  if (object(result.outcome, "simulation outcome").status !== "completed")
    throw new Error(
      `${expectedTarget} did not complete extended devices at ${corner}.`,
    );
  const metadata = object(result.metadata, "run metadata");
  const modelLibrary = object(
    object(metadata.configuration, "configuration metadata").modelLibrary,
    "model selection",
  );
  if (
    modelLibrary.directive !== profile.models.library.directive ||
    modelLibrary.section !== corner
  )
    throw new Error(
      `${expectedTarget} loaded ${String(modelLibrary.section)}, expected corner ${corner}.`,
    );
  const environment = object(metadata.environment, "environment metadata");
  validatePinnedEnvironment(environment, expectedTarget);
  if (
    environment.fingerprint !==
    extendedQualification.evidence.environmentFingerprint
  )
    throw new Error(
      `${expectedTarget} extended-device evidence came from a different environment.`,
    );
  const data = object(result.data, "parsed result data");
  const analyses = Array.isArray(data.analyses) ? data.analyses : [];
  const operatingPoint = analyses.find(
    (analysis) => analysis?.analysis === "op",
  );
  const ac = analyses.find((analysis) => analysis?.analysis === "ac");
  if (!Array.isArray(operatingPoint?.probes) || !Array.isArray(ac?.probes))
    throw new Error(
      `${expectedTarget} returned incomplete extended-device analyses for ${corner}.`,
    );
  const scalar = (name) => {
    const probe = operatingPoint.probes.find(
      (candidate) => candidate?.name === name,
    );
    if (typeof probe?.value !== "number")
      throw new Error(`${expectedTarget} returned no ${name} for ${corner}.`);
    return probe.value;
  };
  const cap = ac.probes.find((candidate) => candidate?.name === "v(capout)");
  if (
    !Array.isArray(cap?.real) ||
    !Array.isArray(cap?.imag) ||
    typeof cap.real[0] !== "number" ||
    typeof cap.imag[0] !== "number"
  )
    throw new Error(
      `${expectedTarget} returned no MIM AC response for ${corner}.`,
    );
  const actual = {
    lvtNfetCurrentA: scalar("i(vdnl)"),
    lvtPfetSourceCurrentA: scalar("i(vspl)"),
    resistorOutputV: scalar("v(rout)"),
    resistorSupplyCurrentA: scalar("i(vrin)"),
    pnpEmitterCurrentA: scalar("i(vpe)"),
    pnpCollectorCurrentA: scalar("i(vpc)"),
    mimOutputReal: cap.real[0],
    mimOutputImag: cap.imag[0],
  };
  const tolerances = extendedQualification.tolerances;
  const checks = [
    ["lvtNfetCurrentA", tolerances.mosCurrentA],
    ["lvtPfetSourceCurrentA", tolerances.mosCurrentA],
    ["resistorOutputV", tolerances.resistorVoltageV],
    ["resistorSupplyCurrentA", tolerances.resistorCurrentA],
    ["pnpEmitterCurrentA", tolerances.pnpCurrentA],
    ["pnpCollectorCurrentA", tolerances.pnpCurrentA],
    ["mimOutputReal", tolerances.mimComplex],
    ["mimOutputImag", tolerances.mimComplex],
  ];
  for (const [name, tolerance] of checks) {
    if (Math.abs(actual[name] - expected[name]) > tolerance)
      throw new Error(
        `${expectedTarget} solved ${name} at ${corner} as ${actual[name]}, expected ${expected[name]} ± ${tolerance}.`,
      );
  }
  return { corner, ...actual };
}
