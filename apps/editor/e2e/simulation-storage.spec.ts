import { expect, test } from "@playwright/test";
import { openProject } from "./editor-fixtures.js";
import { unzipSync } from "fflate";
import {
  completedNgspiceRun,
  downloadClicked,
  ngspiceCapabilities,
  ngspiceDividerProject,
  openSimulation,
  rcExample,
} from "./simulation-e2e-fixtures.js";

import { harnessModuleUrl } from "./helpers/harness-url";

const archiveUrl = harnessModuleUrl("browser-simulation-archive-store");
const artifactUrl = harnessModuleUrl("browser-simulation-artifact-store");
const lockUrl = harnessModuleUrl("browser-simulation-storage-lock");

test("GUI retries failed evidence storage and downloads a complete run without executing again", async ({
  page,
}) => {
  const project = await ngspiceDividerProject("storage-retry", "Storage retry");
  let executions = 0;
  await page.route("**/api/simulate", async (route) => {
    const input = route.request().postDataJSON();
    if (input.operation === "capabilities")
      return route.fulfill({ json: ngspiceCapabilities() });
    executions++;
    return route.fulfill({ json: await completedNgspiceRun(input) });
  });
  await page.addInitScript(() => {
    (window as any).refuseEvidence = true;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (value, key) {
      if (
        (window as any).refuseEvidence &&
        this.name === "files" &&
        value?.ref?.name === "result.json"
      )
        throw new DOMException("Test origin quota", "QuotaExceededError");
      return put.call(this, value, key);
    };
  });
  const panel = await openSimulation(
    page,
    project,
    "storage-retry.icproj.json",
  );
  const retry = panel.getByRole("button", { name: "Retry saving results" });
  const persistence = panel.getByLabel("Run evidence persistence");
  await panel.getByRole("button", { name: "Run", exact: true }).click();
  await expect(retry).toBeVisible();
  await expect(persistence).toContainText("Collection: complete");
  await expect(persistence).toContainText("Persistence: failed");
  expect(executions).toBe(1);
  await retry.click();
  await expect(retry).toBeEnabled();
  expect(executions).toBe(1);
  await page.evaluate(() => {
    (window as any).refuseEvidence = false;
  });
  await panel
    .getByRole("treeitem", { name: /Storage retry/ })
    .click({ button: "right" });
  const zipped = unzipSync(
    await downloadClicked(
      page.getByRole("menuitem", {
        name: "Download complete run…",
        exact: true,
      }),
    ),
  );
  expect(Object.keys(zipped)).toContain("evidence/result.json");
  expect(Object.keys(zipped)).toContain("evidence/evidence-manifest.json");
  expect(Object.keys(zipped).some((name) => name.endsWith(".raw"))).toBe(true);
  expect(
    JSON.parse(new TextDecoder().decode(zipped["evidence/result.json"]!)).data
      .analyses.length,
  ).toBeGreaterThan(0);
  await expect(retry).toHaveCount(0);
  expect(executions).toBe(1);
});

test("Run history can reveal browser results from other folders without changing the selected folder", async ({
  page,
}) => {
  const project = rcExample();
  const folderId = project.simulationFolders[0]!.id;
  await openProject(page, project, "history-folders.icproj.json");
  await page.evaluate(
    async ({ projectId, folderId, archiveUrl }) => {
      const { createBrowserSimulationArchiveStore } = await import(archiveUrl);
      const store = createBrowserSimulationArchiveStore();
      for (const [id, owner] of [
        ["current", folderId],
        ["other", "other-folder"],
      ] as const) {
        const saved = await store.save({
          schemaVersion: 1,
          id: `history-${id}`,
          projectId,
          createdAt: new Date(0).toISOString(),
          retention: "saved",
          presentation: {
            folderId: owner,
            folderName: id === "current" ? "Current" : "Other folder",
            analysisLabel: "OP",
            outputs: [],
          },
          prepared: {
            id: `prepared-${id}`,
            digest: "a".repeat(64),
            inputRevision: "rev",
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
            inputRevision: "rev",
            state: "finished",
          },
          artifacts: [],
          byteLength: 0,
        });
        if (!saved.ok) throw new Error(saved.message);
      }
      store.close();
    },
    { projectId: project.id, folderId, archiveUrl },
  );
  await page.getByTestId("open-analog-simulation").click();
  await page.locator(".simulation-run-history > summary").click();
  const history = page.getByRole("region", { name: "Saved folder results" });
  await expect(history).toContainText("Other folder");
  await page.getByRole("checkbox", { name: "All Project folders" }).uncheck();
  await expect(history).toContainText("Current");
  await expect(history).not.toContainText("Other folder");
});

// Web Locks and IndexedDB shared by two real tabs. The same rules within one
// tab are browser-simulation-artifact-store and -storage-lock module tests.
test("Evidence protection holds across tabs: a Project lease until release or page close, and a viewed Run against another tab's byte budget", async ({
  page,
  context,
}) => {
  await page.goto("/editor");
  const peer = await context.newPage();
  await peer.goto("/editor");
  await page.evaluate(async (path) => {
    const { ProjectEvidenceLease } = await import(path);
    const lease = new ProjectEvidenceLease("storage-lifetime-proof");
    (window as any).evidenceLease = lease;
    await lease.acquire();
    await lease.acquire(); // one consumer must not accidentally retain twice
  }, lockUrl);
  const attempt = () =>
    peer.evaluate(async (path) => {
      const { withExclusiveEvidence } = await import(path);
      return withExclusiveEvidence(
        "storage-lifetime-proof",
        async () => "reclaimed",
      );
    }, lockUrl);
  expect(await attempt()).toEqual({ available: false });
  expect(
    await peer.evaluate(async (path) => {
      const { withExclusiveEvidence } = await import(path);
      return withExclusiveEvidence("different-project", async () => "isolated");
    }, lockUrl),
  ).toEqual({ available: true, value: "isolated" });
  await page.evaluate(() => (window as any).evidenceLease.release());
  await expect.poll(attempt).toEqual({ available: true, value: "reclaimed" });

  // A Run this tab views stays while the other tab reclaims unrelated cache.
  await page.evaluate(async (path) => {
    const { createBrowserSimulationArtifactStore } = await import(path);
    const store = createBrowserSimulationArtifactStore(
      "cross-tab-byte-budget",
      indexedDB,
      { retainSession: true, limits: { bytes: 16, files: 8 } },
    );
    for (const [id, at] of [
      ["viewed", 1],
      ["unrelated", 2],
      ["latest", 3],
    ]) {
      const ref = {
        id,
        name: "result.raw",
        mediaType: "text/plain",
        byteLength: 4,
        sha256: await store.digest("data"),
      };
      await store.put(ref, "data");
      await store.saveCatalog({
        storedAt: at,
        catalog: {
          schemaVersion: 1,
          runId: id,
          preparedId: "prepared",
          inputRevision: "rev",
          retentionPolicy: "cache",
          execution: "completed",
          collection: "complete",
          files: [ref],
          datasets: [],
        },
      });
    }
    (window as any).viewedEvidence = await store.pinRun("viewed");
  }, artifactUrl);
  const reclaimed = await peer.evaluate(async (path) => {
    const { createBrowserSimulationArtifactStore } = await import(path);
    const store = createBrowserSimulationArtifactStore(
      "cross-tab-byte-budget",
      indexedDB,
      { retainSession: true, limits: { bytes: 16, files: 8 } },
    );
    await store.put(
      {
        id: "incoming",
        name: "result.raw",
        mediaType: "text/plain",
        byteLength: 8,
        sha256: await store.digest("incoming"),
      },
      "incoming",
    );
    return {
      viewed: (await store.get("viewed"))?.text,
      unrelated: await store.get("unrelated"),
      bytes: (await store.usage()).byteLength,
    };
  }, artifactUrl);
  expect(reclaimed).toEqual({ viewed: "data", unrelated: null, bytes: 16 });

  // Closing the tab that holds a lease releases it.
  await page.evaluate(async () => {
    await (window as any).evidenceLease.acquire();
  });
  expect(await attempt()).toEqual({ available: false });
  await page.close();
  await expect.poll(attempt).toEqual({ available: true, value: "reclaimed" });
});
