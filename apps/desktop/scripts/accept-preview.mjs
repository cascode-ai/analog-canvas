import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { _electron as electron, expect } from "@playwright/test";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { acceptProjectLibrary } from "./accept-project-library.mjs";
import { acceptAmplifier } from "./accept-amplifier.mjs";
import { spawn } from "node:child_process";

const root = resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
const dev = process.argv.includes("--development");
const manifest = dev
  ? null
  : JSON.parse(await readFile(join(root, "plan/preview-package.json"), "utf8"));
const output = join(root, "plan", `preview-acceptance-${Date.now()}`);
await mkdir(output, { recursive: true });
let running;
const errors = [];
const auditFiles = [];
const deliberateProbes = new Set();
async function launch(name, options = {}) {
  const audit = join(output, `${name}.jsonl`);
  auditFiles.push(audit);
  const env = {
    ...process.env,
    ICM_PREVIEW_USER_DATA: join(output, `${name}-data`),
    ICM_DESKTOP_PROJECTS: join(output, `${name}-projects`),
    ICM_PREVIEW_AUDIT: audit,
    ICM_PREVIEW_WAIT_FOR_DRIVER: "1",
    ...(options.legacyData
      ? { ICM_DESKTOP_LEGACY_DATA: options.legacyData }
      : {}),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  running = await electron.launch({
    executablePath: dev ? require("electron") : manifest.executable,
    args: [
      ...(dev ? [resolve(import.meta.dirname, "..")] : []),
      ...(options.args ?? []),
    ],
    env,
    timeout: 60000,
  });
  console.log(`Launched ${name}`);
  assert.equal(await running.evaluate(({ app }) => app.isPackaged), !dev);
  await expect
    .poll(() =>
      running.evaluate(
        () => typeof globalThis.__analogCanvasPreviewDriverReady,
      ),
    )
    .toBe("function");
  assert.equal(
    await running.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    0,
    "The renderer must wait until the acceptance driver has attached",
  );
  if (options.legacyData)
    await running.evaluate(({ dialog }) => {
      dialog.showMessageBox = async (options) => {
        assertMigrationDialog(options);
        return { response: 1, checkboxChecked: false };
      };
      function assertMigrationDialog(options) {
        if (!options.buttons.includes("Import previous data"))
          throw new Error("Expected the preview import prompt");
      }
    });
  await running.evaluate(() => globalThis.__analogCanvasPreviewDriverReady());
  const page = await running.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await expect(page.getByTestId("schematic-canvas")).toBeVisible({
    timeout: 60000,
  });
  console.log(`Ready ${name}`);
  const home = page.getByRole("dialog", {
    name: "Local projects",
    exact: true,
  });
  if (options.args?.includes("--open-project"))
    await expect(home).toHaveCount(0);
  else if (await home.count())
    await home.getByRole("button", { name: "Close", exact: true }).click();
  return page;
}
async function chooseExport(path) {
  await running.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = async () => ({
      canceled: path === null,
      filePath: path ?? "",
    });
  }, path);
}
async function exportProject(page, path) {
  await chooseExport(path);
  await page.keyboard.press("Escape");
  const menu = page
    .locator("details.command-menu")
    .filter({ has: page.getByTestId("project-menu-toggle") });
  if (!(await menu.evaluate((element) => element.open)))
    await menu.locator("summary").click();
  if (
    (await menu
      .getByRole("button", { name: "Export", exact: true })
      .getAttribute("aria-expanded")) !== "true"
  )
    await menu.getByRole("button", { name: "Export", exact: true }).click();
  await menu
    .getByRole("button", { name: "Export Project File…", exact: true })
    .click();
  await expect(page.getByText(/^Exported:/)).toBeVisible({ timeout: 20000 });
  return parseProject(await readFile(path, "utf8"));
}
async function closePreview() {
  const state = await running.evaluate(async ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].webContents.executeJavaScript(
      "window.__analogCanvasDesktop.state()",
    ),
  );
  if (!state.dirty.length && !state.pendingEdits && !state.busy) {
    const closed = running.waitForEvent("close");
    await running.evaluate(({ BrowserWindow, dialog }) => {
      dialog.showMessageBox = async () => {
        throw new Error("Clean workspace must not prompt");
      };
      BrowserWindow.getAllWindows()[0].close();
    });
    await closed;
    running = undefined;
    return;
  }
  await running.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showMessageBox = async (_window, options) => {
      if (options.defaultId !== 0 || options.cancelId !== 0)
        throw new Error("Close must default to Keep open");
      return { response: 0, checkboxChecked: false };
    };
    BrowserWindow.getAllWindows()[0].close();
  });
  await expect.poll(() => running.windows().length).toBe(1);
  const closed = running.waitForEvent("close");
  await running.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showMessageBox = async () => ({
      response: 1,
      checkboxChecked: false,
    });
    BrowserWindow.getAllWindows()[0].close();
  });
  await closed;
  running = undefined;
}
try {
  let first = await launch("first");
  assert.equal(await first.evaluate(() => typeof window.require), "undefined");
  assert.equal(
    await first.evaluate(() => navigator.serviceWorker.controller),
    null,
  );
  assert.deepEqual(
    await running.evaluate(({ session }) =>
      session.defaultSession.serviceWorkers.getAllRunning(),
    ),
    {},
  );
  for (const testId of [
    "open-agent",
    "open-analog-simulation",
    "publish-gallery-button",
    "examples-toggle",
    "statusbar-change-log",
    "statusbar-privacy",
  ])
    await expect(first.getByTestId(testId)).toHaveCount(0);
  for (const x of [160, 320, 480]) {
    await first
      .locator("summary")
      .filter({ hasText: /^Edit$/ })
      .click();
    await first
      .getByRole("button", { name: "Insert component… (I)", exact: true })
      .click();
    const picker = first.getByRole("dialog", {
      name: "Insert Component",
      exact: true,
    });
    await picker.getByLabel("Component search").fill("resistor");
    await picker.getByTestId("insert-component-resistor").click();
    await first
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 260 } });
    await first.keyboard.press("Escape");
  }
  await expect(first.getByTestId("instance-count")).toHaveText("3");
  await running.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error("First Save must automatically use the project library");
    };
  });
  // Lose a real committed response, then reload the renderer before retrying.
  // The working-copy identity must recover the same native creation.
  await first.evaluate(() => {
    const original = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await original(...args);
      if (String(args[0]).endsWith("/desktop/project/save")) {
        window.fetch = original;
        throw new Error("Acceptance: committed response lost");
      }
      return response;
    };
  });
  await first.keyboard.press("Control+s");
  await expect(
    first.getByText(/Save failed: Acceptance: committed response lost/),
  ).toBeVisible();
  const createdBeforeRetry = await readdir(join(output, "first-projects"));
  assert.equal(createdBeforeRetry.length, 1);
  // Exit without the close/save guard to model interruption after disk commit.
  // Reopen the real profile, with a new main process and renderer.
  const interrupted = running.waitForEvent("close");
  await running.evaluate(({ app }) => app.exit(0));
  await interrupted;
  running = undefined;
  first = await launch("first");
  await expect(first.getByTestId("instance-count")).toHaveText("3");
  await first.keyboard.press("Control+s");
  await expect(first.getByText(/^Saved:/)).toBeVisible();
  assert.deepEqual(
    await readdir(join(output, "first-projects")),
    createdBeforeRetry,
  );
  const firstBinding = await first
    .getByTestId("native-file-location")
    .getAttribute("title");
  assert(firstBinding.startsWith(join(output, "first-projects")));
  assert.equal(
    parseProject(await readFile(firstBinding, "utf8")).documents[0].instances
      .length,
    3,
  );
  await fileCommand(first, "Save As…");
  await first
    .getByRole("dialog", { name: "Save independent project" })
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  assert.equal(
    await first.getByTestId("native-file-location").getAttribute("title"),
    firstBinding,
  );
  await chooseExport(join(output, "does-not-exist", "failed.json"));
  await saveAsExternal(first);
  await expect(first.getByText(/^Save failed:/)).toBeVisible();
  const path = join(output, "roundtrip.icproj.json");
  const before = await exportProject(first, path);
  assert.equal(before.documents[0].instances.length, 3);
  for (const format of ["svg", "png", "pdf"]) {
    const artifact = join(output, `drawing.${format}`);
    await chooseExport(artifact);
    const menu = first
      .locator("details.command-menu")
      .filter({ has: first.getByTestId("project-menu-toggle") });
    if (!(await menu.evaluate((element) => element.open)))
      await menu.locator("summary").click();
    if (
      (await menu
        .getByRole("button", { name: "Export", exact: true })
        .getAttribute("aria-expanded")) !== "true"
    )
      await menu.getByRole("button", { name: "Export", exact: true }).click();
    await menu
      .getByRole("button", {
        name: `Export ${format.toUpperCase()}`,
        exact: true,
      })
      .click();
    await expect
      .poll(
        async () => {
          try {
            return (await readFile(artifact)).length;
          } catch {
            return 0;
          }
        },
        { timeout: 30000 },
      )
      .toBeGreaterThan(0);
    const bytes = await readFile(artifact);
    if (format === "svg") assert.match(bytes.toString("utf8"), /<svg/u);
    if (format === "png") assert.equal(bytes.subarray(1, 4).toString(), "PNG");
    if (format === "pdf")
      assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  }
  await first.screenshot({ path: join(output, "first-export.png") });
  await closePreview();

  // A separate profile cannot recover the first run's browser-local snapshot.
  const second = await launch("second");
  await expect(second.getByTestId("instance-count")).toHaveText("0");
  await second.getByTestId("tab-project-file").setInputFiles(path);
  await expect(second.getByTestId("instance-count")).toHaveText("3");
  const after = await exportProject(
    second,
    join(output, "roundtrip-again.icproj.json"),
  );
  assert.equal(serializeProject(after), serializeProject(before));
  await second.screenshot({ path: join(output, "reopened.png") });
  await closePreview();
  const recovered = await launch("first");
  await expect(recovered.getByTestId("instance-count")).toHaveText("3");
  await expect(recovered.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    firstBinding,
  );
  const recovery = await exportProject(
    recovered,
    join(output, "recovery.icproj.json"),
  );
  assert.equal(serializeProject(recovery), serializeProject(before));
  let received = 0;
  const sentinel = createServer((_request, response) => {
    received++;
    response.end("reachable");
  });
  await new Promise((resolve) => sentinel.listen(0, "127.0.0.1", resolve));
  const probe = `http://127.0.0.1:${sentinel.address().port}/isolation-probe`;
  deliberateProbes.add(probe);
  try {
    assert.equal(await (await fetch(probe)).text(), "reachable");
    const blocked = await running.evaluate(async ({ net }, url) => {
      try {
        await net.fetch(url);
        return false;
      } catch {
        return true;
      }
    }, probe);
    assert.equal(
      blocked,
      true,
      "Shell must block even a request from Electron net.fetch",
    );
    assert.equal(
      received,
      1,
      "The test runner reaches the sentinel; the shell must not",
    );
  } finally {
    await new Promise((resolve) => sentinel.close(resolve));
  }
  // Online links are absent from the desktop UI. Exercise its independent
  // navigation guard with a deliberately injected link instead.
  await recovered.evaluate(() => {
    const link = document.createElement("a");
    link.href = "https://example.invalid/desktop-navigation-probe";
    link.target = "_blank";
    link.textContent = "External navigation probe";
    document.body.append(link);
  });
  const externalHelp = recovered.waitForEvent("dialog");
  const helpClick = recovered
    .getByRole("link", { name: "External navigation probe", exact: true })
    .click();
  const help = await externalHelp;
  assert.match(help.message(), /External links are unavailable/u);
  await help.accept();
  await helpClick;
  assert.equal(running.windows().length, 1);
  await closePreview();
  // Native persistence uses the same real executable and dialog boundary.
  const native = await launch("native");
  const nativeA = join(output, "native-A.icproj.json");
  const nativeB = join(output, "native-B.icproj.json");
  const nativeCopy = join(output, "native-copy.icproj.json");
  await cp(path, nativeA);
  async function fileCommand(page, name) {
    await page.keyboard.press("Escape");
    const menu = page
      .locator("details.command-menu")
      .filter({ has: page.getByTestId("project-menu-toggle") });
    if (!(await menu.evaluate((element) => element.open)))
      await menu.locator("summary").click();
    await menu.getByRole("button", { name, exact: true }).click();
  }
  async function saveAsExternal(page) {
    await fileCommand(page, "Save As…");
    const dialog = page.getByRole("dialog", {
      name: "Save independent project",
    });
    await dialog.getByLabel("Location").selectOption("external");
    await dialog
      .getByRole("button", { name: "Save copy", exact: true })
      .click();
  }
  async function renameProject(page, name) {
    await page.keyboard.press("Escape");
    await page.getByRole("tab", { selected: true }).dblclick();
    const field = page.getByRole("textbox", {
      name: "Project name",
      exact: true,
    });
    await field.fill(name);
    await field.press("Enter");
    await expect(field).toBeHidden();
  }
  await running.evaluate(({ dialog }, path) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [path],
    });
  }, nativeA);
  await fileCommand(native, "Open Project…");
  await expect(native.getByTestId("instance-count")).toHaveText("3");
  await renameProject(native, "Native A");
  await running.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error("Bound Save must not open a dialog");
    };
  });
  await native.keyboard.press("Control+s");
  await expect
    .poll(async () => parseProject(await readFile(nativeA, "utf8")).name)
    .toBe("Native A");
  await renameProject(native, "Native A again");
  await native.keyboard.press("Control+s");
  await expect
    .poll(async () => parseProject(await readFile(nativeA, "utf8")).name)
    .toBe("Native A again");
  await fileCommand(native, "Local projects…");
  const externalManager = native.getByRole("dialog", {
    name: "Local projects",
    exact: true,
  });
  await externalManager
    .getByRole("region", { name: "Recently opened files" })
    .locator("article")
    .filter({ hasText: "Native A again" })
    .getByRole("button", { name: "History", exact: true })
    .click();
  await expect(externalManager.getByLabel("Saved version")).toBeVisible();
  await externalManager
    .getByRole("button", { name: "Close", exact: true })
    .click();
  await chooseExport(null);
  await saveAsExternal(native);
  await expect(
    native.getByText("Save cancelled", { exact: true }),
  ).toBeVisible();
  await expect(native.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    nativeA,
  );
  await running.evaluate(({ dialog }) => {
    dialog.showSaveDialog = () =>
      new Promise((resolve) => {
        globalThis.__finishPendingSave = resolve;
      });
  });
  await saveAsExternal(native);
  await expect
    .poll(() => running.evaluate(() => typeof globalThis.__finishPendingSave))
    .toBe("function");
  await fileCommand(native, "Project Info");
  const pendingInfo = native.getByRole("dialog", {
    name: "Project Info",
    exact: true,
  });
  const pendingName = pendingInfo.getByRole("textbox", {
    name: "Name",
    exact: true,
  });
  await pendingName.fill("Edited during Save As");
  await pendingName.press("Enter");
  await expect(pendingInfo).toBeHidden();
  await running.evaluate((_electron, destination) => {
    globalThis.__finishPendingSave({ canceled: false, filePath: destination });
    delete globalThis.__finishPendingSave;
  }, nativeB);
  await expect(native.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    nativeB,
  );
  await expect(native.getByTestId("project-name")).toHaveText(
    "Edited during Save As",
  );
  await expect(
    native.getByRole("tab", { selected: true }).getByLabel("Unsaved"),
  ).toBeVisible();
  assert.equal(
    parseProject(await readFile(nativeB, "utf8")).name,
    "Native A again",
  );
  assert.notEqual(
    parseProject(await readFile(nativeA, "utf8")).id,
    parseProject(await readFile(nativeB, "utf8")).id,
  );
  await exportProject(native, nativeCopy);
  await expect(native.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    nativeB,
  );
  await renameProject(native, "Native B");
  await running.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error("Export must not rebind Save");
    };
  });
  await native.keyboard.press("Control+s");
  await expect
    .poll(async () => parseProject(await readFile(nativeB, "utf8")).name)
    .toBe("Native B");
  assert.equal(
    parseProject(await readFile(nativeA, "utf8")).name,
    "Native A again",
  );
  // Two open files retain independent destinations; reopening selects the tab.
  await fileCommand(native, "Open Project…");
  await expect(native.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    nativeA,
  );
  await renameProject(native, "Independent A");
  await native.keyboard.press("Control+s");
  await expect
    .poll(async () => parseProject(await readFile(nativeA, "utf8")).name)
    .toBe("Independent A");
  await native.getByRole("tab", { name: "Native B", exact: true }).click();
  await expect(native.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    nativeB,
  );
  const tabCount = await native.getByRole("tab").count();
  await fileCommand(native, "Open Project…");
  await expect(native.getByRole("tab")).toHaveCount(tabCount);
  await expect(native.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    nativeA,
  );
  // A late external write must survive Save, including through the UI wiring.
  const external = parseProject(await readFile(nativeA, "utf8"));
  external.name = "External edit";
  await writeFile(nativeA, serializeProject(external));
  await renameProject(native, "Unsaved local edit");
  await native.keyboard.press("Control+s");
  await expect(
    native.getByText(/Save failed: File changed outside the editor/),
  ).toBeVisible();
  assert.equal(
    parseProject(await readFile(nativeA, "utf8")).name,
    "External edit",
  );
  await native.screenshot({ path: join(output, "native-files.png") });
  await closePreview();
  const restarted = await launch("native");
  const fileMenu = restarted.locator("details.command-menu").filter({
    has: restarted.getByTestId("project-menu-toggle"),
  });
  await fileMenu.locator("summary").click();
  await expect(
    fileMenu.getByRole("button").filter({ hasText: "native-B.icproj.json" }),
  ).toHaveCount(1);
  await fileMenu
    .getByRole("button")
    .filter({ hasText: "native-B.icproj.json" })
    .click();
  await expect(restarted.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    nativeB,
  );
  await expect(restarted.getByTestId("instance-count")).toHaveText("3");
  await renameProject(restarted, "Native B restarted");
  await running.evaluate(({ dialog }) => {
    dialog.showSaveDialog = async () => {
      throw new Error("Reopened recent Project must remain bound");
    };
  });
  await restarted.keyboard.press("Control+s");
  await expect
    .poll(async () => parseProject(await readFile(nativeB, "utf8")).name)
    .toBe("Native B restarted");
  // A background dirty tab must be included in Save all and close.
  await renameProject(restarted, "Background saved on close");
  await restarted
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(restarted.getByTestId("instance-count")).toHaveText("0");
  const savedClose = running.waitForEvent("close");
  await running.evaluate(({ BrowserWindow, dialog }) => {
    dialog.showMessageBox = async (_window, options) => {
      if (!options.buttons.includes("Save all and close"))
        throw new Error(`Unexpected close failure: ${options.detail}`);
      return { response: 2, checkboxChecked: false };
    };
    BrowserWindow.getAllWindows()[0].close();
  });
  await savedClose;
  running = undefined;
  assert.equal(
    parseProject(await readFile(nativeB, "utf8")).name,
    "Background saved on close",
  );
  const libraryPage = await launch("library");
  await acceptProjectLibrary({
    page: libraryPage,
    running,
    source: path,
    fileCommand,
    screenshot: join(output, "project-library.png"),
  });
  await closePreview();
  const amplifier = await launch("amplifier");
  await acceptAmplifier({
    page: amplifier,
    root,
    output,
    chooseExport,
    exportProject,
  });
  await closePreview();
  const associatedFile = join(output, "放大器.icproj");
  await cp(join(output, "native-ota.icproj.json"), associatedFile);
  const cold = await launch("os-open", {
    args: ["--open-project", associatedFile],
  });
  await expect(cold.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    associatedFile,
  );
  await expect(cold.getByTestId("instance-count")).toHaveText("23");
  await cold.getByRole("button", { name: "About", exact: true }).click();
  const about = cold.getByRole("dialog", {
    name: "About Analog Canvas",
    exact: true,
  });
  await expect(about.getByText(/Project format/)).toBeVisible();
  await cold.screenshot({ path: join(output, "desktop-about.png") });
  await about.getByRole("button", { name: "Close", exact: true }).click();
  const warmFile = join(output, "Second project.icproj");
  await cp(nativeB, warmFile);
  const warmEnv = {
    ...process.env,
    ICM_PREVIEW_USER_DATA: join(output, "os-open-data"),
    ICM_DESKTOP_PROJECTS: join(output, "os-open-projects"),
  };
  delete warmEnv.ELECTRON_RUN_AS_NODE;
  delete warmEnv.ICM_PREVIEW_WAIT_FOR_DRIVER;
  await new Promise((done, reject) => {
    const second = spawn(
      dev ? require("electron") : manifest.executable,
      [
        ...(dev ? [resolve(import.meta.dirname, "..")] : []),
        "--open-project",
        warmFile,
      ],
      { env: warmEnv, windowsHide: true, stdio: "ignore" },
    );
    second.once("error", reject);
    second.once("exit", (code) =>
      code === 0
        ? done()
        : reject(new Error(`Second instance exited with ${code}`)),
    );
  });
  await expect(cold.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    warmFile,
  );
  await expect(cold.getByTestId("instance-count")).toHaveText("3");
  assert.equal(
    await running.evaluate(
      ({ BrowserWindow }) => BrowserWindow.getAllWindows().length,
    ),
    1,
  );
  await closePreview();
  const migrated = await launch("migrated", {
    legacyData: join(output, "os-open-data"),
  });
  await expect(migrated.getByTestId("native-file-location")).toHaveAttribute(
    "title",
    warmFile,
  );
  await expect(migrated.getByTestId("instance-count")).toHaveText("3");
  assert.equal(
    JSON.parse(
      await readFile(
        join(output, "migrated-data", "preview-migration.json"),
        "utf8",
      ),
    ).source,
    join(output, "os-open-data"),
  );
  await closePreview();
  const embedded = await launch("embedded");
  const legacyPath = join(root, "netlists/native-ota/source.icproj.json");
  const legacy = parseProject(await readFile(legacyPath, "utf8"));
  await embedded.getByTestId("tab-project-file").setInputFiles(legacyPath);
  await expect(embedded.getByTestId("instance-count")).not.toHaveText("0");
  const legacyExchange = await exportProject(
    embedded,
    join(output, "embedded-roundtrip.icproj.json"),
  );
  assert.equal(legacy.componentDefinitions.length, 8);
  assert.deepEqual(
    legacyExchange.componentDefinitions,
    legacy.componentDefinitions,
  );
  assert.deepEqual(legacyExchange.source, legacy.source);
  assert.deepEqual(
    legacyExchange.externalSubcircuitDefinitions,
    legacy.externalSubcircuitDefinitions,
  );
  await closePreview();
  for (const audit of auditFiles) {
    const requests = (await readFile(audit, "utf8"))
      .trim()
      .split("\n")
      .map(JSON.parse);
    assert(requests.length > 0, "Audit must observe startup");
    const forbidden = requests.filter(
      ({ url }) =>
        !deliberateProbes.has(url) &&
        (/^(?:https?|wss?|file):/i.test(url) || url.includes("/api/")),
    );
    assert.deepEqual(
      forbidden,
      [],
      "Normal workflow must not attempt online requests",
    );
  }
  assert.deepEqual(errors, [], "No renderer/console errors");
  await writeFile(
    join(output, "result.json"),
    JSON.stringify(
      {
        status: "passed",
        packaged: !dev,
        source: manifest?.commit,
        checks: [
          "driver-attaches-before-renderer",
          "draw",
          "cancel",
          "first-save-without-dialog",
          "lost-creation-response-reload-reuses-destination",
          "save-as-retains-edits-made-during-native-save",
          "external-file-history-visible-in-project-manager",
          "save-as-cancel-preserves-binding",
          "recovery-relaunch",
          "write-failure",
          "real-export",
          "svg-png-pdf",
          "keep-open",
          "close",
          "fresh-profile-relaunch",
          "import",
          "canonical-equality",
          "no-online-requests",
          "shell-blocks-reachable-network",
          "external-help-feedback",
          "no-service-worker",
          "sandbox",
          "native-bound-save-without-dialog",
          "native-save-as-cancel-and-rebind",
          "export-does-not-rebind",
          "recent-project-relaunch",
          "independent-file-tabs-and-deduplication",
          "external-write-conflict-preserves-both-versions",
          "background-tab-save-on-close",
          "local-library-management-and-history",
          "native-ota-drawing-hierarchy-parameters-copy-undo",
          "native-ota-project-and-source-roundtrip",
          "native-ota-spice-spectre-files-and-svg-png-pdf",
          "short-path-labels-and-project-window-title",
          "os-file-open-cold-and-real-second-instance",
          "preview-profile-migration-and-file-rebinding",
          "legacy-embedded-components-roundtrip",
        ],
        output,
      },
      null,
      2,
    ),
  );
  if (manifest) {
    await cp(
      join(output, "result.json"),
      join(manifest.output, "ACCEPTANCE.json"),
    );
    await cp(
      join(output, "reopened.png"),
      join(manifest.output, "preview.png"),
    );
  }
  console.log(`PASS: ${output}`);
} catch (error) {
  if (running) {
    const page = running.windows()[0];
    if (page) {
      console.error(
        "Acceptance status:",
        await page
          .getByTestId("status")
          .textContent()
          .catch(() => "unavailable"),
      );
      await page
        .screenshot({ path: join(output, "failure.png") })
        .catch(() => {});
    }
  }
  throw error;
} finally {
  if (running) {
    await running.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
}
