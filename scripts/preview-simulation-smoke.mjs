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
  const simulator = object(environment.simulator, "simulator identity");
  const models = object(environment.models, "model identity");
  if (simulator.name !== "ngspice" || typeof simulator.version !== "string") {
    throw new Error(
      `${expectedTarget} did not identify ngspice and its version.`,
    );
  }
  if (!SHA256.test(String(simulator.binarySha256))) {
    throw new Error(
      `${expectedTarget} returned no valid simulator binary digest.`,
    );
  }
  if (!SHA256.test(String(models.contentSha256))) {
    throw new Error(`${expectedTarget} returned no valid model-tree digest.`);
  }
  if (!SHA256.test(String(environment.fingerprint))) {
    throw new Error(
      `${expectedTarget} returned no valid environment fingerprint.`,
    );
  }

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
