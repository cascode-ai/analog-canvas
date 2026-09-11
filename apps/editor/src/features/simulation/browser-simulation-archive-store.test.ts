import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { createBrowserSimulationArchiveStore } from "./browser-simulation-archive-store";
import type { SimulationRunArchiveV1 } from "./simulation-run-archive";

function archive(id: string, createdAt: string): SimulationRunArchiveV1 {
  return {
    schemaVersion: 1,
    id,
    projectId: "project",
    createdAt,
    presentation: {
      folderId: "folder",
      folderName: "Bias",
      analysisLabel: "OP",
      outputs: [],
    },
    prepared: {
      id: `prepared-${id}`,
      digest: "a".repeat(64),
      inputRevision: "revision",
      expiresAt: 1,
      mode: "structured",
      environment: { profileId: "test" },
      vectors: [],
      outputs: [],
      deviceOperatingPoints: [],
      warnings: [],
      artifactIds: [],
    },
    run: {
      id: `run-${id}`,
      preparedId: `prepared-${id}`,
      inputRevision: "revision",
      state: "finished",
    },
    artifacts: [],
    byteLength: 0,
  };
}

describe("browser simulation archive store", () => {
  it("survives store replacement and retains the ten newest Project runs", async () => {
    const factory = new IDBFactory() as unknown as IDBFactory;
    const options = { idbFactory: factory, databaseName: "archive-test" };
    const first = createBrowserSimulationArchiveStore(options);
    for (let index = 0; index < 12; index += 1) {
      const saved = await first.save(
        archive(`archive-${index}`, new Date(index * 1000).toISOString()),
      );
      expect(saved.ok).toBe(true);
    }
    first.close();

    const reopened = createBrowserSimulationArchiveStore(options);
    const listed = await reopened.list("project");
    expect(listed.ok).toBe(true);
    if (!listed.ok) return;
    expect(listed.value).toHaveLength(10);
    expect(listed.value[0]?.id).toBe("archive-11");
    expect(listed.value.at(-1)?.id).toBe("archive-2");
    const pruned = await reopened.read("archive-1");
    expect(pruned.ok && pruned.value).toBeNull();
    const retained = await reopened.read("archive-11");
    expect(retained.ok && retained.value?.id).toBe("archive-11");
    expect(await reopened.delete("archive-11")).toMatchObject({
      ok: true,
      value: true,
    });
    const afterDelete = await reopened.list("project");
    expect(afterDelete.ok && afterDelete.value).toHaveLength(9);
  });
});
