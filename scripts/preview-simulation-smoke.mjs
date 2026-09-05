/**
 * Preview's numerical simulation smoke.
 *
 * The deck is sent through every configured hosted transport — since
 * 2026-09-04 that is the operator host alone; the Cloudflare Container was
 * removed. A green HTTP response is not enough: the selected executor,
 * terminal outcome, rawfile-derived operating-point value, and measured
 * simulator/model identity all have to be present, and when more than one
 * transport is configured their environment fingerprints must agree because
 * they run the same pinned image.
 */
import { pathToFileURL } from "node:url";
import { readFileSync } from "node:fs";

const profile = JSON.parse(
  readFileSync(
    new URL(
      "../containers/ngspice/hosted-sky130-profile.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const qualification = JSON.parse(
  readFileSync(
    new URL(
      "../fixtures/simulation-acceptance/hosted-sky130-core-continuous-v1.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
if (qualification.profileId !== profile.id) {
  throw new Error(
    `Qualification ${qualification.fixtureId} targets ${String(qualification.profileId)}, not Profile ${profile.id}.`,
  );
}
for (const analysis of qualification.analyses) {
  if (!profile.qualifiedScope.analyses.includes(analysis)) {
    throw new Error(
      `Qualification ${qualification.fixtureId} uses undeclared analysis ${String(analysis)}.`,
    );
  }
}
if (
  qualification.modelLibrary.directive !== profile.models.library.directive ||
  !profile.models.library.sections.includes(qualification.modelLibrary.section)
) {
  throw new Error(
    `Qualification ${qualification.fixtureId} uses a model selection outside Profile ${profile.id}.`,
  );
}

const EXECUTORS = ["operator-host"];
const SHA256 = /^[0-9a-f]{64}$/u;
const REQUEST_ERRORS = new Set([
  "deck-too-large",
  "invalid-json",
  "invalid-request",
  "method-not-allowed",
]);

export const DIVIDER_REQUEST = {
  netlist: [
    ".subckt divider in out",
    "R1 in out 1k",
    "R2 out 0 1k",
    ".ends divider",
  ].join("\n"),
  testbench: [
    "V1 in 0 DC 1",
    "X1 in mid divider",
    ".control",
    "set filetype=ascii",
    "op",
    "write out.raw v(mid)",
    ".endc",
    ".end",
  ].join("\n"),
  timeoutMs: 110_000,
};

export const RC_TRAN_REQUEST = {
  mode: "raw",
  netlist: "",
  testbench: [
    "RC transient qualification",
    "V1 in 0 PULSE(0 1 0 1n 1n 5u 10u)",
    "R1 in out 1k",
    "C1 out 0 1n",
    ".control",
    "set filetype=ascii",
    "tran 10n 10u",
    "write out.raw v(in) v(out)",
    ".endc",
    ".end",
  ].join("\n"),
  timeoutMs: 30_000,
};

export async function compileHostedSky130Project() {
  const [{ compileStructuredSimulation }, { parseProject }] = await Promise.all(
    [import("@icm/netlist"), import("@icm/project-protocol")],
  );
  const project = parseProject(
    readFileSync(
      new URL(`../${qualification.inputs.project}`, import.meta.url),
      "utf8",
    ),
  );
  if (!project.simulation) {
    throw new Error(
      `Qualification ${qualification.fixtureId} Project has no persisted SimulationSetup.`,
    );
  }
  const selection = project.simulation.input.environment;
  if (
    selection.profileId !== qualification.profileId ||
    selection.corner !== qualification.modelLibrary.section
  ) {
    throw new Error(
      `Qualification ${qualification.fixtureId} Project does not select its declared Profile and corner.`,
    );
  }
  const compiled = await compileStructuredSimulation(
    project,
    project.simulation,
    { timeoutMs: 110_000 },
  );
  if (!compiled.ok) {
    throw new Error(
      `Qualification ${qualification.fixtureId} did not compile: ${compiled.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join(" | ")}`,
    );
  }
  return compiled;
}

export async function compileHostedSky130TransientProject() {
  const [{ compileStructuredSimulation }, { parseProject }] = await Promise.all(
    [import("@icm/netlist"), import("@icm/project-protocol")],
  );
  const project = parseProject(
    readFileSync(
      new URL(`../${qualification.inputs.project}`, import.meta.url),
      "utf8",
    ),
  );
  const expected = qualification.expectedTran;
  const source = project.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.id === expected.source.instanceId);
  if (!source?.netlist || !project.simulation) {
    throw new Error(
      `Qualification ${qualification.fixtureId} has no transient source or setup.`,
    );
  }
  source.symbolId = "pulse-voltage-source";
  source.netlist.parameters = { ...expected.source.parameters };
  project.simulation.input.analyses = [{ ...expected.analysis }];
  const compiled = await compileStructuredSimulation(
    project,
    project.simulation,
    { timeoutMs: 60_000 },
  );
  if (!compiled.ok) {
    throw new Error(
      `Qualification ${qualification.fixtureId} TRAN did not compile: ${compiled.diagnostics
        .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`)
        .join(" | ")}`,
    );
  }
  return compiled;
}

function object(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is absent or is not an object.`);
  }
  return value;
}

function diagnosticSummary(payload) {
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

function validatePinnedEnvironment(environment, target) {
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

function transientAnalysis(payload, expectedTarget) {
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

export function validateHostedSky130TransientResult(
  payload,
  expectedTarget,
  expectedInputRevision,
  expectedVectors,
) {
  const { result, tran } = transientAnalysis(payload, expectedTarget);
  const metadata = object(result.metadata, "run metadata");
  const input = object(metadata.input, "input metadata");
  if (input.inputRevision !== expectedInputRevision) {
    throw new Error(`${expectedTarget} returned stale structured TRAN data.`);
  }
  const modelLibrary = object(
    object(metadata.configuration, "configuration metadata").modelLibrary,
    "model selection",
  );
  if (
    modelLibrary.directive !== qualification.modelLibrary.directive ||
    modelLibrary.section !== qualification.modelLibrary.section
  ) {
    throw new Error(
      `${expectedTarget} did not run TRAN with the qualified model-library section.`,
    );
  }
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

function relativeError(actual, expected) {
  return Math.abs(actual - expected) / Math.max(Math.abs(expected), 1);
}

export function validateHostedSky130Result(
  payload,
  expectedTarget,
  expectedInputRevision,
  expectedVectors,
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
  const configuration = object(
    metadata.configuration,
    "configuration metadata",
  );
  const modelLibrary = object(configuration.modelLibrary, "model selection");
  if (
    modelLibrary.directive !== qualification.modelLibrary.directive ||
    modelLibrary.section !== qualification.modelLibrary.section
  ) {
    throw new Error(
      `${expectedTarget} did not run the qualified model-library section.`,
    );
  }
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
  return {
    target: expectedTarget,
    fixtureId: qualification.fixtureId,
    values,
    environmentFingerprint: environment.fingerprint,
  };
}

export async function runHostedSky130Acceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130Project();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...compiled.request,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `[protocol:non-json] ${target} model qualification answered HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok) {
    const refusal = object(payload, "simulation refusal");
    throw new Error(
      `[infrastructure:${String(refusal.error ?? `http-${response.status}`)}] ${target} model qualification answered HTTP ${response.status}`,
    );
  }
  return validateHostedSky130Result(
    payload,
    target,
    compiled.request.inputRevision,
    compiled.vectors,
  );
}

export async function runHostedSky130TransientAcceptance({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const compiled = await compileHostedSky130TransientProject();
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...compiled.request, executorTarget: target }),
    signal: AbortSignal.timeout(120_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} TRAN qualification failed.`,
    );
  }
  return validateHostedSky130TransientResult(
    payload,
    target,
    compiled.request.inputRevision,
    compiled.vectors,
  );
}

export async function runPreviewTransientSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...RC_TRAN_REQUEST,
      inputRevision: `preview-rc-tran-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(60_000),
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(
      `[infrastructure:http-${response.status}] ${target} RC TRAN smoke failed.`,
    );
  }
  return validateRcTransientResult(payload, target);
}

export async function runPreviewSimulationSmoke({
  baseUrl,
  target,
  fetchImpl = fetch,
}) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...DIVIDER_REQUEST,
      inputRevision: `preview-smoke-${target}`,
      executorTarget: target,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(
      `[protocol:non-json] ${target} answered HTTP ${response.status}: ${text.slice(0, 400)}`,
    );
  }
  if (!response.ok) {
    const error = object(payload, "simulation refusal");
    const code = String(error.error ?? `http-${response.status}`);
    const layer = REQUEST_ERRORS.has(code) ? "request" : "infrastructure";
    throw new Error(
      `[${layer}:${code}] ${target} answered HTTP ${response.status}` +
        `${error.reason ? ` (${String(error.reason)})` : ""}` +
        `${error.message ? `: ${String(error.message)}` : ""}`,
    );
  }
  return validatePreviewSimulationResult(payload, target);
}

export function validateExecutorParity(results) {
  if (results.length === 0) {
    throw new Error("expected at least one executor result, received none.");
  }
  const fingerprints = new Set(
    results.map((result) => result.environmentFingerprint),
  );
  if (fingerprints.size !== 1) {
    throw new Error(
      `[result:environment-mismatch] Preview executors do not share one environment: ${results
        .map((result) => `${result.target}=${result.environmentFingerprint}`)
        .join(", ")}`,
    );
  }
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl) {
    throw new Error(
      "usage: node scripts/preview-simulation-smoke.mjs https://preview.example",
    );
  }
  const results = [];
  for (const target of EXECUTORS) {
    const result = await runPreviewSimulationSmoke({ baseUrl, target });
    results.push(result);
    console.log(
      `${result.target}: v(mid)=${result.value}, ${result.simulatorVersion}, environment=${result.environmentFingerprint}`,
    );
  }
  validateExecutorParity(results);
  console.log("Preview executor parity: passed");

  for (const target of EXECUTORS) {
    const result = await runPreviewTransientSmoke({ baseUrl, target });
    console.log(`${result.target}: RC TRAN ${result.pointCount} points passed`);
  }

  const qualifications = [];
  for (const target of EXECUTORS) {
    const result = await runHostedSky130Acceptance({ baseUrl, target });
    qualifications.push(result);
    console.log(
      `${result.target}: ${result.fixtureId} passed, environment=${result.environmentFingerprint}`,
    );
  }
  validateExecutorParity(qualifications);
  for (const target of EXECUTORS) {
    const result = await runHostedSky130TransientAcceptance({
      baseUrl,
      target,
    });
    console.log(
      `${result.target}: SKY130 OTA TRAN ${result.pointCount} points passed`,
    );
  }
  console.log(`Hosted SKY130 Profile ${profile.id}: qualified`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
