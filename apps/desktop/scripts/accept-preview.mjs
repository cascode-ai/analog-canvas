import assert from "node:assert/strict";
import { createServer } from "node:http";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createRequire } from "node:module";
import { _electron as electron, expect } from "@playwright/test";
import { parseProject, serializeProject } from "@icm/project-protocol";

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
async function launch(name) {
  const audit = join(output, `${name}.jsonl`);
  auditFiles.push(audit);
  const env = {
    ...process.env,
    ICM_PREVIEW_USER_DATA: join(output, `${name}-data`),
    ICM_PREVIEW_AUDIT: audit,
  };
  delete env.ELECTRON_RUN_AS_NODE;
  running = await electron.launch({
    executablePath: dev ? require("electron") : manifest.executable,
    args: dev ? [resolve(import.meta.dirname, "..")] : [],
    env,
    timeout: 60000,
  });
  console.log(`Launched ${name}`);
  assert.equal(await running.evaluate(({ app }) => app.isPackaged), !dev);
  const page = await running.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await expect(page.getByTestId("schematic-canvas")).toBeVisible({
    timeout: 60000,
  });
  console.log(`Ready ${name}`);
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
  await page.keyboard.press("Control+s");
  await expect(page.getByText(/^Exported:/)).toBeVisible({ timeout: 20000 });
  return parseProject(await readFile(path, "utf8"));
}
async function closePreview() {
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
  const first = await launch("first");
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
  await chooseExport(null);
  await first.keyboard.press("Control+s");
  await expect(
    first.getByText("Export cancelled", { exact: true }),
  ).toBeVisible();
  await first
    .locator("summary")
    .filter({ hasText: /^File$/ })
    .click();
  await first.getByRole("button", { name: "New Project", exact: true }).click();
  const replaceGuard = first.getByRole("dialog", {
    name: "Unsaved changes",
    exact: true,
  });
  await expect(replaceGuard).toBeVisible();
  await replaceGuard
    .getByRole("button", { name: "Export and continue", exact: true })
    .click();
  await expect(
    replaceGuard.getByRole("button", {
      name: "Export and continue",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(first.getByTestId("instance-count")).toHaveText("3");
  await replaceGuard.getByRole("button", { name: "Stay", exact: true }).click();
  await chooseExport(join(output, "does-not-exist", "failed.json"));
  await first.keyboard.press("Control+s");
  await expect(first.getByText(/^Export failed:/)).toBeVisible();
  const path = join(output, "roundtrip.icproj.json");
  const before = await exportProject(first, path);
  assert.equal(before.documents[0].instances.length, 3);
  for (const format of ["svg", "png", "pdf"]) {
    const artifact = join(output, `drawing.${format}`);
    await chooseExport(artifact);
    const menu = first
      .locator("details.command-menu")
      .filter({ has: first.locator("summary").filter({ hasText: /^File$/ }) });
    await menu.locator("summary").click();
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
  await recovered
    .locator("summary")
    .filter({ hasText: /^File$/ })
    .click();
  await recovered
    .getByRole("button", { name: "Recover Unsaved Work…", exact: true })
    .click();
  const recoveryDialog = recovered.getByRole("dialog", {
    name: "Recover recent work",
    exact: true,
  });
  await recoveryDialog
    .getByRole("button", { name: "Restore New Circuit", exact: true })
    .first()
    .click();
  await expect(recovered.getByTestId("instance-count")).toHaveText("3");
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
  const externalHelp = recovered.waitForEvent("dialog");
  const helpClick = recovered
    .getByRole("link", { name: "Change Log", exact: true })
    .click();
  const help = await externalHelp;
  assert.match(help.message(), /External links are unavailable/u);
  await help.accept();
  await helpClick;
  assert.equal(running.windows().length, 1);
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
          "draw",
          "cancel",
          "replacement-cancel-preserves-work",
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
} finally {
  if (running) {
    await running.evaluate(({ app }) => app.exit(0)).catch(() => {});
  }
}
