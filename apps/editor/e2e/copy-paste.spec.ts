// Copying with C and C/V: fresh identities, the copy ghost, turning before
// placing, and repeated placement.

import {
  exportedProject,
  awaitEditorReady,
  clickDrawTool,
  expectStatus,
  setComponentCodeField,
  expectRecovered,
} from "./editor-fixtures";
import type { SchematicDocument } from "@icm/model";
import { expect, test } from "@playwright/test";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { centre, copySelectionAt, drawWire } from "./canvas-fixtures.js";

test("connects copied multi-pin groups through a manually bent wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 320, y: 180 });
  await placeComponent(page, "nmos", { x: 320, y: 360 });
  await drawWire(page, "M1-S", "M2-D");

  await page.keyboard.press("Control+a");
  await copySelectionAt(page, { x: 560, y: 300 });
  await expect(page.getByTestId("instance-count")).toHaveText("4");

  // Let the debounced recovery write settle before reloading. A reload inside
  // the debounce window cannot carry the last edit: the browser aborts
  // uncommitted IndexedDB transactions while the page unloads.
  const revision = await page.getByTestId("revision").textContent();
  await expectRecovered(page, `"revision": ${revision}`);
  await page.reload();
  // Refresh restores this window's workspace without a second manual restore.
  await awaitEditorReady(page);
  await expect(page.getByTestId("instance-count")).toHaveText("4");

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M2-S").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 460, y: 500 } });
  await page.getByTestId("terminal-M2_2-S").click();

  await expectStatus(page, "Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(3);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
});

test("C/V copies as fresh: a unique new reference and the label as drawn", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 240 });
  await placeComponent(page, "resistor", { x: 560, y: 240 });
  await page.getByTestId("hit-R1").click({ button: "right" });
  await openSelectionShelf(page);
  await setComponentCodeField(page, "netlistName", "R99");
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("Old_alias");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-R1").click();
  await copySelectionAt(page, { x: 560, y: 420 }, ["ControlOrMeta+c", "v"]);
  await expect(page.getByTestId("instance-count")).toHaveText("3");
  const document = (await exportedProject(page))
    .documents[0] as SchematicDocument;
  const copy = document.instances.find(
    (instance) => instance.id !== "R1" && instance.id !== "R2",
  )!;
  expect(copy.reference).not.toBe("R99");
  expect(new Set(document.instances.map((item) => item.reference)).size).toBe(
    3,
  );
  // Ctrl/Cmd+C then V places what C places: a fresh part with its own new
  // Reference whose label still reads as its author wrote it.
  const labelOf = (instanceId: string) =>
    document.annotations.find(
      (item) =>
        item.anchor.kind === "object" &&
        item.anchor.objectId === instanceId &&
        item.kind === "instance-label",
    )!.id;
  const labelText = (id: string) =>
    page
      .locator(`[data-layer="annotations"] [data-object-id="${id}"]`)
      .textContent();
  expect(await labelText(labelOf(copy.id))).toBe(
    await labelText(labelOf("R1")),
  );
  expect(await labelText(labelOf(copy.id))).not.toContain(copy.reference!);
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText("2");
});

test("C alone previews before clipboard permission resolves and Escape cancels without a revision", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: () => new Promise<void>(() => {}) },
    });
  });
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await page.getByTestId("hit-R1").click();

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await expect(page.getByTestId("instance-count")).toHaveText("1");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await page.mouse.move(box.x + 560, box.y + 340);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  await expect(page.getByTestId("instance-count")).toHaveText("1");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expectStatus(page, "Copy placement cancelled");
});

test("the copy ghost follows the pointer, turns with R, and keeps placing over existing geometry until Escape", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "resistor", { x: 620, y: 360 });
  await page.getByTestId("hit-R1").click();
  const canvas = page.getByTestId("schematic-canvas");
  const canvasBox = await canvas.boundingBox();
  const target = await page.getByTestId("hit-R2").boundingBox();
  if (!canvasBox || !target)
    throw new Error("Canvas objects are not measurable");

  await page.keyboard.press("c");
  await page.mouse.move(canvasBox.x + 500, canvasBox.y + 180);
  const ghost = page.getByTestId("copy-placement-preview");
  await expect(ghost).toBeVisible();
  // The ghost is built from the same dry-run paste transaction as its
  // commit, so it owns a reserved copy ID rather than the source ID.
  const previewSymbol = ghost.locator("[data-object-id] > g").first();
  await expect(previewSymbol).toHaveAttribute("transform", /rotate\(0\)/);
  const ghostContent = await ghost
    .locator(":scope > *")
    .first()
    .elementHandle();
  if (!ghostContent) throw new Error("Copy content is not measurable");
  const first = await ghost.boundingBox();
  await page.mouse.move(centre(target).x, centre(target).y);
  const second = await ghost.boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.x).not.toBe(first!.x);
  expect(second!.y).not.toBe(first!.y);
  // Position alone changes the SVG transform, not the already drawn copy.
  expect(
    await ghost.evaluate(
      (current, saved) => current.firstElementChild === saved,
      ghostContent,
    ),
  ).toBe(true);

  // The copy capture plane owns this click even though an existing Instance
  // is directly under it, and placement stays armed for the next one.
  await page.mouse.click(centre(target).x, centre(target).y);
  await expect(page.getByTestId("instance-count")).toHaveText("3");
  await expect(ghost).toBeVisible();

  // R turns the ghost before the next commit, and the copy lands turned.
  await page.mouse.move(canvasBox.x + 560, canvasBox.y + 440);
  await page.keyboard.press("r");
  await expect(previewSymbol).toHaveAttribute("transform", /rotate\(90\)/u);
  await canvas.click({ position: { x: 560, y: 440 } });
  await expect(page.getByTestId("instance-count")).toHaveText("4");
  await expect(
    canvas.locator('[data-object-id="R1_3"] > g').first(),
  ).toHaveAttribute("transform", /rotate\(90\)/u);
  // The pasted designator and its visible label both read R4.
  await expect(canvas.getByText("R4", { exact: true })).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(ghost).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText("3");
});
