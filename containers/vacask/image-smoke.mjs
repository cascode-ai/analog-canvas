// Run inside the built candidate with read-only root, no network and a private
// /var/lib/vacask tmpfs. Inputs are captured public Prepare outputs, not new decks.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
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
assert(
  process.argv.length === 2 ||
    (process.argv.length === 3 && process.argv[2] === "--hosted"),
  "Only --hosted is supported",
);
const expectedEnvironment =
  process.argv[2] === "--hosted"
    ? JSON.parse(await readFile("/proof/expected-environment.json", "utf8"))
    : undefined;
const configuration = {
  runtime: {
    executor: expectedEnvironment ? "hosted-container" : "local-host",
    ...(expectedEnvironment ? { expectedEnvironment } : {}),
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
};
if (expectedEnvironment) {
  assert.equal(expectedEnvironment.executor, "hosted-container");
  assert.equal(expectedEnvironment.reproducibility, "pinned");
  // A separately supplied, modified startup file must not silently create a
  // different accepted environment. This is a boot failure, not a job failure.
  const rejected = await startVacaskService({
    ...configuration,
    runtime: {
      ...configuration.runtime,
      startupPath: "/proof/changed-startup.toml",
    },
  });
  try {
    await assert.rejects(rejected.ready, /differs from the accepted lock/u);
    const origin = `http://127.0.0.1:${rejected.server.address().port}`;
    const health = await fetch(origin + "/health");
    assert.equal(health.status, 503);
    assert.equal((await health.json()).activity.state, "idle");
    const run = await fetch(origin + "/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(inputs[0]),
    });
    assert.equal(run.status, 503);
    await writeFile(
      "/evidence/rejected-startup.json",
      JSON.stringify(await run.json()),
      { flag: "wx" },
    );
  } finally {
    await rejected.stop();
  }
  assert.deepEqual(await readdir("/var/lib/vacask"), []);
}
const service = await startVacaskService(configuration);
try {
  const runtime = await service.ready;
  if (expectedEnvironment)
    assert.deepEqual(runtime.environment, expectedEnvironment);
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
  const origin = `http://127.0.0.1:${service.server.address().port}`;
  const post = async (body, path = "/run") => {
    const response = await fetch(origin + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(45000),
    });
    return { status: response.status, body: await response.json() };
  };
  const health = async () => (await fetch(origin + "/health")).json();
  const makeInput = (control) => {
    const text = `Native lifecycle fault injection\nground 0\nmodel supply vsource\nV1 (out 0) supply dc=1\ncontrol\noptions rawfile="ascii"\nsave v(out)\n${control}\nendc\n`;
    return {
      ...inputs[0],
      netlist: "",
      testbench: text,
      preparedDeck: text,
      inputRevision: "container-lifecycle-fault-injection",
      dependencies: [],
      files: [{ path: inputs[0].entryPath, text }],
      runToken: randomUUID(),
    };
  };
  const record = async (name, reply) => {
    await writeFile(`/evidence/${name}.json`, JSON.stringify(reply), {
      flag: "wx",
    });
    assert.equal(reply.status, 200, JSON.stringify(reply));
    assert.equal((await health()).activity.state, "idle");
    assert.deepEqual(await readdir("/var/lib/vacask"), []);
  };
  const recover = async (name) => {
    const reply = await post(inputs[0]);
    await record(name, reply);
    validateNativeExampleResult(reply.body);
  };
  const failed = await post(makeInput("not valid syntax ?"));
  await record("syntax-failure", failed);
  assert.equal(failed.body.outcome.status, "failed");
  await recover("after-syntax-failure");

  const slow = makeInput("analysis slow tran stop=100 step=1p maxstep=1p");
  const pending = post(slow);
  const deadline = Date.now() + 10000;
  while ((await health()).activity.phase !== "running") {
    assert(Date.now() < deadline, "Native child never reached running state");
    await delay(20);
  }
  const busy = await post(inputs[0]);
  assert.equal(busy.status, 429);
  assert.equal(busy.body.error, "simulator-busy");
  assert.equal(
    (await post({ runToken: slow.runToken }, "/cancel")).status,
    200,
  );
  const cancelled = await pending;
  await record("cancelled", cancelled);
  assert.equal(cancelled.body.cancelled, true);
  await recover("after-cancel");

  const timedOut = await post({
    ...slow,
    runToken: randomUUID(),
    timeoutMs: 100,
  });
  await record("timeout", timedOut);
  assert.equal(timedOut.body.outcome.status, "timed-out");
  assert.equal(timedOut.body.outcome.timeoutMs, 100);
  await recover("after-timeout");
  console.log(
    "Native image: syntax failure, busy rejection, active cancellation, timeout and subsequent recovery passed",
  );
} finally {
  await service.stop();
}
assert.deepEqual(
  await readdir("/var/lib/vacask"),
  [],
  "Run leases left scratch files",
);
