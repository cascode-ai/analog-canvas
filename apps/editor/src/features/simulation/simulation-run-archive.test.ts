import { sourcePresentation } from "./source-presentation";
import { describe, expect, it } from "vitest";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import type { Prepared, Run } from "@icm/simulation-service/contract";
import { SimulationFiles } from "@icm/simulation-service/files";

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
    },
  );
});
