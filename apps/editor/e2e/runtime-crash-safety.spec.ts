import { expect, test } from "@playwright/test";

import {
  awaitEditorReady,
  chooseComponent,
  expectStatus,
  openExternalCircuits,
  placeResistors,
  openEditor,
} from "./editor-fixtures.js";

/** The App module as the dev server serves it, or its chunk in the built editor. */
const APP_CHUNK = "**/{src/app/App.tsx,assets/App-*.js}*";

// These cases deliberately break and reload the shared editor origin. Keep
// them in one worker so cache cleanup and failed chunk requests cannot race.
test.describe.configure({ mode: "default" });

test("a render crash shows the recovery screen instead of a blank page", async ({
  page,
}) => {
  await openEditor(page);

  // Arm the DEV-only render crash probe and force one more App render.
  page.on("pageerror", (error) => console.log("PAGEERROR:", error.message));
  await page.evaluate(() => {
    window.__ICM_TEST_RENDER_CRASH__ = true;
  });
  await page.keyboard.press("i");

  const crashScreen = page.getByTestId("editor-crash-screen");
  await expect(crashScreen).toBeVisible();
  await expect(crashScreen).toContainText(
    "The editor hit an unexpected problem",
  );
  await expect(crashScreen).toContainText("render crashed (test hook)");
  const bugReportLink = crashScreen.getByTestId("crash-report-bug");
  await expect(bugReportLink).toBeVisible();
  await expect(bugReportLink).toHaveAttribute(
    "href",
    /^https:\/\/github\.com\/cascode-ai\/analog-canvas\/issues\/new\?/u,
  );
  // A blank issue: the crash text never leaves the page.
  const bugReportHref = await bugReportLink.getAttribute("href");
  expect(new URL(bugReportHref ?? "").searchParams.get("body")).toBeNull();

  // Reloading brings the editor back without the transient crash flag.
  await crashScreen.getByRole("button", { name: "Reload editor" }).click();
  await awaitEditorReady(page);
});

// A transient route chunk failure's diagnosis and single retry are
// route-chunk-loader's and EditorCrashScreen's; the case below reaches the
// same screen through the loader with a retired chunk.

/**
 * The recovery screen's own promise, tested end to end.
 *
 * #529 was reported twice by the same person. Everything shipped for it so
 * far made the failure honest — an accurate message, a correct diagnosis —
 * and none of it proved the way out actually works. The unit tests show the
 * button clears the shell caches and unregisters the worker; they cannot show
 * that the page boots afterwards, which is the only part the person cares
 * about.
 */
test("the recovery button gets a stuck page back into the editor", async ({
  page,
}) => {
  // A retired chunk: the shape that genuinely means "this document can no
  // longer boot", as distinct from a transient failure (route-chunk-loader).
  let chunkRetired = true;
  await page.route(APP_CHUNK, (route) => {
    if (chunkRetired) return route.fulfill({ status: 404, body: "" });
    return route.continue();
  });
  await page.goto("/editor");

  const crashScreen = page.getByTestId("editor-crash-screen");
  await expect(crashScreen).toBeVisible();
  const recover = crashScreen.getByTestId("crash-reload-clean");
  await expect(recover).toBeVisible();

  // A shell cache from the build that can no longer boot. Without this the
  // test would pass on an ordinary reload and prove nothing about the word
  // "clean", which is the half that gets a genuinely stuck page unstuck.
  await page.evaluate(async () => {
    const cache = await caches.open("icm-static-shell-stale-build");
    await cache.put("/stale-marker", new Response("stale"));
  });

  // Reloading with a clean copy is what a person does after a deploy has
  // finished, so the chunk it asks for exists again.
  chunkRetired = false;
  await recover.click();

  await awaitEditorReady(page);
  await expect(crashScreen).toHaveCount(0);
  // The build's cached shell is gone, not merely bypassed by the reload.
  expect(await page.evaluate(() => caches.keys())).not.toContain(
    "icm-static-shell-stale-build",
  );
});

test("a failed dialog chunk degrades to a scoped notice, not the crash screen", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeResistors(page, [360]);
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  // A tab that survives a redeploy asks for chunk names the server no longer
  // has. Aborting the request reproduces the same rejected dynamic import.
  await page.route("**/cell-manager-dialog*", (route) => route.abort());
  await openExternalCircuits(page);

  const fallback = page.getByTestId("dialog-chunk-load-fallback");
  await expect(fallback).toBeVisible();
  await expect(fallback).toContainText("This dialog could not be loaded");
  await expect(page.getByTestId("editor-crash-screen")).toHaveCount(0);

  // Closing the notice hands the intact editor back.
  await fallback.getByRole("button", { name: "Close" }).click();
  await expect(fallback).toHaveCount(0);
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  // Refreshing from the notice restores the circuit automatically.
  await openExternalCircuits(page);
  const navigated = page.waitForEvent("framenavigated");
  await page.unroute("**/cell-manager-dialog*");
  await fallback.getByRole("button", { name: "Refresh app" }).click();
  await navigated;
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  // Whole-window recovery now restores the project tab, so the old
  // single-document recovery toast is no longer the recovery contract.
  // Check the actual restored revision and that the editor remains usable.
  await expect(page.getByTestId("revision")).toHaveText("1");
  const manager = await openExternalCircuits(page);
  await expect(fallback).toHaveCount(0);
  await expect(manager).toBeVisible();
});

test("a scene build failure degrades to the last good view and recovers", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeResistors(page, [360]);
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");
  const painted = (id: string) =>
    page.locator(`[data-layer="symbols"] [data-object-id="${id}"]`);

  // Break formal scene building: further commits must not crash the page,
  // the canvas keeps showing the last good scene, and the model still edits.
  await page.evaluate(() => {
    window.__ICM_TEST_SCENE_CRASH__ = true;
  });
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 520, y: 230 } });
  await expect(page.getByTestId("revision")).toHaveText("2");
  // The degraded status fires on the commit itself; assert it before the
  // closing Escape overwrites the status line.
  await expectStatus(page, "Scene rendering failed");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  // Hit targets are React-rendered, but the formal scene stays at the last
  // good view, so R2's painted symbol must be absent from it.
  await expect(painted("R2")).toHaveCount(0);

  // Once scene building works again, the next commit renders fresh content.
  await page.evaluate(() => {
    window.__ICM_TEST_SCENE_CRASH__ = false;
  });
  await placeResistors(page, [640]);
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.getByTestId("hit-R3")).toBeVisible();
  await expect(painted("R2")).toBeVisible();
  await expect(painted("R3")).toBeVisible();
});
