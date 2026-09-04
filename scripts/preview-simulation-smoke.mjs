/**
 * Preview's dual-executor numerical smoke.
 *
 * The same deck is sent through both hosted transports. A green HTTP response
 * is not enough: the selected executor, terminal outcome, rawfile-derived
 * operating-point value, and measured simulator/model identity all have to be
 * present. The two environment fingerprints must agree because both Preview
 * substrates run the same pinned image.
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
if (!profile.qualifiedScope.analyses.includes(qualification.analysis)) {
  throw new Error(
    `Qualification ${qualification.fixtureId} uses undeclared analysis ${String(qualification.analysis)}.`,
  );
}
if (
  qualification.modelLibrary.directive !== profile.models.library.directive ||
  !profile.models.library.sections.includes(qualification.modelLibrary.section)
) {
  throw new Error(
    `Qualification ${qualification.fixtureId} uses a model selection outside Profile ${profile.id}.`,
  );
}

const EXECUTORS = ["cloudflare-container", "operator-host"];
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

export const HOSTED_SKY130_REQUEST = {
  netlist: readFileSync(
    new URL(`../${qualification.inputs.netlist}`, import.meta.url),
    "utf8",
  ),
  testbench: readFileSync(
    new URL(`../${qualification.inputs.testbench}`, import.meta.url),
    "utf8",
  ),
  analyses: ["op"],
  timeoutMs: 110_000,
};

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

export function validateHostedSky130Result(payload, expectedTarget) {
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
  const expectedRevision = `preview-sky130-${expectedTarget}`;
  if (input.inputRevision !== expectedRevision) {
    throw new Error(
      `[result:stale-input] requested ${expectedRevision}, but the Worker returned ${String(input.inputRevision)}.`,
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
          analysis.analysis === qualification.analysis,
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
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ...HOSTED_SKY130_REQUEST,
      inputRevision: `preview-sky130-${target}`,
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
  return validateHostedSky130Result(payload, target);
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
  if (results.length !== EXECUTORS.length) {
    throw new Error(
      `expected ${EXECUTORS.length} executor results, received ${results.length}.`,
    );
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

  const qualifications = [];
  for (const target of EXECUTORS) {
    const result = await runHostedSky130Acceptance({ baseUrl, target });
    qualifications.push(result);
    console.log(
      `${result.target}: ${result.fixtureId} passed, environment=${result.environmentFingerprint}`,
    );
  }
  validateExecutorParity(qualifications);
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
