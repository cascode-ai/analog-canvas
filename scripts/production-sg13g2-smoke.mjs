import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { simulationSmokeHeaders } from "./lib/simulation-smoke-headers.mjs";
import { waitingWhileBusy } from "./lib/simulator-busy-wait.mjs";

const baseUrl = process.argv[2];
assert(baseUrl, "usage: node scripts/production-sg13g2-smoke.mjs <base-url>");
const corner = "mos-fs_hbt-bcs_res-wcs_cap-bcs";
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
.lib "models.lib" ${corner}
.include "cells.spice"
.include "circuit.spice"
XDUT vdd 0 out in sub rs rh collector base hvout hvin vh cl cv pc pb gateout DUT
VDD vdd 0 1.2
VIN in 0 0.6
VSUB sub 0 -0.1
VRS rs 0 0.1
VRH rh 0 0.1
VC collector 0 0.8
VB base 0 0.7
VHV vh 0 3.3
VGH hvin 0 1.65
VCL cl 0 0.8
VCV cv 0 0.8
VPC pc 0 0.3
VPB pb 0 0.5
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
  environment: { profileId: profile.id, corner },
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
    ...profile.cellLibraries.map((cell) => ({
      id: cell.id,
      sha256: cell.contentSha256,
      mountPath: "cells.spice",
    })),
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
  Number.isFinite(output) && Math.abs(output - 0.01157000269626755) < 1e-7,
  `Unexpected SG13G2 operating point ${output}`,
);
{
  for (const [name, expected] of [
    ["v(gateout)", 1.134481659063592],
    ["v(hvout)", 0.06268921682441778],
    ["i(vcl)", -9.647690413479159e-6],
  ]) {
    const value = op.probes.find((p) => p.name === name)?.value;
    assert(
      Math.abs(value - expected) < 1e-11 + Math.abs(expected) * 1e-6,
      `Unexpected ${name}: ${value}`,
    );
  }
}
console.log(
  JSON.stringify({
    profileId: profile.id,
    fingerprint: result.metadata.environment.fingerprint,
    output,
  }),
);
