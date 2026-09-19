import { expect, type Locator, type Page } from "@playwright/test";

/** Wait until the route-split editor shell is ready to receive shortcuts. */
export async function awaitEditorReady(page: Page): Promise<void> {
  await page.getByTestId("schematic-canvas").waitFor();
}

/**
 * Give the canvas the whole workspace.
 *
 * The editor opens with the project dock showing, so a test that reaches for
 * document coordinates near the right edge — or for a floating window the
 * dock pushes over them — has to close it first, exactly as a reader would.
 */
export async function closeProjectTools(page: Page): Promise<void> {
  await awaitEditorReady(page);
  const dock = page.getByRole("complementary", { name: "Project tools" });
  if (!(await dock.isVisible())) return;
  // A panel is closed by the control that opened it. Netlist is the one the
  // editor starts in; Project Code is the other toolbar panel.
  for (const testId of ["netlist-panel-toggle", "project-code-toggle"]) {
    const toggle = page.getByTestId(testId);
    if ((await toggle.getAttribute("aria-pressed")) !== "true") continue;
    await toggle.click();
    break;
  }
  await page.locator(".app-workspace").evaluate(async (element) => {
    await Promise.all(
      element
        .getAnimations()
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
}

/** Enter the Properties workspace before interacting with its shelf. */
export async function revealPropertiesShelf(page: Page): Promise<void> {
  await closeProjectTools(page);
  await expect(page.getByTestId("selection-shelf")).toBeVisible();
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
  const summary =
    name === "Netlist"
      ? page.locator('summary[aria-label="Netlist"]')
      : page.locator("summary", { hasText: name }).filter({
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
  if (menu === "File" && /^Export (?:SVG|PNG|PDF)$/u.test(button)) {
    const group = details.getByRole("button", {
      name: "Export drawing",
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
  | "wire"
  | "text"
  | "arrow"
  | "line"
  | "rectangle"
  | "circle"
  | "document-style";

/** Activate a toolbar command or an annotation tool from the Library. */
export async function clickDrawTool(page: Page, tool: DrawTool): Promise<void> {
  const annotationTools: Partial<Record<DrawTool, string>> = {
    arrow: "annotation-arrow",
    line: "annotation-line",
    rectangle: "annotation-rectangle",
    circle: "annotation-circle",
  };
  const symbolId = annotationTools[tool];
  if (!symbolId) {
    await page.getByTestId(`draw-tool-${tool}`).click();
    return;
  }
  const libraryToggle = page.getByTestId("library-toggle");
  const chip = page.getByTestId(`shapes-chip-${symbolId}`);
  if ((await libraryToggle.getAttribute("aria-expanded")) !== "true") {
    await libraryToggle.click();
  }
  await expect(libraryToggle).toHaveAttribute("aria-expanded", "true");
  await expect(chip).toBeVisible();
  await chip.click();
}

/** Place a free text note, leaving its editor open for the calling scenario. */
export async function placeText(
  page: Page,
  position = { x: 450, y: 340 },
): Promise<void> {
  await clickDrawTool(page, "text");
  await page.getByTestId("schematic-canvas").click({ position });
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toBeVisible();
}

export async function chooseComponent(
  page: Page,
  symbolId: string,
): Promise<void> {
  // Route-level code splitting means `page.goto()` can resolve before the
  // editor bundle has mounted. Opening the Edit command also waits for the
  // editor shell and avoids dropping a shortcut during that loading window.
  await clickCommand(page, "Edit", "Insert component… (I)");
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
    page.getByText("JSON copied", {
      exact: true,
    }),
  ).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

/** Edit the Document-wide Style JSON and let the editor apply valid code live. */
export async function editDocumentStyleCode(
  page: Page,
  update: (value: Record<string, any>) => void,
): Promise<void> {
  const input = await documentStyleCodeEditor(page);
  const value = JSON.parse(await readDocumentStyleCode(page)) as Record<
    string,
    any
  >;
  update(value);
  await input.fill(JSON.stringify(value, null, 2));
}

/** Read the Style JSON through its real copy command. */
export async function readDocumentStyleCode(page: Page): Promise<string> {
  const input = await documentStyleCodeEditor(page);
  await expect(input).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const settings = page.getByLabel("Document settings", { exact: true });
  await settings
    .getByRole("button", { name: "Copy Style JSON", exact: true })
    .click();
  await expect(
    settings.getByText("Style JSON copied", { exact: true }),
  ).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function documentStyleCodeEditor(page: Page): Promise<Locator> {
  const input = page.getByLabel("Editable document Style code", {
    exact: true,
  });
  if (!(await input.isVisible())) await clickDrawTool(page, "document-style");
  await expect(input).toBeVisible();
  return input;
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

/** Copy through the real clipboard and prove its content matches the live sidebar. */
export async function copyNetlistText(
  page: Page,
  format?: "spice" | "spectre",
): Promise<string> {
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  let downloads = 0;
  const downloaded = () => {
    downloads += 1;
  };
  page.on("download", downloaded);
  await page.evaluate(() =>
    navigator.clipboard.writeText("clipboard sentinel"),
  );
  const panel = page.getByRole("region", {
    name: "Live netlist",
    exact: true,
  });
  const toggle = page.getByTestId("netlist-panel-toggle");
  if (
    (await toggle.getAttribute("aria-pressed")) !== "true" ||
    !(await panel.isVisible())
  )
    await toggle.click();
  await expect(panel).toBeVisible();
  if (format) await panel.getByLabel("Netlist format").selectOption(format);
  await panel.getByTestId("copy-netlist-panel").click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .not.toBe("clipboard sentinel");
  const text = await page.evaluate(() => navigator.clipboard.readText());
  // Windows normalizes clipboard lines to CRLF while textarea values retain
  // the application's LF spelling. The text contract is line-ending neutral.
  const normalizedText = text.replace(/\r\n?/gu, "\n");
  const firstSourceLine = normalizedText
    .split("\n")
    .find((line) => line.trim().length > 0);
  if (firstSourceLine)
    await expect(
      page.getByRole("textbox", { name: "Netlist code", exact: true }),
    ).toContainText(firstSourceLine);
  expect(downloads).toBe(0);
  page.off("download", downloaded);
  return normalizedText;
}
