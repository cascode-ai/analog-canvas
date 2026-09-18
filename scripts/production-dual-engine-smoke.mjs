import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

export const VACASK_PROFILE_ID = "vacask-sky130-candidate";
export const NGSPICE_PROFILE_ID = "sky130-core-continuous-ngspice46-v1";

const nativeSource = `Divider
ground 0
load "resistor.osdi"
model resistance resistor
model voltage vsource
V1 (input 0) voltage dc=1
R1 (input mid) resistance r=1k
R2 (mid 0) resistance r=1k
control
abort always
options rawfile="ascii"
save default
analysis divider_op op
endc
`;

export function nativeDividerRequest() {
  return {
    language: "vacask",
    mode: "raw",
    netlist: "",
    testbench: nativeSource,
    preparedDeck: nativeSource,
    entryPath: "divider.sim",
    inputRevision: "production-vacask-smoke-v1",
    environment: { profileId: VACASK_PROFILE_ID },
    files: [{ path: "divider.sim", text: nativeSource }],
    dependencies: [],
    collection: { kind: "native-multi-ascii" },
  };
}

async function post(baseUrl, body, fetchImpl) {
  const response = await fetchImpl(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error(
      `Production simulation smoke answered HTTP ${response.status} with non-JSON: ${text.slice(0, 400)}`,
    );
  }
  assert(response.ok, JSON.stringify(value));
  return value;
}

export async function runProductionDualEngineSmoke({
  baseUrl,
  fetchImpl = fetch,
}) {
  const capabilities = await post(
    baseUrl,
    { operation: "capabilities" },
    fetchImpl,
  );
  const profiles = new Map(
    capabilities.profiles.map((profile) => [profile.id, profile]),
  );
  assert.equal(profiles.get(NGSPICE_PROFILE_ID)?.engine, "ngspice");
  assert.equal(profiles.get(VACASK_PROFILE_ID)?.engine, "vacask");

  const result = await post(baseUrl, nativeDividerRequest(), fetchImpl);
  assert.equal(result.outcome?.status, "completed", JSON.stringify(result));
  assert.equal(result.metadata?.environment?.profileId, VACASK_PROFILE_ID);
  assert.equal(result.metadata?.environment?.simulator?.name, "vacask");
  const raw = result.rawfiles?.find((file) => file.path === "divider_op.raw");
  assert(raw, "VACASK smoke returned no divider_op.raw");
  assert.match(raw.text, /\n\t5\.000000000000000e-01\n/u);
  return {
    profiles: [NGSPICE_PROFILE_ID, VACASK_PROFILE_ID],
    environmentFingerprint: result.metadata.environment.fingerprint,
    midpoint: 0.5,
  };
}

async function main() {
  const baseUrl = process.argv[2];
  if (!baseUrl)
    throw new Error(
      "usage: node scripts/production-dual-engine-smoke.mjs https://analog-canvas.example",
    );
  const result = await runProductionDualEngineSmoke({ baseUrl });
  console.log(
    `Production dual-engine smoke passed: ${result.profiles.join(", ")}; ` +
      `VACASK v(mid)=${result.midpoint}, environment=${result.environmentFingerprint}`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
