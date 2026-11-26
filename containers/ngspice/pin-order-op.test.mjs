import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import {
  createDesignNetlistExport,
  designNetlistCellPorts,
} from "@icm/netlist";
import { parseProject, serializeProject } from "@icm/project-protocol";
import {
  createSimulationEnvironmentMetadata,
  parseNgspiceRawfile,
} from "@icm/spice-run";
import { ngspiceResultResponse } from "./result-response.mjs";
import { pinOrderOpProject } from "../../netlists/editor-pin-order/fixture.js";
import { CapabilitiesSchema } from "../../packages/simulation-service/src/contract.js";
import {
  EXECUTION_RECEIPT_HEADER,
  readExecutionReceipt,
} from "../../packages/simulation-service/src/execution-receipt.js";
import { prepareNgspiceExecutionInput } from "../../packages/simulation-service/src/prepare-ngspice.js";

const capabilities = CapabilitiesSchema.parse({
  configured: true,
  rawfileCollection: "declared-single-ascii",
  inputs: ["source"],
  analyses: ["op"],
  parsedAnalyses: ["op"],
  profiles: [{ id: "ngspice", corners: [] }],
  maxInputBytes: 2 * 1024 * 1024,
  maxOutputBytes: 1024 * 1024,
  maxTimeoutMs: 15000,
  cancel: true,
});

async function prepare(project) {
  const folder = createSimulationFolder({
    id: "polarity-op",
    name: "Polarity OP",
    profileId: "ngspice",
    engine: "ngspice",
    documentId: project.topDocumentId,
  });
  project.simulationFolders = [folder];
  const reopened = parseProject(serializeProject(project));
  const prepared = await prepareNgspiceExecutionInput(
    reopened,
    reopened.simulationFolders[0],
    capabilities,
  );
  if (!prepared.ok) throw new Error(JSON.stringify(prepared));
  return { project: reopened, prepared };
}

it("uses the same imported Cell ports and amplifier aliases in Properties, design export and prepared OP", async () => {
  const { project, prepared } = await prepare(await pinOrderOpProject());
  const divider = project.documents.find(({ name }) => name === "divider");
  expect(
    designNetlistCellPorts(project, divider.id)?.map(({ name }) => name),
  ).toEqual(["VIN", "MID", "VSS"]);
  for (const [format, declaration, call] of [
    ["spice", ".subckt divider VIN MID VSS", "XAMP ref out mid gain_two"],
    ["spectre", "subckt divider (VIN MID VSS)", "XAMP (ref out mid) gain_two"],
  ]) {
    const exported = createDesignNetlistExport(project, { format });
    if (exported.status !== "ready")
      throw new Error(JSON.stringify(exported.diagnostics));
    expect(exported.file.text.split("\n")).toEqual(
      expect.arrayContaining([declaration, call]),
    );
  }
  expect(prepared.input.environment?.profileId).toBe("ngspice");
  expect(prepared.input.netlist?.split("\n")).toEqual(
    expect.arrayContaining([
      ".subckt divider VIN MID VSS",
      "XDIV in mid 0 divider",
      "XAMP ref out mid gain_two",
    ]),
  );
});

const ngspice = process.env.NGSPICE_BIN ?? "ngspice";
const simulator = spawnSync(ngspice, ["--version"], { encoding: "utf8" });

it.skipIf(simulator.status !== 0)(
  "executes the prepared hierarchy and distinguishes correct from exchanged amplifier inputs in real ngspice",
  async () => {
    for (const [swapped, expected] of [
      [false, 1],
      [true, -1],
    ]) {
      const {
        prepared: { input },
      } = await prepare(await pinOrderOpProject(swapped));
      const version = /\bngspice-([\d.]+)/iu.exec(simulator.stdout)?.[1];
      if (
        !version ||
        !input.entryPath ||
        !input.collection ||
        !("rawfile" in input.collection) ||
        !input.collection.rawfile
      )
        throw new Error(
          "Expected a versioned ngspice and prepared source files with declared output",
        );
      const collection = { rawfile: input.collection.rawfile };
      const directory = mkdtempSync(join(tmpdir(), "icm-pin-order-op-"));
      try {
        for (const { path, text } of input.files) {
          const file = join(directory, path);
          mkdirSync(dirname(file), { recursive: true });
          writeFileSync(file, text);
        }
        const started = performance.now();
        const execution = spawnSync(ngspice, ["-b", input.entryPath], {
          cwd: directory,
          encoding: "utf8",
          timeout: capabilities.maxTimeoutMs,
        });
        expect(execution.status, execution.stderr).toBe(0);
        const rawfile = readFileSync(
          join(directory, collection.rawfile),
          "utf8",
        );
        const raw = parseNgspiceRawfile(rawfile);
        const runToken = randomUUID();
        const environment = await createSimulationEnvironmentMetadata({
          executor: "local-host",
          reproducibility: "observed",
          profileId: input.environment.profileId,
          platform: `${process.platform}/${process.arch}`,
          simulator: { name: "ngspice", version, binarySha256: null },
          models: null,
          startupSha256: null,
        });
        const executedDeck = input.preparedDeck ?? input.testbench;
        const response = await ngspiceResultResponse(
          {
            deck: executedDeck,
            entryPath: input.entryPath,
            files: input.files,
            collection,
            runToken,
            outputContext: {
              netlist: input.netlist,
              testbench: input.testbench,
              inputRevision: input.inputRevision,
              modelLibrary: null,
              execution: { target: "operator-host" },
            },
          },
          {
            ...execution,
            exitCode: execution.status,
            durationMs: performance.now() - started,
            rawfile,
            rawfileFormat: "ascii",
            rawfileName: collection.rawfile,
            rawfileRequested: true,
            collection,
            environment,
            limits: { timeoutMs: capabilities.maxTimeoutMs },
          },
          true,
        );
        const digest = (value) =>
          createHash("sha256").update(value).digest("hex");
        expect(response.status).toBe(200);
        expect(
          readExecutionReceipt(
            response.headers[EXECUTION_RECEIPT_HEADER] ?? null,
          ),
        ).toMatchObject({
          runToken,
          collectionStatus: "complete",
          outcome: { status: "completed" },
          sha256: digest(response.body),
          executedFilesSha256: digest(JSON.stringify(input.files)),
          metadata: {
            environment,
            input: {
              inputRevision: input.inputRevision,
              deckSha256: digest(executedDeck),
              testbenchSha256: digest(input.testbench),
              netlistSha256: digest(input.netlist),
            },
          },
        });
        if (!raw.ok) throw new Error(JSON.stringify(raw.error));
        const op = raw.plots.find(
          ({ plotName }) => plotName === "Operating Point",
        );
        const voltage = (name) =>
          op?.vectors.find((vector) => vector.variable.name === `v(${name})`)
            ?.real[0];
        expect(voltage("mid")).toBeCloseTo(1, 3);
        expect(voltage("out")).toBeCloseTo(expected, 3);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    }
  },
);
