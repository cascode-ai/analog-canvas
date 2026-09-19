import { it, expect } from "vitest";
import { readFile, mkdtemp, writeFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createEmptyProject } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import {
  planProjectCellImport,
  executeProjectTransaction,
} from "../packages/edit-engine/src/index.js";
import { prepareSourceExecutionInput } from "@icm/simulation-service";
import { nativeImportedTestbench } from "./lib/native-cross-project-fixture.mjs";
import { startVacaskService } from "../containers/vacask/entrypoint.mjs";
import { validateNativeExampleResult } from "./lib/native-example-acceptance.mjs";

async function prepareImportedFixture() {
  const reference = parseProject(
    await readFile(
      "apps/editor/src/examples/five-transistor-ota-sky130.icproj.json",
      "utf8",
    ),
  );
  const before = structuredClone(reference);
  const destination = createEmptyProject("cross-native", "Cross native");
  const plan = planProjectCellImport(destination, reference, "document-ota-5t");
  expect(plan.ok).toBe(true);
  const imported = executeProjectTransaction(destination, {
    transactionId: "import",
    projectId: destination.id,
    expectedStructureRevision: destination.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: plan.edits,
  });
  expect(imported.ok, JSON.stringify(imported.error)).toBe(true);
  const { testbench, folder } = nativeImportedTestbench(
    reference,
    plan.rootDocumentId,
    "cross-tb",
    "cross-op",
  );
  const authored = executeProjectTransaction(imported.project, {
    transactionId: "tb",
    projectId: destination.id,
    expectedStructureRevision: imported.project.structureRevision,
    actor: { kind: "human", id: "test" },
    edits: [
      { kind: "add_document", document: testbench },
      { kind: "upsert_simulation_folder", folder },
    ],
  });
  expect(authored.ok, JSON.stringify(authored.error)).toBe(true);
  const symbols = JSON.parse(
    await readFile(
      "netlists/vacask-sky130/model-symbols-sections.json",
      "utf8",
    ),
  );
  const capabilities = {
    configured: true,
    rawfileCollection: "native-multi-ascii",
    inputs: ["source"],
    analyses: ["op"],
    parsedAnalyses: ["op"],
    maxTimeoutMs: 15000,
    maxInputBytes: 1048576,
    maxInputFiles: 24,
    maxOutputBytes: 8388608,
    cancel: true,
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
  };
  const prepared = await prepareSourceExecutionInput(
    authored.project,
    folder,
    capabilities,
  );
  expect(prepared.ok, JSON.stringify(prepared)).toBe(true);
  expect(prepared.input.language).toBe("vacask");
  expect(prepared.input.environment.corner).toBe("tt");
  expect(prepared.input.preparedDeck).toContain("options scale=0.000001");
  expect(prepared.input.preparedDeck).not.toContain(".control");
  const dut = authored.project.documents.find(
    (d) => d.id === plan.rootDocumentId,
  );
  expect(
    dut.netlist.terminals.map(({ name, direction }) => ({ name, direction })),
  ).toEqual(
    reference.documents
      .find((d) => d.id === "document-ota-5t")
      .netlist.terminals.map(({ name, direction }) => ({ name, direction })),
  );
  for (const terminal of dut.netlist.terminals) {
    expect(dut.nets.some((n) => n.id === terminal.netId)).toBe(true);
    expect(
      terminal.interfaceInstanceIds.every((id) =>
        dut.instances.some((i) => i.id === id),
      ),
    ).toBe(true);
  }
  const circuit = prepared.input.files.find(
    (f) => f.path === "circuit.spice",
  ).text;
  expect(circuit).toMatch(/subckt\s+\S+\s*\(vdd vss ibias vinn vinp vout\)/u);
  expect(circuit).toMatch(/XDUT\s+\(vdd 0 ibias vinn vinp vout\)\s+\S+/u);
  expect(
    testbench.instances.find((i) => i.id === "XDUT").netlist.binding
      .childDocumentId,
  ).toBe(plan.rootDocumentId);
  expect(reference).toEqual(before);
  return {
    project: authored.project,
    input: prepared.input,
    capabilities,
    symbols,
  };
}

it(
  "imports the real OTA DUT through the shared transaction and prepares its native Canvas TB",
  prepareImportedFixture,
);

it.skipIf(
  !process.env.VACASK_BIN ||
    !process.env.VACASK_MODULES ||
    !process.env.ICM_VACASK_SECTIONED_MANIFEST,
)(
  "executes the imported Canvas DUT on native VACASK and preserves the prepared circuit bytes",
  async () => {
    const { project, input, capabilities, symbols } =
      await prepareImportedFixture();
    const before = structuredClone(project);
    const manifestPath = resolve(process.env.ICM_VACASK_SECTIONED_MANIFEST);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.dependency).toEqual(symbols.dependency);
    expect(manifest.modelSymbols).toEqual(symbols.modelSymbols);
    const root = await mkdtemp(join(tmpdir(), "native-imported-ota-"));
    let service;
    let evidence;
    try {
      const startupPath = join(root, "startup.toml");
      await writeFile(startupPath, "# Native cross-Project acceptance\n");
      service = await startVacaskService({
        runtime: {
          executor: "local-host",
          profileId: "vacask-sky130-candidate",
          binary: resolve(process.env.VACASK_BIN),
          modules: resolve(process.env.VACASK_MODULES),
          startupPath,
          runRoot: root,
          dependencies: [
            {
              ...manifest.dependency,
              runtimePath: join(dirname(manifestPath), manifest.library),
            },
          ],
          ...(process.env.ICM_VACASK_LIBRARY_PATH
            ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
            : {}),
        },
        capabilities,
        limits: {
          maxInputBytes: 1048576,
          maxInputFiles: 24,
          maxOutputBytes: 8388608,
          maxLogBytes: 65536,
          maxRawFiles: 16,
          maxEntries: 256,
        },
      });
      const runtime = await service.ready;
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
      evidence = { input, result };
      expect(response.status, JSON.stringify(result)).toBe(200);
      validateNativeExampleResult(result);
      expect(result.metadata.environment).toEqual(runtime.environment);
      expect(result.executedFiles).toEqual(expect.arrayContaining(input.files));
      const op = result.data.analyses.find((a) => a.analysis === "op");
      const probe = op?.probes.find((p) => p.name === "vout");
      const value = Array.isArray(probe?.value) ? probe.value[0] : probe?.value;
      expect(Number.isFinite(value)).toBe(true);
      // Basic rail sanity, not an ngspice equivalence/tolerance baseline.
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThan(1.8);
      expect(result.rawfiles.some((f) => f.path === "bias.raw")).toBe(true);
      expect(project).toEqual(before);
    } finally {
      try {
        if (evidence && process.env.ICM_VACASK_EVIDENCE_DIR) {
          const directory = await mkdtemp(
            join(
              resolve(process.env.ICM_VACASK_EVIDENCE_DIR),
              "cross-project-",
            ),
          );
          await writeFile(
            join(directory, "run.json"),
            JSON.stringify(evidence),
          );
          console.info("Native cross-Project run evidence", directory);
        }
      } finally {
        if (service) await service.stop();
        await rm(root, { recursive: true, force: true });
      }
    }
  },
  120000,
);
