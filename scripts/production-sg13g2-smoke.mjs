import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { simulationSmokeHeaders } from "./lib/simulation-smoke-headers.mjs";
import { waitingWhileBusy } from "./lib/simulator-busy-wait.mjs";

const baseUrl = process.argv[2];
assert(baseUrl, "usage: node scripts/production-sg13g2-smoke.mjs <base-url>");
const profile = JSON.parse(
  await readFile(
    new URL("../containers/ngspice/sg13g2/profile.json", import.meta.url),
    "utf8",
  ),
);
const request = waitingWhileBusy();
async function post(body) {
  const response = await request(new URL("/api/simulate", baseUrl), {
    method: "POST",
    headers: simulationSmokeHeaders(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120000),
  });
  const value = await response.json();
  assert(response.ok, JSON.stringify(value));
  return value;
}
// The separately deployed host can still be building when the Worker arrives.
let ready = false;
for (let attempt = 0; attempt < 120; attempt++) {
  const caps = await post({ operation: "capabilities" });
  if (caps.profiles.some((p) => p.id === profile.id)) {
    ready = true;
    break;
  }
  await setTimeout(5000);
}
assert(ready, "SG13G2 Profile did not become ready within 10 minutes");
const circuit = await readFile(
  new URL("../netlists/sg13g2-qualification/reference.spice", import.meta.url),
  "utf8",
);
const deck = `SG13G2 production acceptance
.lib "models.lib" nominal
.include "circuit.spice"
XDUT vdd 0 out in sub rs rh collector base DUT
VDD vdd 0 1.2
VIN in 0 0.6
VSUB sub 0 -0.1
VRS rs 0 0.1
VRH rh 0 0.1
VC collector 0 0.8
VB base 0 0.7
.control
op
write result.raw all
quit
.endc
.end
`;
const result = await post({
  mode: "raw",
  netlist: circuit,
  testbench: deck,
  preparedDeck: deck,
  entryPath: "run.cir",
  inputRevision: "sg13g2-production-smoke-v1",
  environment: { profileId: profile.id, corner: "nominal" },
  files: [
    { path: "run.cir", text: deck },
    { path: "circuit.spice", text: circuit },
  ],
  dependencies: [
    {
      id: profile.models.id,
      sha256: profile.models.contentSha256,
      mountPath: "models.lib",
    },
  ],
  collection: { rawfile: "result.raw" },
});
assert.equal(result.outcome?.status, "completed", JSON.stringify(result));
assert.equal(result.metadata?.environment?.profileId, profile.id);
assert.equal(
  result.metadata?.environment?.models?.contentSha256,
  profile.models.contentSha256,
);
const op = result.data?.analyses.find((a) => a.analysis === "op");
assert(op, "Missing OP result");
const output = op.probes.find((p) => p.name === "v(out)")?.value;
assert(
  Number.isFinite(output) && Math.abs(output - 0.0153940369314152) < 1e-7,
  `Unexpected SG13G2 operating point ${output}`,
);
console.log(
  JSON.stringify({
    profileId: profile.id,
    fingerprint: result.metadata.environment.fingerprint,
    output,
  }),
);
