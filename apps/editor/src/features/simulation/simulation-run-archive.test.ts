import { sourcePresentation } from "./source-presentation";
import { describe, expect, it, vi } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import type { Prepared, Run } from "@icm/simulation-service/contract";
import { SimulationFiles } from "@icm/simulation-service/files";
import { resultCatalog } from "@icm/simulation-service";
import { IDBFactory } from "fake-indexeddb";
import { createBrowserSimulationArtifactStore } from "./browser-simulation-artifact-store";

import {
  captureSimulationRunArchive,
  restoreSimulationRunArchive,
} from "./simulation-run-archive";

const folder = createSimulationFolder({
  id: "folder-op",
  name: "Bias",
  profileId: "test",
  documentId: "doc",
});
const presentation = sourcePresentation(folder);

describe("simulation run archive", () => {
  it("captures evidence larger than the retired 32 MiB archive ceiling", async () => {
    const source = new SimulationFiles(
      Date.now,
      undefined,
      undefined,
      createBrowserSimulationArtifactStore("large-project", new IDBFactory()),
    );
    const large = await source.put(
      "large.raw",
      "text/plain",
      "x".repeat(33 * 1024 * 1024),
      { role: "raw" },
    );
    const outputData = {
      schemaVersion: 1 as const,
      analyses: [],
      diagnostics: [],
    };
    const result = await source.put(
      "outputs.json",
      "application/json",
      JSON.stringify(outputData),
    );
    const prepared: Prepared = {
      id: "prepared",
      digest: "a".repeat(64),
      inputRevision: "revision",
      expiresAt: 100,
      mode: "structured",
      environment: { profileId: "test" },
      vectors: [],
      outputs: [],
      deviceOperatingPoints: [],
      artifacts: [],
      warnings: [],
    };
    const captured = await captureSimulationRunArchive(source, {
      projectId: "large-project",
      presentation,
      prepared,
      run: {
        id: "run",
        preparedId: prepared.id,
        inputRevision: prepared.inputRevision,
        state: "finished",
        outputData,
        artifacts: [large, result],
      },
    });
    expect(captured.ok).toBe(true);
    if (!captured.ok) throw new Error(captured.error.message);
    expect(captured.value.byteLength).toBeGreaterThan(32 * 1024 * 1024);
    expect(captured.value.artifacts[0]?.text.length).toBe(33 * 1024 * 1024);
  });
  it.each([false, true])(
    "restores legacy or Spec-only archives (Spec: %s)",
    async (current) => {
      const source = new SimulationFiles();
      const preparedArtifact = await source.put(
        "prepared.cir",
        "text/plain",
        "op\n",
      );
      const specs = {
        schemaVersion: 1 as const,
        runId: "run",
        preparedId: "prepared",
        inputDigest: "a".repeat(64),
        results: [],
      };
      const outputData = {
        schemaVersion: 1 as const,
        analyses: [],
        diagnostics: [],
        ...(current ? { specs } : {}),
      };
      const artifactName = current ? "specs.json" : "outputs.json";
      const resultArtifact = await source.put(
        artifactName,
        "application/json",
        JSON.stringify(current ? specs : outputData),
        current ? { role: "specs" } : {},
      );
      const prepared: Prepared = {
        id: "prepared",
        digest: "a".repeat(64),
        inputRevision: "revision",
        expiresAt: 100,
        mode: "structured",
        environment: { profileId: "test", corner: "tt" },
        vectors: [],
        outputs: [],
        deviceOperatingPoints: [],
        artifacts: [preparedArtifact],
        warnings: [],
      };
      const run: Run = {
        id: "run",
        preparedId: prepared.id,
        inputRevision: prepared.inputRevision,
        state: "finished",
        outputData,
        artifacts: [preparedArtifact, resultArtifact],
      };
      run.catalog = resultCatalog(run, "complete");
      const project = createEmptyProject("project", "Archive", "doc");
      const captured = await captureSimulationRunArchive(source, {
        projectId: project.id,
        presentation,
        prepared,
        run,
      });
      folder.name = "Renamed after run";
      expect(captured.ok).toBe(true);
      if (!captured.ok) return;
      expect(captured.value.presentation.folderName).toBe("Bias");
      expect(captured.value.artifacts.map((item) => item.name)).toEqual([
        "prepared.cir",
        artifactName,
      ]);

      const destination = new SimulationFiles();
      const restored = await restoreSimulationRunArchive(
        destination,
        captured.value,
      );
      expect(restored).toMatchObject({
        ok: true,
        value: {
          prepared: { id: "prepared", artifacts: [{ name: "prepared.cir" }] },
          run: {
            id: "run",
            state: "finished",
            inputStatus: "unavailable",
            outputData,
            artifacts: [{ name: "prepared.cir" }, { name: artifactName }],
          },
        },
      });
      if (!restored.ok) throw new Error("restore failed");
      expect(restored.value.run.catalog?.files).toEqual(
        restored.value.run.artifacts,
      );
      expect(restored.value.run.artifacts[1]?.role).toBe(
        current ? "specs" : undefined,
      );
      expect(restored.value.run.catalog?.files[1]?.id).not.toBe(
        resultArtifact.id,
      );
      expect(restored.value.run.catalog?.files[1]?.fileId).toBe(
        resultArtifact.fileId,
      );
      const again = await restoreSimulationRunArchive(
        destination,
        captured.value,
      );
      expect(again).toEqual(restored);
    },
  );
  it("remaps populated dataset representations and rejects missing references before restoring", async () => {
    const source = new SimulationFiles();
    const raw = await source.put(
      "op.raw",
      "text/plain",
      "raw evidence fixture",
      { role: "raw", sourcePath: "op.raw" },
    );
    const outputs = {
      schemaVersion: 1 as const,
      analyses: [],
      diagnostics: [],
    };
    const report = await source.put(
      "outputs.json",
      "application/json",
      JSON.stringify(outputs),
    );
    const prepared: Prepared = {
      id: "prep",
      digest: "a".repeat(64),
      inputRevision: "rev",
      expiresAt: 100,
      mode: "raw",
      environment: { profileId: "test" },
      vectors: [],
      outputs: [],
      deviceOperatingPoints: [],
      artifacts: [],
      warnings: [],
    };
    const run: Run = {
      id: "run",
      preparedId: "prep",
      inputRevision: "rev",
      state: "finished",
      artifacts: [raw, report],
      outputData: outputs,
    };
    run.catalog = resultCatalog(run, "complete");
    run.catalog.datasets = [
      {
        id: "run:analysis:0",
        analysisIndex: 0,
        analysis: "op",
        plotName: "OP",
        pointCount: 1,
        signals: [{ name: "v(out)", quantity: "voltage", unit: "V" }],
        representations: [
          { artifactId: raw.id, fileId: raw.fileId!, selector: "plot:0" },
        ],
      },
    ];
    const captured = await captureSimulationRunArchive(source, {
      projectId: "project",
      presentation,
      prepared,
      run,
    });
    if (!captured.ok) throw Error(captured.error.message);
    const destination = new SimulationFiles();
    const restored = await restoreSimulationRunArchive(
      destination,
      captured.value,
    );
    if (!restored.ok) throw Error(restored.error.message);
    expect(restored.value.run.catalog?.datasets[0]?.representations).toEqual([
      {
        artifactId: restored.value.run.artifacts[0]!.id,
        fileId: raw.fileId,
        selector: "plot:0",
      },
    ]);
    expect(restored.value.run.artifacts[0]!.id).not.toBe(raw.id);
    const invalid = structuredClone(captured.value);
    invalid.run.catalog!.datasets[0]!.representations[0]!.artifactId =
      "missing";
    const put = vi.spyOn(destination, "put");
    expect(
      await restoreSimulationRunArchive(destination, invalid),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_ARCHIVE_REFERENCE_MISSING" },
    });
    expect(put).not.toHaveBeenCalled();
  });
});
