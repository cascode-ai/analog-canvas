import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import {
  clickCommand,
  downloadBytes,
  expectStatus,
  openMenu,
  openProjectFile,
  placeResistors,
  readRecoveryRecords,
  readRecoveredProjects,
  expectRecoveredRevision,
} from "./editor-fixtures.js";

const fixtureText = readFileSync(
  resolve(process.cwd(), "fixtures/projects/manual-basics/project.icproj.json"),
  "utf8",
);

/** Merge `patch` into the stored recovery record at `key`, or store it whole. */
async function patchRecoveryRecord(
  page: Page,
  key: string,
  patch: Record<string, unknown>,
): Promise<void> {
  await page.evaluate(
    ([key, patch]) =>
      new Promise<void>((resolvePromise, rejectPromise) => {
        const request = indexedDB.open("analog-canvas-recovery");
        request.onerror = () => rejectPromise(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const tx = database.transaction("browser-recovery-v2", "readwrite");
          const store = tx.objectStore("browser-recovery-v2");
          const get = store.get(key);
          get.onsuccess = () => store.put({ ...get.result, ...patch }, key);
          tx.oncomplete = () => {
            database.close();
            resolvePromise();
          };
          tx.onerror = () => rejectPromise(tx.error);
        };
      }),
    [key, patch] as const,
  );
}

test("startup recovery without a saved workspace restores into a new working copy", async ({
  page,
}) => {
  await page.goto("/editor");
  // A fresh navigation has no saved window workspace and can offer recovery.
  // One lone component remains below the banner's meaningful-content threshold.
  await placeResistors(page, [360]);
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expectRecoveredRevision(page, 1);
  await page.goto("/editor?recovery=small");
  const banner = page.getByTestId("startup-recovery-banner");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await expect(banner).toHaveCount(0);

  // Three objects clear the threshold and the banner offers the restore.
  await placeResistors(page, [360, 470, 580], 330);
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expectRecoveredRevision(page, 3);

  await page.goto("/editor?recovery=meaningful");
  await expect(banner).toBeVisible();
  await expect(banner).toContainText("New Circuit");
  await banner.getByRole("button", { name: "Restore" }).click();
  await expect(banner).toBeHidden();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expectStatus(page, "Restored recovery revision 3");
});

test("a damaged copy restores its previous generation; a newer-schema copy downloads but never restores", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeResistors(page, [360]);
  await expectRecoveredRevision(page, 1);

  // Place one more edit so a valid previous generation exists, then corrupt
  // the latest record's Project text in place.
  await placeResistors(page, [500]);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expectRecoveredRevision(page, 2);
  const latest = (await readRecoveryRecords(page)).find(
    (record) => record.generation === "latest",
  )!;
  await patchRecoveryRecord(page, `${latest.workingCopyId}#latest`, {
    projectText: "corrupted by test",
  });
  // A copy another, newer build left behind.
  const futureText = JSON.stringify({
    ...JSON.parse(fixtureText),
    schemaVersion: 99,
  });
  await patchRecoveryRecord(page, "future-copy#latest", {
    format: "analog-canvas-browser-recovery-v2",
    recordId: "future-copy-latest",
    workingCopyId: "future-copy",
    generation: "latest",
    projectId: "seed-project",
    projectName: "Future Project",
    projectSchemaVersion: 99,
    topDocumentId: "document-main",
    documentRevisions: { "document-main": 0 },
    source: "new",
    updatedAt: new Date().toISOString(),
    byteLength: futureText.length,
    projectText: futureText,
  });

  await page.goto("/editor?recovery=damaged");
  await clickCommand(page, "File", "Recover Unsaved Work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  // The tab this address left behind has a copy of its own beside it (#1599).
  const cards = dialog.getByTestId("recovery-session-card");
  await expect(cards).toHaveCount(3);

  const future = cards.filter({ hasText: "Future Project" });
  await expect(future).toContainText("Newer Project schema");
  await expect(future.getByRole("button", { name: "Restore" })).toBeDisabled();
  const downloadPromise = page.waitForEvent("download");
  await future
    .getByRole("button", { name: "Download backup of Future Project" })
    .click();
  expect((await downloadPromise).suggestedFilename()).toContain(
    "-backup.icproj.json",
  );
  // The incompatible record is still present, never deleted as corrupt.
  expect(
    (await readRecoveryRecords(page)).some((record) =>
      record.projectText.includes('"schemaVersion":99'),
    ),
  ).toBe(true);

  const damaged = cards.filter({ hasText: "Damaged" });
  await expect(damaged).toHaveCount(1);
  await damaged
    .getByRole("button", { name: "Restore previous copy of New Circuit" })
    .click();
  await expect(dialog).toBeHidden();
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("export keeps recovery; explicit discard removes it and hides a clean replacement", async ({
  page,
}) => {
  await page.goto("/editor");
  // Three authored objects: enough for the replacement guard to engage.
  await placeResistors(page, [300, 380, 460]);
  await expectRecoveredRevision(page, 3);
  // Exporting downloads the formal Project but never clears the browser
  // recovery copies: the next write rotates revision 3 into the previous
  // generation of the same session. That edit also invalidates the export's
  // safe stamp, so the replacement below prompts again.
  await downloadBytes(page, "File", "Export Project File…");
  await placeResistors(page, [540]);
  await expect
    .poll(async () =>
      (await readRecoveredProjects(page)).flatMap(({ documents }) =>
        documents.map(({ revision }) => revision),
      ),
    )
    .toEqual(expect.arrayContaining([4, 3]));
  const replacement = createEmptyProject(
    "clean-replacement",
    "Clean Replacement",
  );
  replacement.documents[0]!.name = "Clean Replacement Cell";
  await openProjectFile(
    page,
    serializeProject(replacement),
    "clean-replacement.icproj.json",
  );
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Clean Replacement Cell",
  );
  // Wait for the debounced seed write of the incoming clean working copy.
  // Explicit Discard removed the outgoing session, and a clean recovery seed
  // must not make the exceptional Recovery command permanently visible.
  await expect
    .poll(async () => {
      const names = (await readRecoveredProjects(page)).map(({ name }) => name);
      return [
        names.includes("Clean Replacement"),
        names.includes("New Circuit"),
      ];
    })
    .toEqual([true, false]);
  await page.reload();

  const fileMenu = await openMenu(page, "File");
  await expect(
    fileMenu.getByRole("button", { name: "Recover Unsaved Work…" }),
  ).toHaveCount(0);
});

test("dialog closes with Escape, keeps focus labels and deletes a copy", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeResistors(page, [360]);
  await expectRecoveredRevision(page, 1);
  await page.reload();

  await clickCommand(page, "File", "Recover Unsaved Work…");
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close recent work recovery" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // #1250: a click on the dialog's text moves focus off its controls; Esc
  // still closes it.
  await clickCommand(page, "File", "Recover Unsaved Work…");
  await expect(dialog).toBeVisible();
  await dialog.getByText("These copies live only in this browser").click();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();

  // Delete clears the recovery slot.
  await clickCommand(page, "File", "Recover Unsaved Work…");
  await dialog.getByRole("button", { name: "Delete" }).click();
  await expect
    .poll(async () => (await readRecoveryRecords(page)).length)
    .toBe(0);
});

test("storage failure keeps editing, offers a backup and never acknowledges Cloud Save", async ({
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
  await placeResistors(page, [360]);
  await expect(page.getByTestId("revision")).toHaveText("1");
  const warning = page.getByTestId("recovery-failure-banner");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("unavailable");
  await expect(page.getByTestId("recovery-state")).toHaveText(
    "Recovery unavailable — download now",
  );
  // The editor keeps committing, and the warning stays.
  await placeResistors(page, [500]);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(warning).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await warning.getByRole("button", { name: "Download Backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".icproj.json");
  const downloadedText = readFileSync(await download.path(), "utf8");
  expect(downloadedText).toContain('\n  "schemaVersion": ');
  expect(JSON.parse(downloadedText).documents[0].instances).toHaveLength(2);
  // A portable backup mitigates data loss but is not the Cloud Save
  // authority. Keep both the dirty truth and the still-actionable storage
  // warning until the user explicitly dismisses it.
  await expect(warning).toBeVisible();
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  await warning.getByRole("button", { name: "Dismiss warning" }).click();
  await expect(warning).toBeHidden();
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
});
