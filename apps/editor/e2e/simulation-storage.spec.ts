import { expect, test } from "@playwright/test";

test("Project evidence lifetime defers reclamation until the next idle startup", async ({
  page,
}) => {
  await page.goto("/editor");
  const result = await page.evaluate(async () => {
    const artifactPath =
      "/src/features/simulation/browser-simulation-artifact-store.ts";
    const archivePath =
      "/src/features/simulation/browser-simulation-archive-store.ts";
    const { createBrowserSimulationArtifactStore } = await import(artifactPath);
    const { createBrowserSimulationArchiveStore } = await import(archivePath);
    const projectId = "cleanup-browser-proof";
    const active = createBrowserSimulationArtifactStore(projectId, indexedDB, {
      retainSession: true,
    });
    const archives = createBrowserSimulationArchiveStore();
    const ref = {
      id: "kept",
      name: "result.raw",
      mediaType: "text/plain",
      byteLength: 4,
      sha256: "a".repeat(64),
    };
    await active.put(ref, "data");
    await active.put({ ...ref, id: "orphan" }, "data");
    await active.saveCatalog({
      catalog: {
        schemaVersion: 1,
        runId: "kept-run",
        preparedId: "prepared",
        inputRevision: "rev",
        execution: "completed",
        collection: "complete",
        files: [ref],
        datasets: [],
      },
      storedAt: 1,
    });
    const deferred = await archives.cleanup(projectId);
    const before = (await active.get("orphan"))?.text;
    active.releaseSession();
    // First access in the new lifetime performs cleanup before acquiring its lease.
    const fresh = createBrowserSimulationArtifactStore(projectId, indexedDB, {
      retainSession: true,
    });
    const orphan = await fresh.get("orphan");
    const kept = (await fresh.get("kept"))?.text;
    const catalogs = await fresh.catalogs();
    fresh.releaseSession();
    archives.close();
    return {
      deferred,
      before,
      orphan,
      kept,
      runIds: catalogs.map((entry: any) => entry.catalog.runId),
    };
  });
  expect(result).toEqual({
    deferred: { ok: true, value: { deferred: true, files: 0, bytes: 0 } },
    before: "data",
    orphan: null,
    kept: "data",
    runIds: ["kept-run"],
  });
});

test("Project evidence lifetime protects across tabs and releases on page close", async ({
  page,
  context,
}) => {
  await page.goto("/editor");
  const peer = await context.newPage();
  await peer.goto("/editor");
  await page.evaluate(async () => {
    const path = "/src/features/simulation/browser-simulation-storage-lock.ts";
    const { ProjectEvidenceLease } = await import(path);
    const lease = new ProjectEvidenceLease("storage-lifetime-proof");
    (window as any).evidenceLease = lease;
    await lease.acquire();
    await lease.acquire(); // one consumer must not accidentally retain twice
  });
  const attempt = () =>
    peer.evaluate(async () => {
      const path =
        "/src/features/simulation/browser-simulation-storage-lock.ts";
      const { withExclusiveEvidence } = await import(path);
      return withExclusiveEvidence(
        "storage-lifetime-proof",
        async () => "reclaimed",
      );
    });
  expect(await attempt()).toEqual({ available: false });
  expect(
    await peer.evaluate(async () => {
      const path =
        "/src/features/simulation/browser-simulation-storage-lock.ts";
      const { withExclusiveEvidence } = await import(path);
      return withExclusiveEvidence("different-project", async () => "isolated");
    }),
  ).toEqual({ available: true, value: "isolated" });
  await page.evaluate(() => (window as any).evidenceLease.release());
  await expect.poll(attempt).toEqual({ available: true, value: "reclaimed" });
  await page.evaluate(async () => {
    await (window as any).evidenceLease.acquire();
  });
  expect(await attempt()).toEqual({ available: false });
  await page.close();
  await expect.poll(attempt).toEqual({ available: true, value: "reclaimed" });
});
