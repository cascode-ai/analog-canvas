import { mkdir, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import {
  prepareSourceExecutionInput,
  CapabilitiesSchema,
} from "@icm/simulation-service";
import { routeSimulationRequest } from "../worker/simulation.ts";
import {
  compileHostedSky130Project,
  compileHostedSky130TransientProject,
  compileHostedSky130NoiseProject,
  profile,
} from "./lib/preview-simulation-qualification.mjs";
import {
  validateHostedSky130Result,
  validateHostedSky130TransientResult,
  validateHostedSky130NoiseResult,
} from "./lib/preview-simulation-sky130-validation.mjs";

// This opt-in layer exercises the candidate image, not a mock or the shared Preview.
// container.yml always enables it before the operator-host rollout can occur.
const endpoint = process.env.ICM_SOURCE_ACCEPTANCE_URL;
if (
  endpoint &&
  !["127.0.0.1", "localhost", "[::1]"].includes(new URL(endpoint).hostname)
)
  throw Error(
    "Native image acceptance must target its isolated loopback container",
  );
const env = { SIMULATION_UPSTREAM_URL: endpoint };
const post = (body) =>
  routeSimulationRequest(
    new Request("http://acceptance/api/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    env,
  );

async function run(request, name) {
  const response = await post(request);
  const payload = await response.json();
  await mkdir("test-results/source-native", { recursive: true });
  await writeFile(
    `test-results/source-native/${name}.json`,
    JSON.stringify(payload, null, 2),
  );
  expect(response.status, JSON.stringify(payload)).toBe(200);
  return payload;
}

describe.skipIf(!endpoint)("candidate ngspice46 source qualification", () => {
  for (const [name, compile, validate] of [
    ["ota-op-dc-ac", compileHostedSky130Project, validateHostedSky130Result],
    [
      "ota-tran",
      compileHostedSky130TransientProject,
      validateHostedSky130TransientResult,
    ],
    [
      "ota-noise",
      compileHostedSky130NoiseProject,
      validateHostedSky130NoiseResult,
    ],
  ]) {
    it(
      name,
      async () => {
        const compiled = await compile();
        const result = await run(compiled.request, name);
        validate(
          result,
          "operator-host",
          compiled.input.inputRevision,
          compiled.vectors,
          compiled.request,
        );
      },
      160_000,
    );
  }

  it("keeps repeated native records and recovers after an engine error", async () => {
    const response = await post({ operation: "capabilities" });
    const caps = CapabilitiesSchema.parse(await response.json());
    const folder = createSimulationFolder({
      id: "native",
      name: "Native records",
      profileId: profile.id,
    });
    const entry = folder.input.files.find(
      (file) => file.path === folder.input.entry,
    );
    entry.text = [
      "* native records",
      '.lib "sections.spice" tt',
      ".control",
      "set filetype=ascii",
      "set appendwrite",
      "op",
      "write out.raw",
      "alter V1=2",
      "op",
      "write out.raw",
      ".endc",
      ".end",
      "",
    ].join("\n");
    folder.input.files.push({
      path: "sections.spice",
      text: ".lib tt\nV1 in 0 1\nR1 in out 1k\nR2 out 0 1k\n.endl tt\n.lib unused\nV1 in 0 99\n.endl unused\n",
    });
    const project = createEmptyProject(
      "native-acceptance",
      "Native acceptance",
      "main",
    );
    const compiled = await prepareSourceExecutionInput(project, folder, caps);
    expect(compiled.ok, JSON.stringify(compiled)).toBe(true);
    const result = await run(compiled.input, "native-records");
    expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
    const ops = result.data.analyses.filter(
      (analysis) => analysis.analysis === "op",
    );
    expect(ops).toHaveLength(2);
    const values = ops.map(
      (op) => op.probes.find((probe) => probe.name === "v(out)").value,
    );
    expect(values[0]).toBeCloseTo(0.5, 9);
    expect(values[1]).toBeCloseTo(1, 9);

    // ngspice46 preloads includes even in an unselected .lib section. Preserve
    // that native error rather than claiming the inspector executes the language.
    const missingInclude = structuredClone(compiled.input);
    missingInclude.files.find((file) => file.path === "sections.spice").text +=
      ".lib absent\n.include missing.spice\n.endl absent\n";
    const missingResult = await run(
      missingInclude,
      "native-unselected-include",
    );
    expect(missingResult.outcome.status).toBe("failed");
    expect(missingResult.log).toContain(
      "Could not find include file missing.spice",
    );

    entry.text =
      "* missing model\nD1 n 0 MODEL_DOES_NOT_EXIST\nV1 n 0 1\n.control\nop\nwrite out.raw\n.endc\n.end\n";
    const bad = await prepareSourceExecutionInput(project, folder, caps);
    expect(bad.ok).toBe(true);
    expect(
      (await run(bad.input, "recoverable-model-error")).outcome.status,
    ).toBe("failed");
    expect(
      (await run(compiled.input, "repaired-native-records")).outcome.status,
    ).toBe("completed");
  }, 160_000);
});
