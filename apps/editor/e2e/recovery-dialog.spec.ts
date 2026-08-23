import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  chooseComponent,
  clickCommand,
  emulateDownloadOnlyBrowser,
  readRecoveryRecords,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

const fixtureText = readFileSync(
  resolve(
    process.cwd(),
    "fixtures/projects/phase-1-manual/project.icproj.json",
  ),
  "utf8",
);

interface SeedRecord {
  workingCopyId: string;
  generation: "latest" | "previous";
  projectText: string;
  projectName: string;
  schemaVersion: number;
  updatedAt: string;
}

async function seedRecoveryRecords(
  page: Page,
  records: SeedRecord[],
): Promise<void> {
  await page.evaluate(async (entries) => {
    const seeds = entries as SeedRecord[];
    await new Promise<void>((resolvePromise, rejectPromise) => {
      const request = indexedDB.open("analog-canvas-recovery");
      request.onerror = () => rejectPromise(request.error);
      request.onsuccess = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("browser-recovery-v2")) {
          rejectPromise(new Error("recovery store missing"));
          database.close();
          return;
        }
        const tx = database.transaction("browser-recovery-v2", "readwrite");
        const store = tx.objectStore("browser-recovery-v2");
        for (const entry of seeds) {
          store.put(
            {
              format: "analog-canvas-browser-recovery-v2",
              recordId: `${entry.workingCopyId}-${entry.generation}`,
              workingCopyId: entry.workingCopyId,
              generation: entry.generation,
              projectId: "seed-project",
              projectName: entry.projectName,
              projectSchemaVersion: entry.schemaVersion,
              topDocumentId: "document-main",
              documentRevisions: { "document-main": 0 },
              source: "new",
              updatedAt: entry.updatedAt,
              byteLength: entry.projectText.length,
              projectText: entry.projectText,
            },
            `${entry.workingCopyId}#${entry.generation}`,
          );
        }
        tx.oncomplete = () => {
          database.close();
          resolvePromise();
        };
        tx.onerror = () => rejectPromise(tx.error);
      };
    });
  }, records);
}

test.beforeEach(async ({ page }) => {
  await emulateDownloadOnlyBrowser(page);
});

test("recovery stays reachable after reload and restore forks a working copy", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  await page.reload();
  // No startup notice covers the canvas; recovery is reachable on demand.
  await expect(page.getByTestId("recovery-banner")).toHaveCount(0);
  await clickCommand(page, "File", "Recover recent work…");

  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("recovery-session-card")).toHaveCount(1);
  await dialog.getByRole("button", { name: "Restore" }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toContainText(
    "Restored recovery revision 1",
  );
});

test("a damaged latest copy restores the previous generation", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  // Place one more edit so a valid previous generation exists, then corrupt
  // the latest record's Project text in place.
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 500, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 2');
  const records = await readRecoveryRecords(page);
  const target = records.find((record) => record.generation === "latest");
  expect(target).toBeDefined();
  await page.evaluate((workingCopyId: string) => {
    void new Promise<void>((resolvePromise, rejectPromise) => {
      const request = indexedDB.open("analog-canvas-recovery");
      request.onerror = () => rejectPromise(request.error);
      request.onsuccess = () => {
        const database = request.result;
        const tx = database.transaction("browser-recovery-v2", "readwrite");
        const store = tx.objectStore("browser-recovery-v2");
        const get = store.get(`${workingCopyId}#latest`);
        get.onsuccess = () => {
          const record = get.result as Record<string, unknown>;
          record.projectText = "corrupted by test";
          store.put(record, `${workingCopyId}#latest`);
        };
        tx.oncomplete = () => {
          database.close();
          resolvePromise();
        };
        tx.onerror = () => rejectPromise(tx.error);
      };
    });
  }, target!.workingCopyId);

  await page.reload();
  await clickCommand(page, "File", "Recover recent work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("recovery-session-card")).toContainText(
    "Damaged",
  );
  await dialog
    .getByRole("button", { name: "Restore previous copy of New Circuit" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("a newer-schema copy is downloadable but not restorable", async ({
  page,
}) => {
  await page.goto("/editor");
  const futureText = JSON.stringify({
    ...JSON.parse(fixtureText),
    schemaVersion: 99,
  });
  await seedRecoveryRecords(page, [
    {
      workingCopyId: "future-copy",
      generation: "latest",
      projectText: futureText,
      projectName: "Future Project",
      schemaVersion: 99,
      updatedAt: new Date().toISOString(),
    },
  ]);
  await page.reload();
  await clickCommand(page, "File", "Recover recent work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  const card = dialog.getByTestId("recovery-session-card").filter({
    hasText: "Future Project",
  });
  await expect(card).toContainText("Newer Project schema");
  await expect(card.getByRole("button", { name: "Restore" })).toBeDisabled();

  const downloadPromise = page.waitForEvent("download");
  await card
    .getByRole("button", { name: "Download backup of Future Project" })
    .click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain("-backup.icproj.json");
  // The incompatible record is still present, never deleted as corrupt.
  await expect
    .poll(async () => {
      const records = await readRecoveryRecords(page);
      return records.some((record) =>
        record.projectText.includes('"schemaVersion":99'),
      );
    })
    .toBe(true);
});

test("deleting one session keeps the other project's copy", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');
  await page
    .getByTestId("project-file")
    .setInputFiles(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-1-manual/project.icproj.json",
      ),
    );
  await page
    .getByRole("dialog", { name: "Protect the current Project" })
    .getByRole("button", { name: "Discard and continue" })
    .click();
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Manual Editor Demo",
  );
  // Wait for the debounced seed write of the incoming working copy before
  // reloading, then both sessions must appear after discovery.
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"name": "Phase 1 Manual Editor"');
  await page.reload();

  await clickCommand(page, "File", "Recover recent work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog.getByTestId("recovery-session-card")).toHaveCount(2);
  const firstCard = dialog.getByTestId("recovery-session-card").first();
  await firstCard.getByRole("button", { name: /^Delete/ }).click();
  await expect(dialog.getByTestId("recovery-session-card")).toHaveCount(1);
  const remaining = await readRecoveryRecords(page);
  expect(remaining.length).toBeGreaterThan(0);
});

test("dialog closes with Escape and keeps focus labels", async ({ page }) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');
  await page.reload();

  await clickCommand(page, "File", "Recover recent work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close recent work recovery" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("storage failure shows a persistent warning with a direct download", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: false,
      get() {
        throw new DOMException("storage blocked", "InvalidStateError");
      },
    });
  });
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");
  const warning = page.getByTestId("recovery-failure-banner");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("unavailable");
  await expect(page.getByTestId("recovery-state")).toHaveText(
    "Recovery unavailable — download now",
  );

  const downloadPromise = page.waitForEvent("download");
  await warning.getByRole("button", { name: "Download Project" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".icproj.json");
  // The warning stays until dismissed; the editor never crashes.
  await expect(warning).toBeVisible();
});
