// Copying with C and C/V: fresh identities, the copy ghost, turning before
// placing, and repeated placement.

import { parseSavedProject } from "./editor-fixtures";
import type { SchematicDocument } from "@icm/model";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import {
  awaitEditorReady,
  clickDrawTool,
  downloadBytes,
  setComponentCodeField,
  recoveryProjectTexts,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { copySelectionAt } from "./canvas-fixtures.js";

/** Ctrl/Cmd+C then V: the clipboard path, which keeps authored label text. */
async function pasteSelectionAt(
  page: Page,
  position: { x: number; y: number },
): Promise<void> {
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.keyboard.press("ControlOrMeta+c");
  await page.keyboard.press("v");
  await page.mouse.move(box.x + position.x, box.y + position.y);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
}

test("connects copied multi-pin groups through a manually bent wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 320, y: 180 });
  await placeComponent(page, "nmos", { x: 320, y: 360 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-S").click();
  await page.getByTestId("terminal-M2-D").click();
  await page.keyboard.press("Escape");

  await page.keyboard.press("Control+a");
  await copySelectionAt(page, { x: 560, y: 300 });
  await expect(page.getByTestId("instance-count")).toHaveText("4");

  // Let the debounced recovery write settle before reloading. A reload inside
  // the debounce window cannot carry the last edit: the browser aborts
  // uncommitted IndexedDB transactions while the page unloads.
  const revision = await page.getByTestId("revision").textContent();
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain(`"revision": ${revision}`);
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

  await expect(page.getByTestId("status")).toContainText("Committed route");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(3);
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
});

test("copies one explicitly selected transistor without its dangling Wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 320, y: 260 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-M1-G").click();
  await page
    .getByTestId("schematic-canvas")
    .dblclick({ position: { x: 160, y: 260 } });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  // Clicking only the Instance is an exact visual selection. The unselected
  // dangling Route must remain on the original instead of entering the copy
  // through electrical-closure expansion.
  await page.getByTestId("hit-M1").click();
  await copySelectionAt(page, { x: 560, y: 260 });

  await expect(page.getByTestId("instance-count")).toHaveText("2");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
});

test("C/V copies as fresh: a unique new reference, the label as drawn, and unselected connections detach", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 240 });
  await placeComponent(page, "resistor", { x: 560, y: 240 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-2").click();
  await page.keyboard.press("Escape");
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
  await pasteSelectionAt(page, { x: 560, y: 420 });
  await expect(page.getByTestId("instance-count")).toHaveText("3");
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  const document = saved.documents[0] as SchematicDocument;
  const copy = document.instances.find(
    (instance) => instance.id !== "R1" && instance.id !== "R2",
  )!;
  expect(copy.reference).not.toBe("R99");
  expect(new Set(document.instances.map((item) => item.reference)).size).toBe(
    3,
  );
  expect(
    document.nets
      .filter((net) =>
        net.terminals.some((terminal) => terminal.instanceId === copy.id),
      )
      .every((net) =>
        net.terminals.every((terminal) => terminal.instanceId === copy.id),
      ),
  ).toBe(true);
  expect(document.routes).toHaveLength(1);
  const annotation = document.annotations.find(
    (item) =>
      item.anchor.kind === "object" &&
      item.anchor.objectId === copy.id &&
      item.kind === "instance-label",
  )!;
  // Ctrl/Cmd+C then V places what C places: a fresh part with its own new
  // Reference whose label still reads as its author wrote it.
  const sourceLabel = document.annotations.find(
    (item) =>
      item.anchor.kind === "object" &&
      item.anchor.objectId === "R1" &&
      item.kind === "instance-label",
  )!;
  expect(annotation.binding).toBeUndefined();
  expect(annotation.content).toEqual(sourceLabel.content);
  const labelText = (id: string) =>
    page
      .locator(`[data-layer="annotations"] [data-object-id="${id}"]`)
      .textContent();
  expect(await labelText(annotation.id)).toBe(await labelText(sourceLabel.id));
  expect(await labelText(annotation.id)).not.toContain(copy.reference!);
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
  await expect(page.getByTestId("status")).toContainText(
    "Copy placement cancelled",
  );
});

test("copy ghost follows each pointer position and commits over existing geometry", async ({
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
  const first = await ghost.boundingBox();
  await page.mouse.move(
    target.x + target.width / 2,
    target.y + target.height / 2,
  );
  const second = await ghost.boundingBox();
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  expect(second!.x).not.toBe(first!.x);
  expect(second!.y).not.toBe(first!.y);

  // The copy capture plane owns this click even though an existing Instance
  // is directly under it.
  await page.mouse.click(
    target.x + target.width / 2,
    target.y + target.height / 2,
  );
  await expect(page.getByTestId("instance-count")).toHaveText("3");
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText("2");
});

test("R rotates a copy preview before committing the copied component", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await page.getByTestId("hit-R1").click();
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");

  await page.keyboard.press("c");
  await page.mouse.move(box.x + 560, box.y + 340);
  const previewSymbol = page
    .getByTestId("copy-placement-preview")
    // The ghost is built from the same dry-run paste transaction as its
    // commit, so it owns a reserved copy ID rather than the source ID.
    .locator("[data-object-id] > g")
    .first();
  await expect(previewSymbol).toHaveAttribute("transform", /rotate\(0\)/);

  await page.keyboard.press("r");
  await expect(previewSymbol).toHaveAttribute("transform", /rotate\(90\)/u);
  await canvas.click({ position: { x: 560, y: 340 } });
  await expect(
    canvas.locator('[data-object-id="R1_2"] > g').first(),
  ).toHaveAttribute("transform", /rotate\(90\)/u);
  // The pasted designator and its visible label both read R2.
  await expect(canvas.getByText("R2", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
});

test("keeps copy placement active for repeated commits until Escape", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await page.getByTestId("hit-R1").click();
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");

  await page.keyboard.press("c");
  await page.mouse.move(box.x + 520, box.y + 220);
  await canvas.click({ position: { x: 520, y: 220 } });
  await expect(page.getByTestId("instance-count")).toHaveText("2");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();

  await page.mouse.move(box.x + 680, box.y + 220);
  await canvas.click({ position: { x: 680, y: 220 } });
  await expect(page.getByTestId("instance-count")).toHaveText("3");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("3");
});

test("the copy ghost shows the wires it is about to place", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await placeComponent(page, "resistor", { x: 260, y: 200 });
  await placeComponent(page, "resistor", { x: 520, y: 200 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-2").click();
  await page.keyboard.press("Escape");
  const canvas = page.getByTestId("schematic-canvas");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  // Marquee both parts and the wire between them.
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 640, box.y + 130);
  await page.mouse.down();
  await page.mouse.move(box.x + 190, box.y + 300, { steps: 10 });
  await page.mouse.up();

  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 400, y: 420 } });
  const ghost = page.locator(".copy-placement-preview");
  await expect(ghost).toBeVisible();
  // The ghost draws what the drop will produce: two parts and their wire.
  await expect(ghost.locator("polyline")).not.toHaveCount(0);

  // And what it drew is what lands: the placed copy carries a wire too.
  await canvas.click({ position: { x: 400, y: 420 } });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(2);
});
