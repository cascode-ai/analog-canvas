import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { createHash } from "node:crypto";
import {
  nativeRunnerOptions,
  expectedNativeEnvironments,
  assertNativeCapabilities,
  collectNativeRunEvidence,
} from "./lib/native-example-runner.mjs";
import {
  runNativeExamples,
  prepareNativeExampleEvidence,
} from "./run-native-simulation-examples.mjs";
import { parseProject } from "../packages/project-protocol/dist/index.js";
import { createSimulationEnvironmentMetadata } from "../packages/spice-run/dist/index.js";

const sha = (text) => createHash("sha256").update(text).digest("hex");

it("compares executed examples with Profile-projected Prepare input, not bare compilation", async () => {
  const symbols = JSON.parse(
    await readFile(
      "netlists/vacask-sky130/model-symbols-sections.json",
      "utf8",
    ),
  );
  const capabilities = {
    configured: true,
    inputs: ["source"],
    rawfileCollection: "native-multi-ascii",
    analyses: ["op", "dc", "ac", "tran", "noise"],
    parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
    profiles: [
      {
        id: "vacask-sky130-candidate",
        corners: symbols.sections,
        dependencies: [symbols.dependency],
        modelSymbols: symbols.modelSymbols,
        modelLibrary: {
          dependencyId: symbols.dependency.id,
          defaultSection: "tt",
          defaultScale: 1e-6,
        },
      },
    ],
    maxTimeoutMs: 15000,
  };
  let count = 0;
  for (const name of [
    "simulation-rc",
    "simulation-rlc",
    "simulation-common-source",
    "simulation-ota",
    "five-transistor-ota-sky130",
  ]) {
    const project = parseProject(
      await readFile(
        "apps/editor/src/examples/" + name + ".icproj.json",
        "utf8",
      ),
    );
    const before = structuredClone(project);
    const inputs = await prepareNativeExampleEvidence(project, capabilities);
    expect(inputs.size).toBe(project.simulationFolders.length);
    for (const folder of project.simulationFolders) {
      const input = inputs.get(folder.id);
      const entry = input.files.find((f) => f.path === folder.input.entry).text;
      const original = folder.input.files.find(
        (f) => f.path === folder.input.entry,
      ).text;
      if (folder.input.dependencies.length) {
        expect(entry).toContain("options scale=0.000001");
        expect(original).not.toContain("options scale=");
        expect(input.environment.corner).toBe(
          original.match(/section=(tt|ff|ss|fs|sf)/u)[1],
        );
      } else {
        expect(entry).not.toContain("Profile model scale");
      }
      count++;
    }
    expect(project).toEqual(before);
    await expect(
      prepareNativeExampleEvidence(project, { ...capabilities, profiles: [] }),
    ).rejects.toThrow("SIMULATION_PROFILE");
  }
  expect(count).toBe(31);
});

let environment;
beforeAll(async () => {
  environment = await createSimulationEnvironmentMetadata({
    executor: "local-host",
    reproducibility: "observed",
    platform: "fixture/x64",
    models: null,
    startupSha256: null,
    profileId: "test-native",
    simulator: {
      name: "vacask",
      version: "0.3.4",
      binarySha256: "b".repeat(64),
    },
  });
});
const roots = [];
afterEach(async () => {
  vi.unstubAllGlobals();
  for (const root of roots.splice(0))
    await rm(root, { recursive: true, force: true });
});
async function temporary() {
  const path = await mkdtemp(join(tmpdir(), "icm-native-runner-"));
  roots.push(path);
  return path;
}
const options = (url = "https://isolated.example") => [
  "--url",
  url,
  "--mcp-bundle",
  "bundle.mjs",
  "--mcp-sha256",
  "c".repeat(64),
  "--environment",
  "runtime.json",
];

describe("native candidate runner boundaries", () => {
  it("requires an explicit target and bundle/environment identities", () => {
    expect(() => nativeRunnerOptions([])).toThrow("Supply --url");
    expect(nativeRunnerOptions(options()).url).toBe("https://isolated.example");
    expect(() =>
      nativeRunnerOptions([...options(), "--url", "https://other.example"]),
    ).toThrow("repeated");
  });
  it.each([
    "https://analog-canvas.tokenzhang.com",
    "https://analog-canvas-preview.tokenzhang.com",
    "https://u:p@isolated.example",
    "https://isolated.example/editor",
    "file:///tmp/entry",
  ])("rejects unintended target %s", (url) => {
    expect(() => nativeRunnerOptions(options(url))).toThrow();
  });
  it("does not silently substitute a different runtime or duplicate Profile", () => {
    expect(
      expectedNativeEnvironments([environment]).get("test-native"),
    ).toEqual(environment);
    expect(() =>
      expectedNativeEnvironments([environment, environment]),
    ).toThrow("duplicate");
    expect(() =>
      expectedNativeEnvironments([
        { ...environment, simulator: { name: "ngspice" } },
      ]),
    ).toThrow("VACASK");
    expect(() =>
      expectedNativeEnvironments([{ ...environment, fingerprint: "" }]),
    ).toThrow("fingerprint");
  });
  it("checks native collection, complete batch capacity and exact model dependency", () => {
    const folders = [
      {
        profileId: "test-native",
        dependencies: [{ id: "model", sha256: "d".repeat(64) }],
      },
    ];
    const capabilities = {
      configured: true,
      rawfileCollection: "native-multi-ascii",
      inputs: ["source"],
      batch: { maxItems: 1 },
      profiles: [{ id: "test-native", dependencies: folders[0].dependencies }],
    };
    expect(() => assertNativeCapabilities(capabilities, folders)).not.toThrow();
    expect(() =>
      assertNativeCapabilities(
        { ...capabilities, rawfileCollection: "declared-single-ascii" },
        folders,
      ),
    ).toThrow("legacy");
    expect(() =>
      assertNativeCapabilities(capabilities, [...folders, ...folders]),
    ).toThrow("capacity");
    expect(() =>
      assertNativeCapabilities(
        {
          ...capabilities,
          profiles: [{ id: "test-native", dependencies: [] }],
        },
        folders,
      ),
    ).toThrow("dependency");
  });
  it.each(["empty", "wrong-digest"])(
    "%s fails before any remote IO",
    async (mode) => {
      const root = await temporary(),
        bundle = join(root, "bin", "analog-canvas-mcp.mjs"),
        metadata = join(root, "environment.json");
      await mkdir(dirname(bundle));
      await writeFile(bundle, "// synthetic test bundle");
      await writeFile(
        join(root, "package.json"),
        JSON.stringify({
          version: "0.9.2",
          bin: { "analog-canvas-mcp": "bin/analog-canvas-mcp.mjs" },
        }),
      );
      await writeFile(
        join(root, "manifest.json"),
        JSON.stringify({ projects: [] }),
      );
      await writeFile(metadata, JSON.stringify(environment));
      const fetch = vi.fn(() => {
        throw Error("unexpected remote IO");
      });
      vi.stubGlobal("fetch", fetch);
      await expect(
        runNativeExamples([
          root,
          "--url",
          "https://isolated.example",
          "--mcp-bundle",
          bundle,
          "--mcp-sha256",
          mode === "wrong-digest"
            ? "e".repeat(64)
            : sha("// synthetic test bundle"),
          "--environment",
          metadata,
        ]),
      ).rejects.toThrow(
        mode === "empty" ? "No matching Projects" : "expected digest",
      );
      expect(fetch).not.toHaveBeenCalled();
    },
  );
});

// The fake MCP here proves download/receipt behavior only, not cloud execution.
async function evidenceFixture({ corrupt } = {}) {
  const root = await temporary(),
    directory = join(root, "run");
  const result = {
    outcome: { status: "completed" },
    metadata: { environment },
    data: {
      analyses: [
        { analysis: "op", probes: [{ name: "out", value: 1 }] },
        {
          analysis: "ac",
          frequencyHz: [1, 2],
          probes: [{ name: "out", real: [1, 1], imag: [0, 0] }],
        },
      ],
    },
  };
  const content = new Map([
    ["result.json", JSON.stringify(result)],
    ["raw/shared.raw", "native raw"],
    ["executed/shared.raw", "native input"],
    ["stdout.log", "retained log"],
  ]);
  const artifacts = [...content].map(([name, text]) => ({
    id: name,
    name,
    sha256: sha(text),
  }));
  const run = {
    id: "run-test",
    state: "finished",
    result: { outcome: { status: "completed" } },
    artifacts,
  }; // no inline data
  const tool = vi.fn(async (name, args) => {
    await mkdir(dirname(args.outputPath), { recursive: true });
    if (name === "simulation_files")
      await writeFile(
        args.outputPath,
        args.request.artifactId === corrupt
          ? "corrupt"
          : content.get(args.request.artifactId),
      );
    else throw Error(`Unexpected tool: ${name}`);
    return { ok: true };
  });
  return {
    tool,
    run,
    directory,
    compiled: { files: [{ path: "shared.raw", text: "native input" }] },
    expectedEnvironment: environment,
  };
}

describe("native run evidence collection", () => {
  it("uses complete artifacts despite bounded Read and preserves nested names", async () => {
    const f = await evidenceFixture(),
      r = await collectNativeRunEvidence(f);
    expect(r.datasets).toEqual([
      { analysisIndex: 0, analysis: "op", points: 1, signals: ["out"] },
      { analysisIndex: 1, analysis: "ac", points: 2, signals: ["out"] },
    ]);
    expect(await readFile(join(f.directory, "raw/shared.raw"), "utf8")).toBe(
      "native raw",
    );
    expect(
      await readFile(join(f.directory, "executed/shared.raw"), "utf8"),
    ).toBe("native input");
    expect(
      f.tool.mock.calls.every(([name]) => name === "simulation_files"),
    ).toBe(true);
  });
  it.each([
    "../escape",
    "raw/../../escape",
    "run.json",
    "plot-1.svg",
    "raw/CON",
    "raw/a.",
    "RAW/shared.raw",
    "raw/shared.raw/child",
  ])("rejects unsafe/colliding name %s before download", async (name) => {
    const f = await evidenceFixture();
    f.run.artifacts.push({ name, id: "bad", sha256: "a".repeat(64) });
    await expect(collectNativeRunEvidence(f)).rejects.toThrow();
    expect(f.tool).not.toHaveBeenCalled();
  });
  it("does not overwrite previous evidence", async () => {
    const f = await evidenceFixture();
    await mkdir(f.directory);
    await writeFile(join(f.directory, "run.json"), "previous");
    await expect(collectNativeRunEvidence(f)).rejects.toThrow("EEXIST");
    expect(await readFile(join(f.directory, "run.json"), "utf8")).toBe(
      "previous",
    );
  });
  it("retains remaining evidence after one corrupt download", async () => {
    const f = await evidenceFixture({ corrupt: "result.json" });
    await expect(collectNativeRunEvidence(f)).rejects.toThrow(
      "Corrupt artifact",
    );
    expect(await readFile(join(f.directory, "stdout.log"), "utf8")).toBe(
      "retained log",
    );
  });
  it.each(["run-error", "runtime-drift", "input-drift"])(
    "%s is not a successful run",
    async (mode) => {
      const f = await evidenceFixture();
      if (mode === "run-error") f.run.error = { code: "ARTIFACT_CAPACITY" };
      if (mode === "runtime-drift")
        f.expectedEnvironment = { ...environment, fingerprint: "f".repeat(64) };
      if (mode === "input-drift") f.compiled.files[0].text = "changed";
      await expect(collectNativeRunEvidence(f)).rejects.toThrow();
      expect(await readFile(join(f.directory, "stdout.log"), "utf8")).toBe(
        "retained log",
      );
    },
  );
});
