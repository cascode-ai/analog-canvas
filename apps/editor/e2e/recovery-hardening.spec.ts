import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { WORKING_COPY_STORAGE_KEY } from "../src/document/recovery-coordinator";
import {
  openMenu,
  placeComponentAt,
  placeResistors,
  readRecoveryRecords,
  expectRecoveredRevision,
} from "./editor-fixtures.js";

async function restoreThroughDialog(
  page: Page,
  cardText: string,
): Promise<void> {
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Recover Unsaved Work…" }).click();
  const dialog = page.getByRole("dialog", { name: "Recover recent work" });
  await expect(dialog).toBeVisible();
  const card = dialog
    .getByTestId("recovery-session-card")
    .filter({ hasText: cardText });
  await card
    .getByRole("button", { name: /Restore /u })
    .first()
    .click();
  await expect(dialog).toBeHidden();
}

test("a hard renderer crash restores the latest committed Project, which never entered Cache Storage", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeResistors(page, [360]);
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expectRecoveredRevision(page, 1);
  await placeResistors(page, [500]);
  await expect(page.getByTestId("revision")).toHaveText("2");
  // Both commits must be durably stored before the crash.
  await expectRecoveredRevision(page, 2);

  // Browser recovery is the only store of Project data: none of it enters
  // the offline shell's Cache Storage.
  const cached = await page.evaluate(async () => {
    const texts: string[] = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys())
        texts.push((await (await cache.match(request))?.text()) ?? "");
    }
    return texts.join("\n");
  });
  expect(cached).not.toContain('"topDocumentId"');
  expect(cached).not.toContain('"schemaVersion"');

  // Simulate an abrupt tab death: CDP `Page.crash` would take the whole
  // Playwright context down with it, so close the page without running
  // unload handlers instead. Both commits are already durably committed to
  // IndexedDB (polled above), so recovery must work from a fresh tab.
  await page.close({ runBeforeUnload: false });
  const revived = await page.context().newPage();
  await revived.goto("/editor");

  await restoreThroughDialog(revived, "revision 2");
  await expect(revived.getByTestId("revision")).toHaveText("2");
  await expect(revived.getByTestId("hit-R1")).toBeVisible();
  await expect(revived.getByTestId("hit-R2")).toBeVisible();
});

test("simultaneous tabs keep separate working copies", async ({ context }) => {
  test.slow();
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto("/editor");
  await placeResistors(pageA, [360, 500]);
  await expect(pageA.getByTestId("revision")).toHaveText("2");

  await pageB.goto("/editor");
  await placeComponentAt(pageB, "nmos", { x: 360, y: 230 });
  await expect(pageB.getByTestId("revision")).toHaveText("1");

  const workingCopyA = await pageA.evaluate((key) => {
    return sessionStorage.getItem(key);
  }, WORKING_COPY_STORAGE_KEY);
  const workingCopyB = await pageB.evaluate((key) => {
    return sessionStorage.getItem(key);
  }, WORKING_COPY_STORAGE_KEY);
  expect(workingCopyA).not.toBeNull();
  expect(workingCopyB).not.toBeNull();
  expect(workingCopyA).not.toBe(workingCopyB);

  // Both tabs' sessions coexist in the shared origin storage, and each tab
  // restores its own.
  await expect
    .poll(async () => {
      const latest = (await readRecoveryRecords(pageB)).filter(
        (record) => record.generation === "latest",
      );
      return [workingCopyA, workingCopyB].map(
        (id) =>
          JSON.parse(
            latest.find((record) => record.workingCopyId === id)?.projectText ??
              "{}",
          ).documents?.[0]?.revision,
      );
    })
    .toEqual([2, 1]);
  await pageA.reload();
  await restoreThroughDialog(pageA, "revision 2");
  await expect(pageA.getByTestId("hit-R1")).toBeVisible();
  await expect(pageA.getByTestId("hit-M1")).toHaveCount(0);

  await pageB.reload();
  await restoreThroughDialog(pageB, "revision 1");
  await expect(pageB.getByTestId("hit-M1")).toBeVisible();
  await expect(pageB.getByTestId("hit-R1")).toHaveCount(0);
});
