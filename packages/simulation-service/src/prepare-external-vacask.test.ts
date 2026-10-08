import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { createSimulationFolder } from "@icm/model";
import { executeProjectTransaction } from "../../edit-engine/src/index.js";
import {
  analyzeDesignNetlist,
  transformProjectModelSource,
} from "@icm/netlist";
import { parseVacaskRawfile } from "../../spice-run/src/vacask-rawfile.js";
import { externalModelFixture } from "../../netlist/src/external-model-fixture.test-support.js";
import { CapabilitiesSchema } from "./contract.js";
import { prepareSourceExecutionInput } from "./prepare-source.js";

function fixture(language: "spice" | "spectre") {
  const project = externalModelFixture();
  const source = {
    ...project.modelSources![0]!,
    files: [
      {
        path: "gain.spice",
        text: '.include "helper.spice"\n.subckt gain_block A B params: gain=10 pole=1000\nXCORE A B core gain={gain} pole={pole}\n.ends gain_block\n',
      },
      {
        path: "helper.spice",
        text: ".subckt core A B params: gain=10 pole=1000\nE1 drive 0 A 0 {gain}\nR1 drive B 1k\nC1 B 0 {1/(6.283185307179586*1k*pole)}\n.ends core",
      },
    ],
  };
  const transformed = transformProjectModelSource(source, { language });
  if (!transformed.ok) throw Error(JSON.stringify(transformed));
  const applied = executeProjectTransaction(project, {
    projectId: project.id,
    expectedStructureRevision: project.structureRevision,
    transactionId: "apply-model",
    actor: { kind: "human", id: "acceptance" },
    edits: [
      {
        kind: "apply_model_source",
        source: transformed.source,
        definitions: [{ definitionId: "gain", entry: "gain_block" }],
      },
    ],
  });
  if (!applied.ok) throw Error(JSON.stringify(applied));
  const document = applied.project.documents[0]!;
  document.instances.find((i) => i.id === "X2")!.netlist!.parameters.gain =
    "20";
  const analysis = analyzeDesignNetlist(applied.project, {
    format: "spice",
    rootAsTopLevel: true,
  });
  if (!analysis.ir) throw Error(JSON.stringify(analysis.diagnostics));
  const cards = analysis.ir.cells.find((c) => c.id === document.id)!.instances;
  const input = cards.find((i) => i.id === "X1")!.nodes[0]!.netName;
  const input2 = cards.find((i) => i.id === "X2")!.nodes[0]!.netName;
  const outputs = cards.map((i) => i.nodes[1]!.netName);
  const folder = createSimulationFolder({
    id: "real",
    name: "External VACASK",
    profileId: "candidate",
  });
  folder.input.entry = "run.sim";
  folder.input.circuitBindings = [
    {
      id: "dut",
      documentId: document.id,
      path: "circuit.inc",
      emission: "top-level",
    },
  ];
  folder.input.files = [
    {
      path: "experiment.json",
      text: JSON.stringify({
        version: 2,
        environment: { profileId: "candidate" },
      }),
    },
    {
      path: "run.sim",
      text: `External finite-gain pole acceptance
include "circuit.inc"
model voltage vsource
VIN (${input} 0) voltage dc=0.1 mag=1
VIN2 (${input2} 0) voltage dc=0.1 mag=1
control
abort always
options rawfile="ascii" strictsave=2 reltol=1e-8 vntol=1e-10
save default
analysis bias op
sweep stimulus instance="VIN" parameter="dc" from=-0.1 to=0.1 step=0.05
analysis transfer op
analysis response ac from=1000 to=1000 mode="lin" points=1
alter instance("VIN") type="pulse" val0=0 val1=0.1 delay=1m rise=1n fall=1n width=4m period=8m
analysis step_response tran stop=3m step=5u maxstep=5u
endc
`,
    },
  ];
  const caps = CapabilitiesSchema.parse({
    configured: true,
    rawfileCollection: "native-multi-ascii",
    inputs: ["source"],
    analyses: ["op", "dc", "ac", "tran"],
    parsedAnalyses: ["op", "dc", "ac", "tran"],
    maxInputBytes: 1_048_576,
    maxTimeoutMs: 15000,
    cancel: true,
    profiles: [{ id: "candidate", engine: "vacask", corners: [] }],
  });
  return { project: applied.project, folder, caps, outputs };
}

describe("External Apply → native Prepare", () => {
  it.each(["spice", "spectre"] as const)(
    "captures the applied %s model, caller overrides and owner maps",
    async (language) => {
      const { project, folder, caps } = fixture(language);
      const before = structuredClone({ project, folder });
      const prepared = await prepareSourceExecutionInput(project, folder, caps);
      expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
      if (!prepared.ok) return;
      expect(prepared.input.language).toBe("vacask");
      expect(prepared.input.dependencies).toEqual([]);
      expect(prepared.generated[0]!.text).toContain("gain=20");
      expect(prepared.modelSources).toEqual(project.modelSources);
      expect(prepared.sourceMaps.flatMap((m) => m.segments)).toContainEqual(
        expect.objectContaining({
          origin: expect.objectContaining({
            kind: "model-source",
            path: "helper.spice",
            derived: true,
          }),
        }),
      );
      expect({ project, folder }).toEqual(before);
    },
  );

  it
    .skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)
    .each(["spice", "spectre"] as const)(
    "numerically verifies %s External models with real VACASK OP/DC/AC/TRAN",
    async (language) => {
      const { project, folder, caps, outputs } = fixture(language);
      const prepared = await prepareSourceExecutionInput(project, folder, caps);
      if (!prepared.ok) throw Error(JSON.stringify(prepared));
      const cwd = mkdtempSync(join(tmpdir(), "icm-external-vacask-"));
      for (const file of prepared.input.files!)
        writeFileSync(join(cwd, file.path), file.text);
      const startup = join(cwd, "startup.toml");
      writeFileSync(startup, "# isolated External Circuit qualification\n");
      const run = spawnSync(
        process.env.VACASK_BIN!,
        [
          "--tomlfile",
          startup,
          "-n",
          "1",
          "-b",
          "1",
          prepared.input.entryPath!,
        ],
        {
          cwd,
          encoding: "utf8",
          windowsHide: true,
          timeout: 15000,
          env: { ...process.env, SIM_MODULE_PATH: process.env.VACASK_MODULES },
        },
      );
      writeFileSync(join(cwd, "stdout.log"), run.stdout ?? "");
      writeFileSync(join(cwd, "stderr.log"), run.stderr ?? "");
      expect(run.status, `${cwd}\n${run.stdout}\n${run.stderr}`).toBe(0);
      const vector = (name: string, node: string) => {
        const parsed = parseVacaskRawfile(
          readFileSync(join(cwd, `${name}.raw`), "utf8"),
        );
        if (!parsed.ok) throw Error(JSON.stringify(parsed));
        const result = parsed.plots[0]!.vectors.find(
          (v) => v.variable.name === node,
        );
        if (!result) throw Error(`Missing ${node} in ${cwd}/${name}.raw`);
        return result;
      };
      for (const [index, gain] of [10, 20].entries()) {
        expect(vector("bias", outputs[index]!).real[0]).toBeCloseTo(
          gain * 0.1,
          8,
        );
        expect(vector("response", outputs[index]!).real[0]).toBeCloseTo(
          gain / 2,
          7,
        );
        expect(vector("response", outputs[index]!).imag![0]).toBeCloseTo(
          -gain / 2,
          7,
        );
      }
      const dc = vector("transfer", outputs[0]!).real;
      expect(dc.length).toBe(5);
      dc.forEach((value, index) =>
        expect(value).toBeCloseTo(-1 + index * 0.5, 8),
      );
      const times = vector("step_response", "time").real;
      const tran = vector("step_response", outputs[0]!).real;
      const maxError = Math.max(
        ...times.map((time, i) =>
          Math.abs(
            tran[i]! -
              (time <= 1e-3
                ? 0
                : 1 - Math.exp(-2 * Math.PI * 1000 * (time - 1e-3))),
          ),
        ),
      );
      expect(maxError, cwd).toBeLessThan(1e-4);
      expect(tran.at(-1)).toBeCloseTo(1, 4);
      console.log(
        JSON.stringify({
          language,
          cwd,
          op: vector("bias", outputs[0]!).real[0],
          acReal: vector("response", outputs[0]!).real[0],
          acImag: vector("response", outputs[0]!).imag![0],
          dc,
          tranMaxError: maxError,
        }),
      );
    },
  );
});
