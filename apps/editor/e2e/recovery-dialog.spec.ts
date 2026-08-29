import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  awaitEditorReady,
  awaitRecoveryStoreReady,
  chooseComponent,
  clickCommand,
  openMenu,
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
  await awaitEditorReady(page);
  await awaitRecoveryStoreReady(page);
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

test("startup recovery is visible after reload and restore forks a working copy", async ({
  page,
}) => {
  await page.goto("/editor");
  // One lone component is below the meaningful-content threshold: the
  // reload must stay banner-free.
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
  const banner = page.getByTestId("startup-recovery-banner");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Three objects clear the threshold and the banner offers the restore.
  for (const x of [360, 470, 580]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 330 } });
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 3');

  await page.reload();
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("New Circuit");
  await banner.getByRole("button", { name: "Restore" }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.getByTestId("status")).toContainText(
    "Restored recovery revision 3",
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
  await clickCommand(page, "File", "Recover Local Work…");
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
  await clickCommand(page, "File", "Recover Local Work…");
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

test("explicit discard removes outgoing recovery and hides a clean replacement", async ({
  page,
}) => {
  await page.goto("/editor");
  // Three authored objects: enough for the replacement guard to engage.
  for (const x of [300, 380, 460]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 3');
  await page
    .getByTestId("project-file")
    .setInputFiles(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-1-manual/project.icproj.json",
      ),
    );
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Manual Editor Demo",
  );
  // Wait for the debounced seed write of the incoming clean working copy.
  // Explicit Discard removed the outgoing session, and a clean recovery seed
  // must not make the exceptional Recovery command permanently visible.
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"name": "Phase 1 Manual Editor"');
  await expect
    .poll(() => recoveryProjectTexts(page))
    .not.toContain('"name": "New Circuit"');
  await page.reload();

  const fileMenu = await openMenu(page, "File");
  await expect(
    fileMenu.getByRole("button", { name: "Recover Local Work…" }),
  ).toHaveCount(0);
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

  await clickCommand(page, "File", "Recover Local Work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close recent work recovery" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("storage failure offers a backup without acknowledging Cloud Save", async ({
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
  await warning.getByRole("button", { name: "Download Backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".icproj.json");
  // A portable backup mitigates data loss but is not the Cloud Save
  // authority. Keep both the dirty truth and the still-actionable storage
  // warning until the user explicitly dismisses it.
  await expect(warning).toBeVisible();
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  await warning.getByRole("button", { name: "Dismiss warning" }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
});
