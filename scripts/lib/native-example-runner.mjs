import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { isSimulationInputPath } from "../../packages/model/dist/index.js";
import { verifySimulationEnvironmentMetadata } from "../../packages/spice-run/dist/index.js";
import { validateNativeExampleResult } from "./native-example-acceptance.mjs";

const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");

export function nativeRunnerOptions(argv) {
  const args = [...argv],
    options = {
      root: resolve(
        args[0] && !args[0].startsWith("--")
          ? args.shift()
          : "output/native-simulation-examples",
      ),
      environments: [],
    };
  const fields = {
    "--url": "url",
    "--mcp-bundle": "bundle",
    "--mcp-sha256": "bundleSha256",
    "--project": "selected",
  };
  while (args.length) {
    const flag = args.shift(),
      value = args.shift();
    assert(value && !value.startsWith("--"), `Missing value for ${flag}`);
    if (flag === "--environment") options.environments.push(resolve(value));
    else {
      assert(
        fields[flag] && options[fields[flag]] === undefined,
        `Unknown/repeated option: ${flag}`,
      );
      options[fields[flag]] = value;
    }
  }
  assert(
    options.url && options.bundle && options.environments.length,
    "Supply --url <isolated-candidate> --mcp-bundle <packaged-entry> --mcp-sha256 <digest> --environment <environment-metadata.json> (repeat per Profile)",
  );
  assert.match(
    options.bundleSha256 ?? "",
    /^[a-f0-9]{64}$/,
    "Supply the expected MCP bundle SHA-256",
  );
  const url = new URL(options.url);
  assert(
    ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === "/",
    "Candidate must be an HTTP(S) origin without credentials/path/query",
  );
  assert(
    ![
      "analog-canvas.tokenzhang.com",
      "analog-canvas-preview.tokenzhang.com",
    ].includes(url.hostname.toLowerCase()),
    "Do not run migration acceptance on Production or shared Preview",
  );
  options.url = url.origin;
  options.bundle = resolve(options.bundle);
  return options;
}

// These are existing environment metadata objects, not a new Profile protocol.
export function expectedNativeEnvironments(records) {
  const environments = new Map();
  for (const e of records) {
    assert(
      e.profileId && !environments.has(e.profileId),
      "Missing/duplicate expected Profile",
    );
    assert.equal(
      e.simulator?.name,
      "vacask",
      "Expected environment must be VACASK",
    );
    assert.match(
      e.fingerprint ?? "",
      /^[a-f0-9]{64}$/,
      "Expected runtime fingerprint missing",
    );
    assert.match(
      e.simulator.binarySha256 ?? "",
      /^[a-f0-9]{64}$/,
      "Expected simulator binary digest missing",
    );
    environments.set(e.profileId, e);
  }
  return environments;
}

export function assertNativeCapabilities(capabilities, folders) {
  assert(capabilities?.configured, "Candidate executor is not configured");
  assert.equal(
    capabilities.rawfileCollection,
    "native-multi-ascii",
    "Candidate still uses the legacy collection protocol",
  );
  assert(
    capabilities.inputs?.includes("source"),
    "Source execution unavailable",
  );
  assert(
    capabilities.batch?.maxItems >= folders.length,
    "Candidate batch capacity cannot cover the selected Project",
  );
  for (const f of folders) {
    const profile = capabilities.profiles.find((p) => p.id === f.profileId);
    assert(profile, `Candidate lacks Profile ${f.profileId}`);
    for (const d of f.dependencies ?? [])
      assert(
        profile.dependencies?.some(
          (p) => p.id === d.id && p.sha256 === d.sha256,
        ),
        `Candidate dependency mismatch: ${d.id}`,
      );
  }
}

function artifactPaths(artifacts) {
  const seen = new Set();
  for (const artifact of artifacts) {
    const name = artifact.name;
    assert(
      typeof name === "string" && isSimulationInputPath(name),
      "Unsafe artifact path",
    );
    assert(
      name
        .split("/")
        .every(
          (p) =>
            !/[. ]$/u.test(p) &&
            !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(p),
        ),
      "Nonportable artifact path",
    );
    const key = name.toLowerCase();
    assert(
      key !== "run.json" && !/^plot-\d+\.(svg|zip)$/u.test(key),
      "Artifact collides with receipt/export",
    );
    assert(!seen.has(key), "Artifact paths collide");
    for (const prior of seen)
      assert(
        !key.startsWith(prior + "/") && !prior.startsWith(key + "/"),
        "Artifact file/directory collision",
      );
    seen.add(key);
    assert.match(artifact.sha256, /^[a-f0-9]{64}$/, "Missing artifact digest");
  }
}

/** Public MCP downloads, complete arrays and native runtime identity in one place. */
export async function collectNativeRunEvidence({
  tool,
  run,
  directory,
  compiled,
  expectedEnvironment,
}) {
  await mkdir(directory); // Refuse a pre-existing evidence directory.
  await writeFile(join(directory, "run.json"), JSON.stringify(run, null, 2), {
    flag: "wx",
  });
  artifactPaths(run.artifacts ?? []);
  const artifacts = [];
  const failures = [];
  for (const artifact of run.artifacts ?? []) {
    const path = join(directory, artifact.name);
    // The MCP File Resource verifies byte length and SHA while paging; retain
    // directory structure and independently verify the file actually saved.
    try {
      await tool("simulation_files", {
        request: { action: "artifact", artifactId: artifact.id },
        outputPath: path,
      });
      assert.equal(
        digest(await readFile(path)),
        artifact.sha256,
        `Corrupt artifact ${artifact.name}`,
      );
      artifacts.push({ name: artifact.name, sha256: artifact.sha256 });
    } catch (error) {
      failures.push(`${artifact.name}: ${error.message}`);
    }
  }
  assert(!failures.length, failures.join("\n"));
  assert.equal(run.state, "finished", "Run did not finish");
  assert(
    !run.error,
    `Evidence publication failed: ${JSON.stringify(run.error)}`,
  );
  assert.equal(run.result?.outcome?.status, "completed", "Run failed");
  assert(
    artifacts.some((a) => a.name === "result.json"),
    "Complete result.json artifact missing",
  );
  const result = JSON.parse(
    await readFile(join(directory, "result.json"), "utf8"),
  );
  const measurements = run.artifacts.some(
    (a) => a.name === "native-measurements.json",
  )
    ? JSON.parse(
        await readFile(join(directory, "native-measurements.json"), "utf8"),
      )
    : [];
  const analyses = validateNativeExampleResult(result, measurements);
  const actual = result.metadata.environment;
  assert(expectedEnvironment, "Expected environment missing");
  assert(
    await verifySimulationEnvironmentMetadata(actual),
    "Runtime metadata fingerprint does not describe its facts",
  );
  assert(
    await verifySimulationEnvironmentMetadata(expectedEnvironment),
    "Expected runtime metadata is inconsistent",
  );
  assert.equal(
    actual.profileId,
    expectedEnvironment.profileId,
    "Runtime Profile mismatch",
  );
  assert.equal(
    actual.fingerprint,
    expectedEnvironment.fingerprint,
    "Runtime fingerprint drift",
  );
  assert.deepEqual(
    actual.simulator,
    expectedEnvironment.simulator,
    "Simulator identity drift",
  );
  for (const file of compiled.files) {
    assert(isSimulationInputPath(file.path), "Unsafe compiled input path");
    assert.equal(
      await readFile(join(directory, "executed", file.path), "utf8"),
      file.text,
      `Executed input mismatch: ${file.path}`,
    );
  }
  // Plotting belongs to the caller's local tools. Validate the downloaded
  // numerical evidence above, not the retired built-in plot export endpoint.
  const datasets = analyses.map((analysis, analysisIndex) => ({
    analysisIndex,
    analysis: analysis.analysis,
    points:
      (analysis.frequencyHz ?? analysis.timeSeconds ?? analysis.sweep?.values)
        ?.length ?? 1,
    signals: analysis.probes.map((probe) => probe.name),
  }));
  return {
    runId: run.id,
    state: run.state,
    outcome: result.outcome,
    environment: actual,
    artifacts,
    datasets,
  };
}
