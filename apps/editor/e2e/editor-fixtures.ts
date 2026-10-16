import { readFileSync } from "node:fs";
import { parseProject } from "@icm/project-protocol";
import { expect, type Locator, type Page } from "@playwright/test";

/** Wait until the route-split editor shell is ready to receive shortcuts. */
export async function awaitEditorReady(page: Page): Promise<void> {
  await page.getByTestId("schematic-canvas").waitFor();
}

/** Let the page paint two frames, so a render and its effects settle. */
export async function awaitTwoFrames(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
}

/** Load the editor at this address and wait until it takes input. */
export async function openEditor(page: Page, path = "/editor"): Promise<void> {
  await page.goto(path);
  await awaitEditorReady(page);
}

/** A Project the editor ships among its examples. */
export function exampleProject(file: string) {
  return parseProject(
    readFileSync(new URL(`../src/examples/${file}`, import.meta.url), "utf8"),
  );
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

/**
 * Open one group of editor commands. The header has three menus: File (the
 * project and its file commands), Edit, and Circuit (Hierarchy and Netlist).
 */
export async function openMenu(page: Page, name: string): Promise<Locator> {
  const menuTestId =
    name === "File"
      ? "project-menu"
      : name === "Edit"
        ? "edit-menu"
        : "circuit-menu";
  const menu = page.getByTestId(menuTestId);
  if ((await menu.getAttribute("open")) === null)
    await menu.locator(":scope > summary").click();
  return menu.getByRole("group", { name, exact: true });
}

/** Open the Cell Manager from the header's menu and return the dialog. */
export async function openCellManager(page: Page): Promise<Locator> {
  await (
    await openMenu(page, "Hierarchy")
  )
    .getByTestId("hierarchy-entry")
    .click();
  return page.getByRole("dialog", { name: "Cell Manager", exact: true });
}

/** Open the Cell Manager on one of its tabs and return the dialog. */
export async function openCellManagerTab(
  page: Page,
  tab: string,
): Promise<Locator> {
  const manager = await openCellManager(page);
  await manager.getByRole("tab", { name: tab, exact: true }).click();
  return manager;
}

/** Assert that the status line reports this text. */
export async function expectStatus(
  page: Page,
  text: string | RegExp,
): Promise<void> {
  await expect(page.getByTestId("status")).toContainText(text);
}

/** Show the Live netlist panel if its toggle is off, and return the panel. */
export async function showNetlistPanel(page: Page): Promise<Locator> {
  const toggle = page.getByTestId("netlist-panel-toggle");
  if ((await toggle.getAttribute("aria-pressed")) !== "true")
    await toggle.click();
  return page.getByRole("region", { name: "Live netlist", exact: true });
}

export async function clickCommand(
  page: Page,
  menu: string,
  button: string,
): Promise<void> {
  const details = await openMenu(page, menu);
  if (
    menu === "File" &&
    /^Export (?:Project File…|SVG|PNG|PDF)$/u.test(button)
  ) {
    const group = details.getByRole("button", {
      name: "Export",
      exact: true,
    });
    if ((await group.getAttribute("aria-expanded")) !== "true")
      await group.click();
  }
  await details.getByRole("button", { name: button, exact: true }).click();
}

/** Read the current Cell and publication metadata from File → Project Info. */
export async function openProjectInfo(page: Page): Promise<Locator> {
  await clickCommand(page, "File", "Project Info");
  const dialog = page.getByRole("dialog", { name: "Project Info" });
  await expect(dialog).toBeVisible();
  return dialog;
}

/** Rename the active project in its tab, as a reader would. */
export async function renameProject(page: Page, name: string): Promise<void> {
  await page.getByRole("tab", { selected: true }).dblclick();
  const field = page.getByRole("textbox", {
    name: "Project name",
    exact: true,
  });
  await field.fill(name);
  await field.press("Enter");
  await expect(field).toBeHidden();
}

/** Rename a Shelf project with the Shelf's own Rename control. */
export async function renameShelfProject(
  page: Page,
  from: string,
  to: string,
): Promise<void> {
  await page.getByLabel("Open Shelf project in tab", { exact: true }).click();
  const shelf = page.locator(".project-tabs-shelf");
  await shelf.getByRole("button", { name: from, exact: true }).hover();
  await shelf
    .getByRole("button", { name: `Rename ${from}`, exact: true })
    .click();
  const field = shelf.getByRole("textbox", {
    name: "Shelf project name",
    exact: true,
  });
  await field.fill(to);
  await field.press("Enter");
  await expect(
    shelf.getByRole("button", { name: to, exact: true }),
  ).toBeVisible();
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
  const details = await openMenu(page, "File");
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
  const libraryToggle = page.getByRole("button", {
    name: "Component library",
    exact: true,
  });
  const chip = page.getByTestId(`shapes-chip-${symbolId}`);
  if ((await libraryToggle.getAttribute("aria-expanded")) !== "true") {
    await libraryToggle.click();
  }
  await expect(libraryToggle).toHaveAttribute("aria-expanded", "true");
  await expect(chip).toBeVisible();
  await chip.click();
}

/**
 * Place a free text note, leaving its editor open for the calling scenario.
 * Text is written first: the note is written, placed, then reopened.
 */
export async function placeText(
  page: Page,
  position = { x: 450, y: 340 },
): Promise<void> {
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position });
  await clickDrawTool(page, "text");
  const draft = page
    .getByTestId("text-draft-editor")
    .getByRole("textbox", { name: "Canvas text editor" });
  await expect(draft).toBeVisible();
  await draft.pressSequentially("Design note");
  await draft.press("Enter");
  await canvas.click({ position });
  await page
    .getByTestId(/^drafting-hit-note-/)
    .last()
    .dblclick();
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

/** Place one component at a canvas position, leaving no tool armed. */
export async function placeComponentAt(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
}

/** Place one resistor at each x on row y, leaving no tool armed. */
export async function placeResistors(
  page: Page,
  xs: number[],
  y = 230,
): Promise<void> {
  for (const x of xs) await placeComponentAt(page, "resistor", { x, y });
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

/** Edit the Document-wide Properties JSON and apply valid code live. */
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

/** Read the Properties JSON through its real copy command. */
export async function readDocumentStyleCode(page: Page): Promise<string> {
  const input = await documentStyleCodeEditor(page);
  await expect(input).toBeVisible();
  await page.context().grantPermissions(["clipboard-read", "clipboard-write"]);
  const settings = page.getByLabel("Document settings", { exact: true });
  await settings
    .getByRole("button", { name: "Copy Properties JSON", exact: true })
    .click();
  await expect(
    settings.getByText("Properties JSON copied", { exact: true }),
  ).toBeVisible();
  return page.evaluate(() => navigator.clipboard.readText());
}

async function documentStyleCodeEditor(page: Page): Promise<Locator> {
  const input = page.getByLabel("Editable Properties code", {
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

/** The bytes of the file that `action` makes the page download. */
export async function downloaded(
  page: Page,
  action: () => Promise<void>,
): Promise<Buffer> {
  const download = page.waitForEvent("download");
  await action();
  const chunks: Buffer[] = [];
  for await (const chunk of await (await download).createReadStream())
    chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function downloadBytes(
  page: Page,
  menu: string,
  buttonName: string,
): Promise<Buffer> {
  return downloaded(page, () => clickCommand(page, menu, buttonName));
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

/** Wait until a browser recovery copy holds this text. */
export async function expectRecovered(page: Page, text: string): Promise<void> {
  await expect.poll(() => recoveryProjectTexts(page)).toContain(text);
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
  await openMenu(page, "Netlist");
  await page.getByTestId("copy-netlist").click();
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

/** Decode a downloaded portable file before asserting editor-model behavior.
 * Format-specific tests inspect raw JSON themselves; other journeys should
 * not accidentally prescribe the storage layout. */
export function parseSavedProject(text: string): any {
  return parseProject(text);
}

/** Open a Project file (an object, its text or its bytes) as File > Open does. */
export async function openProjectFile(
  page: Page,
  project: object | string,
  name = "project.icproj.json",
): Promise<void> {
  await page.getByTestId("project-file").setInputFiles({
    name,
    mimeType: "application/json",
    buffer: Buffer.isBuffer(project)
      ? project
      : Buffer.from(
          typeof project === "string" ? project : JSON.stringify(project),
        ),
  });
}

/** The active Project as File > Export Project File… writes it. */
export async function exportedProject(page: Page): Promise<any> {
  return parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
}

/** Open the editor on a Project a test built. */
export async function openProject(
  page: Page,
  project: object | string,
  name?: string,
): Promise<void> {
  await openEditor(page);
  await openProjectFile(page, project, name);
}
