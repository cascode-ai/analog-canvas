// Run inside the built candidate with read-only root, no network and a private
// /var/lib/vacask tmpfs. Inputs are captured public Prepare outputs, not new decks.
import assert from "node:assert/strict";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { startVacaskService } from "/opt/harness/vacask-harness.mjs";
import { validateNativeExampleResult } from "/proof/native-example-acceptance.mjs";

assert.equal(process.getuid(), 10001);
await assert.rejects(writeFile("/opt/should-not-be-writable", "bad"));
const manifest = JSON.parse(
  await readFile("/opt/models/package-manifest.json", "utf8"),
);
const inputs = JSON.parse(await readFile("/proof/inputs.json", "utf8"));
assert.deepEqual(
  inputs.map((i) => i.environment.corner),
  manifest.sections,
);
const profile = {
  id: "vacask-sky130-candidate",
  corners: manifest.sections,
  dependencies: [manifest.dependency],
  modelSymbols: manifest.modelSymbols,
  modelLibrary: {
    dependencyId: manifest.dependency.id,
    defaultSection: "tt",
    defaultScale: 1e-6,
  },
};
const limits = {
  maxInputBytes: 65536,
  maxInputFiles: 12,
  maxOutputBytes: 8388608,
  maxLogBytes: 65536,
  maxRawFiles: 16,
  maxEntries: 256,
};
const analyses = ["op", "dc", "ac", "tran", "noise"];
const service = await startVacaskService({
  runtime: {
    executor: "local-host",
    profileId: profile.id,
    binary: "/opt/vacask/bin/vacask",
    modules: "/opt/modules",
    startupPath: "/opt/startup.toml",
    runRoot: "/var/lib/vacask",
    dependencies: [
      { ...manifest.dependency, runtimePath: "/opt/models/models.inc" },
    ],
    python: {
      binary: "/usr/bin/python3",
      libraries: [
        "/usr/lib/python3.12",
        "/etc/python3.12/sitecustomize.py",
        "/opt/vacask/lib/vacask/python",
      ],
    },
  },
  capabilities: {
    configured: true,
    rawfileCollection: "native-multi-ascii",
    inputs: ["source"],
    analyses,
    parsedAnalyses: analyses,
    profiles: [profile],
    maxTimeoutMs: 30000,
    maxInputBytes: limits.maxInputBytes,
    maxInputFiles: limits.maxInputFiles,
    maxOutputBytes: limits.maxOutputBytes,
    cancel: true,
  },
  limits,
});
try {
  const runtime = await service.ready;
  await writeFile(
    "/evidence/environment.json",
    JSON.stringify(runtime.environment, null, 2),
    { flag: "wx" },
  );
  for (const input of inputs) {
    const response = await fetch(
      `http://127.0.0.1:${service.server.address().port}/run`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
        signal: AbortSignal.timeout(45000),
      },
    );
    const result = await response.json();
    await writeFile(
      `/evidence/${input.environment.corner}.json`,
      JSON.stringify({ input, result }),
      { flag: "wx" },
    );
    assert.equal(response.status, 200, JSON.stringify(result));
    validateNativeExampleResult(result);
    assert.deepEqual(
      new Set(result.data.analyses.map((a) => a.analysis)),
      new Set(analyses),
    );
    assert.deepEqual(result.metadata.environment, runtime.environment);
    for (const file of input.files)
      assert(
        result.executedFiles.some(
          (f) => f.path === file.path && f.text === file.text,
        ),
      );
    assert(result.rawfiles.length >= 5);
    console.log(
      `Native image: ${input.environment.corner} OP/DC/AC/TRAN/Noise passed`,
    );
  }
} finally {
  await service.stop();
}
assert.deepEqual(
  await readdir("/var/lib/vacask"),
  [],
  "Run leases left scratch files",
);
