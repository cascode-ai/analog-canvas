import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  chooseComponent,
  clickCommand,
  readRecoveryRecords,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

async function placeResistor(page: Page, x: number, y: number): Promise<void> {
  await chooseComponent(page, "resistor");
  await page.getByTestId("schematic-canvas").click({ position: { x, y } });
  await page.keyboard.press("Escape");
}

async function restoreThroughDialog(
  page: Page,
  cardText: string,
): Promise<void> {
  const fileMenu = await page
    .locator("summary")
    .filter({ hasText: "File" })
    .filter({ hasText: /^File$/u })
    .locator("..");
  if ((await fileMenu.getAttribute("open")) === null) {
    await fileMenu.locator("summary").click();
  }
  await fileMenu.getByRole("button", { name: "Recover Local Work…" }).click();
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

test("a hard renderer crash restores the latest committed Project", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeResistor(page, 360, 230);
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');
  await placeResistor(page, 500, 230);
  await expect(page.getByTestId("revision")).toHaveText("2");
  // Both commits must be durably stored before the crash.
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 2');

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
  const pageA = await context.newPage();
  const pageB = await context.newPage();

  await pageA.goto("/editor");
  await placeResistor(pageA, 360, 230);
  await placeResistor(pageA, 500, 230);
  await expect(pageA.getByTestId("revision")).toHaveText("2");

  await pageB.goto("/editor");
  await chooseComponent(pageB, "nmos");
  await pageB
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await pageB.keyboard.press("Escape");
  await expect(pageB.getByTestId("revision")).toHaveText("1");

  // Both tabs' sessions coexist in the shared origin storage.
  await expect
    .poll(async () => {
      const records = await readRecoveryRecords(pageB);
      return new Set(records.map((record) => record.workingCopyId)).size;
    })
    .toBe(2);

  await pageA.reload();
  await restoreThroughDialog(pageA, "revision 2");
  await expect(pageA.getByTestId("hit-R1")).toBeVisible();
  await expect(pageA.getByTestId("hit-M1")).toHaveCount(0);

  await pageB.reload();
  await restoreThroughDialog(pageB, "revision 1");
  await expect(pageB.getByTestId("hit-M1")).toBeVisible();
  await expect(pageB.getByTestId("hit-R1")).toHaveCount(0);
});

test("quota-exceeded keeps the editor alive with a persistent warning", async ({
  page,
}) => {
  await page.addInitScript(() => {
    const realOpen = indexedDB.open.bind(indexedDB);
    const failingRequest = (error: DOMException) => {
      const pending: { onerror: ((event: Event) => void) | null } = {
        onerror: null,
      };
      let onsuccess: ((event: Event) => void) | null = null;
      Promise.resolve().then(() => {
        pending.onerror?.(new Event("error"));
        onsuccess?.(new Event("success"));
      });
      return {
        get error() {
          return error;
        },
        get result() {
          return undefined;
        },
        get readyState() {
          return "pending";
        },
        set onerror(handler) {
          pending.onerror = handler;
        },
        get onerror() {
          return pending.onerror;
        },
        set onsuccess(handler) {
          onsuccess = handler;
        },
        get onsuccess() {
          return onsuccess;
        },
      };
    };
    indexedDB.open = ((name: string, version?: number) => {
      const request = realOpen(name, version);
      request.addEventListener("success", () => {
        const database = request.result;
        const realTransaction = database.transaction.bind(database);
        database.transaction = (
          stores: string | string[],
          mode?: IDBTransactionMode,
        ) => {
          const transaction = realTransaction(stores, mode);
          const realObjectStore = transaction.objectStore.bind(transaction);
          transaction.objectStore = (storeName: string) => {
            const objectStore = realObjectStore(storeName);
            if (storeName === "browser-recovery-v2") {
              const realPut = objectStore.put.bind(objectStore);
              objectStore.put = (value: unknown, key?: IDBValidKey) => {
                void value;
                void key;
                void realPut;
                return failingRequest(
                  new DOMException("simulated quota", "QuotaExceededError"),
                ) as unknown as IDBRequest<IDBValidKey>;
              };
            }
            return objectStore;
          };
          return transaction;
        };
      });
      return request;
    }) as IDBFactory["open"];
  });
  await page.goto("/editor");
  await placeResistor(page, 360, 230);
  await expect(page.getByTestId("revision")).toHaveText("1");

  await expect(page.getByTestId("recovery-state")).toHaveText(
    "Recovery full — download now",
  );
  const warning = page.getByTestId("recovery-failure-banner");
  await expect(warning).toBeVisible();
  await expect(warning).toContainText("full");

  // The editor keeps working and the warning stays.
  await placeResistor(page, 500, 230);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(warning).toBeVisible();

  const downloadPromise = page.waitForEvent("download");
  await warning.getByRole("button", { name: "Download Backup" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toContain(".icproj.json");
});

test("no Project data enters Cache Storage", async ({ page }) => {
  await page.goto("/editor");
  await placeResistor(page, 360, 230);
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  const polluted = await page.evaluate(async () => {
    if (typeof caches === "undefined") return false;
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const request of await cache.keys()) {
        const response = await cache.match(request);
        if (!response) continue;
        const text = await response.text();
        if (
          text.includes('"topDocumentId"') ||
          text.includes('"schemaVersion"')
        ) {
          return true;
        }
      }
    }
    return false;
  });
  expect(polluted).toBe(false);
});
