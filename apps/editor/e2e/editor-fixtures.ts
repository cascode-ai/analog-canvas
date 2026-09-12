import { expect, type Locator, type Page } from "@playwright/test";

/** Wait until the route-split editor shell is ready to receive shortcuts. */
export async function awaitEditorReady(page: Page): Promise<void> {
  await page.getByTestId("schematic-canvas").waitFor();
}

/** Wait for the recovery coordinator to finish creating its owned IDB store. */
export async function awaitRecoveryStoreReady(page: Page): Promise<void> {
  await page.waitForFunction(async () => {
    const databases = await indexedDB.databases();
    if (
      !databases.some((database) => database.name === "analog-canvas-recovery")
    ) {
      return false;
    }
    return new Promise<boolean>((resolve) => {
      const request = indexedDB.open("analog-canvas-recovery");
      request.onerror = () => resolve(false);
      request.onsuccess = () => {
        const database = request.result;
        const ready = database.objectStoreNames.contains("browser-recovery-v2");
        database.close();
        resolve(ready);
      };
    });
  });
}

export async function openMenu(page: Page, name: string): Promise<Locator> {
  const summary = page.locator("summary", { hasText: name }).filter({
    hasText: new RegExp(`^${name}$`, "u"),
  });
  const details = summary.locator("..");
  if ((await details.getAttribute("open")) === null) await summary.click();
  return details;
}

export async function clickCommand(
  page: Page,
  menu: string,
  button: string,
): Promise<void> {
  const details = await openMenu(page, menu);
  if (
    menu === "File" &&
    /^Export (?:SVG|PNG|PDF|SPICE netlist|Spectre netlist)$/u.test(button)
  ) {
    const group = details.getByRole("button", {
      name: button.endsWith("netlist") ? "Export netlist" : "Export drawing",
      exact: true,
    });
    if ((await group.getAttribute("aria-expanded")) !== "true")
      await group.click();
  }
  await details.getByRole("button", { name: button, exact: true }).click();
}

/** Run one workflow command from the Netlist menu. */
export async function clickNetlistWorkflowCommand(
  page: Page,
  command: "open-analog-simulation" | "check-and-save",
): Promise<void> {
  if (command === "open-analog-simulation") {
    await page.getByTestId(command).click();
    return;
  }
  const details = await openMenu(page, "Netlist");
  await details.getByTestId(command).click();
}

export type DrawTool =
  | "insert"
  | "wire"
  | "text"
  | "arrow"
  | "line"
  | "rectangle"
  | "circle"
  | "document-style";

/** Activate one tool from the always-visible drawing toolbar. */
export async function clickDrawTool(page: Page, tool: DrawTool): Promise<void> {
  await page.getByTestId(`draw-tool-${tool}`).click();
}

export async function chooseComponent(
  page: Page,
  symbolId: string,
): Promise<void> {
  // Route-level code splitting means `page.goto()` can resolve before the
  // editor bundle has mounted. Clicking the toolbar both waits for the editor
  // shell and avoids dropping a shortcut during that loading window.
  await clickDrawTool(page, "insert");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill(symbolId);
  // Clicking a tile starts placement immediately; the quick-pick grid has no
  // separate Apply step.
  await dialog.getByTestId(`insert-component-${symbolId}`).click();
}

/** Edit the selected component's strict JSON; valid changes update live. */
export async function editComponentPropertyCode(
  page: Page,
  update: (value: Record<string, any>) => void,
): Promise<void> {
  const input = page.getByLabel("Editable Canvas property code");
  const value = JSON.parse(await readComponentPropertyCode(page)) as Record<
    string,
    any
  >;
  update(value);
  await input.fill(JSON.stringify(value, null, 2));
}

/** Read rendered JSON lines only; the inline controls/help are not source text. */
export async function readComponentPropertyCode(page: Page): Promise<string> {
  await expect(page.getByLabel("Editable Canvas property code")).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.getByRole("button", { name: "Copy JSON", exact: true }).click();
  await expect(
    page.getByText("JSON copied · hints and controls excluded", {
      exact: true,
    }),
  ).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

export async function setComponentParameter(
  page: Page,
  key: string,
  value: string,
): Promise<void> {
  await editComponentPropertyCode(page, (code) => {
    code.parameters[key] = value;
  });
}

export async function setComponentCodeField(
  page: Page,
  path: string,
  value: unknown,
): Promise<void> {
  await editComponentPropertyCode(page, (code) => {
    const parts = path.split(".");
    const key = parts.pop()!;
    const target = parts.reduce((target, part) => (target[part] ??= {}), code);
    target[key] = value;
  });
}

export async function expectComponentCodeField(
  page: Page,
  path: string,
  expected: unknown,
): Promise<void> {
  await expect
    .poll(async () =>
      path
        .split(".")
        .reduce(
          (value, key) => value?.[key],
          JSON.parse(await readComponentPropertyCode(page)),
        ),
    )
    .toEqual(expected);
}

export async function downloadBytes(
  page: Page,
  menu: string,
  buttonName: string,
): Promise<Buffer> {
  const downloadPromise = page.waitForEvent("download");
  await clickCommand(page, menu, buttonName);
  const stream = await (await downloadPromise).createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export interface RecoveryRecordView {
  workingCopyId: string;
  generation: string;
  projectText: string;
}

/**
 * Read the editor's bounded browser recovery records straight from the
 * application's IndexedDB store (no service API exists on purpose).
 */
export async function readRecoveryRecords(
  page: Page,
): Promise<RecoveryRecordView[]> {
  return page.evaluate(
    () =>
      new Promise<
        Array<{
          workingCopyId: string;
          generation: string;
          projectText: string;
        }>
      >((resolve, reject) => {
        const request = indexedDB.open("analog-canvas-recovery");
        request.onerror = () =>
          reject(request.error ?? new Error("recovery db open failed"));
        request.onsuccess = () => {
          const database = request.result;
          if (!database.objectStoreNames.contains("browser-recovery-v2")) {
            resolve([]);
            database.close();
            return;
          }
          const transaction = database.transaction(
            "browser-recovery-v2",
            "readonly",
          );
          const getAll = transaction
            .objectStore("browser-recovery-v2")
            .getAll();
          getAll.onsuccess = () => {
            resolve(
              (getAll.result as Array<Record<string, unknown>>).map(
                (record) => ({
                  workingCopyId: String(record.workingCopyId),
                  generation: String(record.generation),
                  projectText: String(record.projectText ?? ""),
                }),
              ),
            );
            database.close();
          };
          getAll.onerror = () =>
            reject(getAll.error ?? new Error("recovery store read failed"));
        };
      }),
  );
}

export async function recoveryProjectTexts(page: Page): Promise<string> {
  const records = await readRecoveryRecords(page);
  return records.map((record) => record.projectText).join("\n");
}
