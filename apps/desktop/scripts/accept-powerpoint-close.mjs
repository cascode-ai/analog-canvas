// Runs the packaged renderer/host; only the external PPT receipt is simulated.
import { _electron as electron, expect } from "@playwright/test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

const [executablePath, fixturePath, receiverPath] = process.argv.slice(2);
const development = process.argv.includes("--development");
if (!executablePath || !fixturePath || !receiverPath)
  throw new Error(
    "Usage: node accept-powerpoint-close.mjs <packaged-exe> <project.icproj.json> <VerifyCancellation.exe>",
  );
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const documentId = fixture.documents.at(-1).id;
const report = [];

for (const mode of [
  "button",
  "close",
  "background",
  "rejected",
  "newer-edit",
  "duplicate",
  "cancel-pending",
  "cancel-in-flight",
]) {
  const directory = await mkdtemp(join(tmpdir(), "circuit-close-"));
  console.log(`Starting ${mode}: ${directory}`);
  await writeFile(
    join(directory, "session.json"),
    JSON.stringify({ token: "test", documentId, cancellationProtocol: 1 }),
  );
  await writeFile(join(directory, "drawing.icproj"), JSON.stringify(fixture));
  const env = {
    ...process.env,
    CIRCUIT_PPT_SESSION: directory,
    ICM_PREVIEW_USER_DATA: join(directory, "profile"),
    ICM_DESKTOP_PROJECTS: join(directory, "projects"),
    CIRCUIT_PPT_COMPONENTS: join(directory, "components.json"),
    ICM_PREVIEW_WAIT_FOR_DRIVER: "1",
  };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: resolve(executablePath),
    args: [
      ...(development ? [resolve(import.meta.dirname, "..")] : []),
      "--open-project",
      join(directory, "drawing.icproj"),
    ],
    env,
    timeout: 60000,
  });
  try {
    await expect
      .poll(() =>
        app.evaluate(() => typeof globalThis.__analogCanvasPreviewDriverReady),
      )
      .toBe("function");
    await app.evaluate(({ dialog }) => {
      globalThis.closeMessages = [];
      dialog.showMessageBox = async (_window, options) => {
        globalThis.closeMessages.push(options);
        return {
          response: options.buttons.includes("Save to PowerPoint and close")
            ? 2
            : 0,
        };
      };
      globalThis.__analogCanvasPreviewDriverReady();
    });
    const page = await app.firstWindow();
    await expect(
      page.getByRole("button", { name: "Save to PowerPoint", exact: true }),
    ).toBeEnabled({ timeout: 60000 });
    async function rename(name) {
      await page.getByRole("tab", { selected: true }).dblclick();
      const field = page.getByRole("textbox", {
        name: "Project name",
        exact: true,
      });
      await field.fill(name);
      await field.press("Enter");
      await expect(field).toBeHidden();
    }
    await rename(`Close test ${mode}`);
    await expect
      .poll(() =>
        page.evaluate(
          () => window.__analogCanvasDesktop.state().dirty.length > 0,
        ),
      )
      .toBe(true);
    if (mode === "duplicate") {
      const copy = join(directory, "duplicate.icproj");
      await writeFile(
        copy,
        JSON.stringify({ ...fixture, name: "Duplicate circuit" }),
      );
      await app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [path],
        });
      }, copy);
      const menu = page
        .locator("details.command-menu")
        .filter({ has: page.getByTestId("project-menu-toggle") });
      await menu.locator("summary").click();
      await menu
        .getByRole("button", { name: "Open Project…", exact: true })
        .click();
      await expect(
        page.getByRole("tab", { name: "Duplicate circuit", exact: true }),
      ).toHaveAttribute("aria-selected", "true");
      await page
        .getByRole("button", { name: "Save to PowerPoint", exact: true })
        .click();
      await expect(
        page.getByRole("status").filter({ hasText: "duplicate copies" }),
      ).toBeVisible();
      await assert.rejects(readFile(join(directory, "result.json")), {
        code: "ENOENT",
      });
      report.push({ mode, passed: true, directory });
      console.log(`${mode}: passed`);
      continue;
    }
    if (mode === "background")
      await page.getByRole("tab", { name: "New Circuit", exact: true }).click();
    if (
      mode === "button" ||
      mode === "newer-edit" ||
      mode.startsWith("cancel-")
    ) {
      await page
        .getByRole("button", { name: "Save to PowerPoint", exact: true })
        .click();
    } else {
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].close(),
      );
    }
    let result;
    await expect
      .poll(
        async () => {
          try {
            result = JSON.parse(
              await readFile(join(directory, "result.json"), "utf8"),
            );
            return result.sequence;
          } catch {
            return null;
          }
        },
        { timeout: 15000 },
      )
      .toBe(1);
    assert.equal(JSON.parse(result.project).name, `Close test ${mode}`);
    assert.equal(result.documentId, documentId);
    assert.ok(result.svg.includes("<svg"));
    assert.equal(page.isClosed(), false, "Must wait for a PPT receipt");
    if (mode.startsWith("cancel-")) {
      // Withhold the external Office receipt until the real renderer times out.
      await expect(
        page
          .getByRole("status")
          .filter({ hasText: "PowerPoint has not acknowledged" }),
      ).toBeVisible({ timeout: 45000 });
      await writeFile(join(directory, "applied.json"), "original drawing");
      let consumer;
      try {
        if (mode === "cancel-in-flight") {
          await writeFile(
            join(directory, "block-apply"),
            "hold after reading, before applying",
          );
          consumer = spawn(resolve(receiverPath), [directory], {
            windowsHide: true,
            stdio: "ignore",
          });
          await expect
            .poll(async () =>
              readFile(join(directory, "receiver-ready"), "utf8").catch(
                () => "",
              ),
            )
            .not.toBe("");
        }
        await app.evaluate(({ BrowserWindow, dialog }) => {
          dialog.showMessageBox = async (_w, options) => {
            globalThis.closeMessages.push(options);
            return {
              response: options.buttons.includes(
                "Close without updating PowerPoint",
              )
                ? 1
                : 0,
            };
          };
          BrowserWindow.getAllWindows()[0].close();
        });
        if (consumer) {
          await expect
            .poll(() =>
              app.evaluate(() =>
                globalThis.closeMessages.some((m) =>
                  m.detail?.includes("outcome is unknown"),
                ),
              ),
            )
            .toBe(true);
          assert.equal(
            page.isClosed(),
            false,
            "An in-flight apply cannot be reported as cancelled",
          );
          await assert.rejects(readFile(join(directory, "cancel.json")), {
            code: "ENOENT",
          });
          await unlink(join(directory, "block-apply"));
          await expect
            .poll(async () =>
              JSON.parse(
                await readFile(join(directory, "ack.json"), "utf8").catch(
                  () => "{}",
                ),
              ),
            )
            .toMatchObject({ sequence: 1, ok: true });
          await app.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0].close(),
          );
        }
        await expect.poll(() => page.isClosed()).toBe(true);
        assert.equal(
          JSON.parse(await readFile(join(directory, "cancel.json"), "utf8"))
            .throughSequence,
          1,
        );
        const received = spawnSync(resolve(receiverPath), [directory], {
          windowsHide: true,
          encoding: "utf8",
          timeout: 10000,
        });
        assert.equal(received.status, 0, received.stderr);
        assert.equal(
          await readFile(join(directory, "applied.json"), "utf8"),
          consumer ? result.project : "original drawing",
          "Releasing Office after cancellation must not apply the pending result",
        );
        assert.equal(
          JSON.parse(await readFile(join(directory, "revision-1.json"), "utf8"))
            .project,
          result.project,
        );
        report.push({ mode, passed: true, directory });
        console.log(`${mode}: passed`);
        continue;
      } finally {
        if (consumer && consumer.exitCode === null) consumer.kill();
      }
    }
    if (mode === "newer-edit") await rename("Edited while PPT was saving");
    const closed =
      mode === "close" || mode === "background"
        ? page.waitForEvent("close")
        : null;
    await writeFile(
      join(directory, "ack.json"),
      JSON.stringify({
        sequence: 1,
        ok: mode !== "rejected",
        error: mode === "rejected" ? "PPT unavailable" : undefined,
      }),
    );
    if (closed) {
      await closed;
    } else if (mode === "rejected") {
      await expect
        .poll(() =>
          app.evaluate(() =>
            globalThis.closeMessages.some(
              (m) => m.detail === "Error: PPT unavailable",
            ),
          ),
        )
        .toBe(true);
      assert.equal(page.isClosed(), false);
      assert.equal(
        await page.evaluate(
          () => window.__circuitPowerPoint.state().dirty.length > 0,
        ),
        true,
      );
    } else {
      await expect(
        page.getByRole("status").filter({ hasText: "Drawing updated" }),
      ).toBeVisible();
      if (mode === "button") {
        assert.equal(
          await page.evaluate(
            () => window.__circuitPowerPoint.state().dirty.length,
          ),
          0,
        );
        const closing = page.waitForEvent("close");
        // A successful button Save must close with no redundant dialog.
        await app.evaluate(({ BrowserWindow, dialog }) => {
          dialog.showMessageBox = async (_w, options) => {
            globalThis.closeMessages.push(options);
            return { response: 0 };
          };
          BrowserWindow.getAllWindows()[0].close();
        });
        try {
          await closing;
        } catch (error) {
          console.log(
            JSON.stringify(await app.evaluate(() => globalThis.closeMessages)),
          );
          console.log(
            JSON.stringify(
              await page.evaluate(() => ({
                ppt: window.__circuitPowerPoint.state(),
                native: window.__analogCanvasDesktop.state(),
              })),
            ),
          );
          throw error;
        }
      } else {
        assert.equal(
          await page.evaluate(
            () => window.__circuitPowerPoint.state().dirty.length > 0,
          ),
          true,
        );
        assert.equal(page.isClosed(), false);
      }
    }
    report.push({ mode, passed: true, directory });
    console.log(`${mode}: passed`);
  } finally {
    // Packaged Windows launchers may have a parent PID different from Electron's
    // main PID. The isolated session records the actual test process identity.
    const mainPid = Number(
      await readFile(join(directory, "editor.pid"), "utf8"),
    );
    if (
      process.platform === "win32" &&
      Number.isSafeInteger(mainPid) &&
      mainPid > 0
    )
      spawnSync("taskkill.exe", ["/PID", String(mainPid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    if (app.process().exitCode === null) {
      // Only this disposable test process: Node's attached inspector can keep
      // the process alive after the actual window-close assertion passed.
      app.process().kill();
    }
  }
}
console.log(JSON.stringify(report, null, 2));
// All assertions and disposable-process cleanup have completed. Explicitly
// release the acceptance driver's inspector transports on Windows.
process.exit(0);
