// Placing, moving and editing labels: instance and Net labels, the L shortcut,
// free text and the canvas text editor.

import { parseSavedProject } from "./editor-fixtures";
import { createRoutePath } from "@icm/model";
import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { createRoutingDemoProject } from "../src/demos/routing-demo.js";
import {
  revealPropertiesShelf,
  clickDrawTool,
  placeText,
  downloadBytes,
  editComponentPropertyCode,
  readComponentPropertyCode,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import {
  clickRoute,
  dragBy,
  closeSelectionShelf,
  selectRichTextOffsets,
} from "./canvas-fixtures.js";

async function instanceLabelVector(
  page: Page,
  instanceId: string,
): Promise<{ x: number; y: number }> {
  const instance = await page
    .locator(`[data-layer="symbols"] [data-object-id="${instanceId}"]`)
    .boundingBox();
  const label = await page
    .locator(
      `[data-layer="editor-overlay"] [data-testid="annotation-hit-instance-label-${instanceId}"]`,
    )
    .boundingBox();
  if (!instance || !label) throw new Error("Instance label is not measurable");
  return {
    x: label.x + label.width / 2 - (instance.x + instance.width / 2),
    y: label.y + label.height / 2 - (instance.y + instance.height / 2),
  };
}

test("keeps a transformed instance label at a constant distance while moving", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  await page.keyboard.press("Shift+r");
  await expect(page.getByTestId("revision")).toHaveText("2");

  const hit = page.getByTestId("hit-R1");
  const before = await instanceLabelVector(page, "R1");
  await dragBy(hit, { x: 83, y: 47 });
  const afterFirst = await instanceLabelVector(page, "R1");
  expect(afterFirst.x).toBeCloseTo(before.x, 3);
  expect(afterFirst.y).toBeCloseTo(before.y, 3);

  await dragBy(hit, { x: -51, y: 69 });
  const afterSecond = await instanceLabelVector(page, "R1");
  expect(afterSecond.x).toBeCloseTo(before.x, 3);
  expect(afterSecond.y).toBeCloseTo(before.y, 3);
  await expect(page.getByTestId("revision")).toHaveText("4");
});

test("selects an attached label without selecting its host", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });

  await page
    .getByTestId("annotation-hit-instance-label-R1")
    .click({ modifiers: ["Alt"] });
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveClass(/hit-target/u);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveClass(/selected/u);
  await revealPropertiesShelf(page);
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "Annotation · instance-label",
  );
});

test("moves an explicitly selected attached label", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });

  // Text uses the same one-gesture threshold as a component.
  const label = page.getByTestId("annotation-hit-instance-label-R1");
  await expect(label).toBeVisible();
  // The placed component is initially selected and therefore owns an
  // overlapping drag. Alt cycles to the label once; subsequent drags remain
  // sticky to that explicit selection.
  await label.click({ modifiers: ["Alt"] });
  const before = await label.boundingBox();
  expect(before).not.toBeNull();

  await label.dragTo(page.getByTestId("schematic-canvas"), {
    targetPosition: { x: 470, y: 330 },
  });
  const after = await label.boundingBox();
  expect(after).not.toBeNull();
  expect(after!.x).not.toBe(before!.x);
  expect(after!.y).not.toBe(before!.y);
});

test("edits instance, electrical Net, and free text with bounded label handles", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-R1").click();
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  const referenceEditor = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await expect(referenceEditor).toHaveAttribute("contenteditable", "true");
  await referenceEditor.fill("R_LOAD");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  // The user-owned schematic name changes without touching the hidden SPICE
  // reference, so its RichText spelling is displayed exactly as authored.
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "R_LOAD",
  );

  await clickRoute(page, "route-ui-1", 0.5, 0);
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "SIGNAL";
  });
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "SIGNAL",
  );
  await expect(
    page.getByTestId("annotation-hit-net-label-route-ui-1"),
  ).toBeVisible();
  await page.getByTestId("annotation-hit-net-label-route-ui-1").dblclick();
  const annotationEditor = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await expect(annotationEditor).toHaveAttribute("contenteditable", "true");
  await annotationEditor.fill("Vref");
  await expect(page.getByRole("button", { name: "Italic" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Subscript" })).toBeVisible();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "Vref",
  );
  await revealPropertiesShelf(page);
  await page.getByTestId("selection-shelf").click();

  await placeComponent(page, "resistor", { x: 280, y: 320 });
  await placeComponent(page, "resistor", { x: 480, y: 320 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R3-2").click();
  await page.getByTestId("terminal-R4-1").click();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("net-count")).toHaveText("2");
  await clickRoute(page, "route-ui-2", 0.5, 0);
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "Vref";
  });
  await expect(page.getByTestId("net-count")).toHaveText("2");
  await expect(page.getByTestId("status")).toHaveText(
    "Updated Route route-ui-2",
  );

  await placeText(page);
  const textInput = page.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await textInput.fill("Matched pair");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.locator('[data-layer="drafting"]')).toContainText(
    "Matched pair",
  );
  const noteHandle = page.locator('[data-testid^="drafting-hit-note-"]');
  const beforeBox = await noteHandle.boundingBox();
  if (!beforeBox) throw new Error("Text handle is not measurable");
  await closeSelectionShelf(page);
  await noteHandle.dragTo(page.getByTestId("schematic-canvas"), {
    targetPosition: { x: 360, y: 300 },
  });
  const afterBox = await noteHandle.boundingBox();
  expect(afterBox?.x).not.toBe(beforeBox.x);
});

test("L labels a selected wire or snaps near an unselectable wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 480, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  // The selection-first flow opens the same rich editor used after creation,
  // then remains a one-step commit after Apply.
  await clickRoute(page, "route-ui-1", 0.7, 0);
  await page.keyboard.press("l");
  const editor = page.getByTestId("net-label-editor");
  await expect(editor).toBeVisible();
  const editorBox = await editor.boundingBox();
  expect(editorBox?.width).toBeGreaterThan(250);
  expect(editorBox?.height).toBeGreaterThan(100);
  const editorLayerOrder = await editor.evaluate((element) => {
    const overlay = element.closest('[data-layer="editor-overlay"]');
    const hitTargets = overlay
      ? [...overlay.querySelectorAll('[data-testid*="-hit-"]')]
      : [];
    return {
      hitTargetCount: hitTargets.length,
      followsEveryHitTarget: hitTargets.every(
        (target) =>
          (target.compareDocumentPosition(element) &
            Node.DOCUMENT_POSITION_FOLLOWING) !==
          0,
      ),
    };
  });
  expect(editorLayerOrder.hitTargetCount).toBeGreaterThan(0);
  expect(editorLayerOrder.followsEveryHitTarget).toBe(true);
  await expect(editor.getByRole("button", { name: "Italic" })).toBeVisible();
  const richEditor = editor.getByRole("textbox", {
    name: "Canvas text editor",
  });
  await richEditor.fill("SIGNAL");
  await selectRichTextOffsets(richEditor, 1, 6);
  await editor.getByRole("button", { name: "Subscript" }).click();
  await editor.getByRole("button", { name: "Apply text changes" }).click();
  const preview = page.getByTestId("net-label-placement-preview");
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "SIGNAL",
  );
  await expect(
    page.locator(
      '[data-object-id="net-label-route-ui-1"] [data-text-run="subscript"]',
    ),
  ).toHaveCount(1);
  await expect(page.getByTestId("flightline")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(
    page.getByTestId("annotation-hit-net-label-route-ui-1"),
  ).toHaveCount(0);
  await expect(page.getByTestId("flightline")).toHaveCount(0);

  // Selection Filter must not disable an electrical creation target.
  await page.keyboard.press("Control+Shift+f");
  const filter = page.getByTestId("selection-filter-popover");
  await filter.getByRole("button", { name: "None" }).click();
  await filter.getByRole("button", { name: "Close" }).click();

  await page.keyboard.press("l");
  await richEditor.fill("VREF");
  await editor.getByRole("button", { name: "Apply text changes" }).click();
  await expect(preview).toContainText("VREF");
  const routePoint = await page
    .getByTestId("route-hit-route-ui-1")
    .evaluate((element) => {
      const polyline = element as SVGPolylineElement;
      const first = polyline.points.getItem(0);
      const second = polyline.points.getItem(1);
      const matrix = polyline.getScreenCTM();
      if (!first || !second || !matrix) return null;
      const point = new DOMPoint(
        first.x + (second.x - first.x) * 0.25,
        first.y + (second.y - first.y) * 0.25,
      ).matrixTransform(matrix);
      return { x: point.x, y: point.y };
    });
  if (!routePoint) throw new Error("Route is not measurable");
  await page.mouse.move(routePoint.x, routePoint.y + 9);
  // An SVG line has zero CSS width/height, so assert its rendered presence
  // rather than Playwright's box-based visibility heuristic.
  await expect(page.locator(".smart-snap-guide")).toHaveCount(1);
  await page.mouse.click(routePoint.x, routePoint.y + 9);
  await expect(preview).toHaveCount(0);
  await expect(page.locator('[data-layer="annotations"]')).toContainText(
    "VREF",
  );
  await expect(page.getByTestId("route-hit-route-ui-1")).not.toHaveClass(
    /selected/,
  );

  await page.keyboard.press("l");
  await richEditor.fill("CANCELLED");
  await richEditor.press("Escape");
  await expect(editor).toHaveCount(0);
  await expect(page.locator('[data-layer="annotations"]')).not.toContainText(
    "CANCELLED",
  );

  await page.keyboard.press("l");
  await richEditor.fill("");
  await editor.getByRole("button", { name: "Apply text changes" }).click();
  await expect(editor).toBeVisible();
  await expect(page.getByTestId("status")).toContainText(
    "name cannot be empty",
  );
  await richEditor.press("Escape");
});

test("canvas text editor cancels explicitly and commits on Escape or outside click", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 280 });
  const rendered = page.locator('[data-object-id="instance-label-R1"]');

  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("RA");
  await page.getByRole("button", { name: "Cancel text changes" }).click();
  await expect(rendered).toContainText("R1");
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("RA");
  await page.keyboard.press("Escape");
  await expect(rendered).toContainText("RA");
  await expect(page.getByTestId("revision")).toHaveText("2");

  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.keyboard.press("Control+a");
  await page.keyboard.type("RB");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await expect(rendered).toContainText("RB");
  await expect(page.getByTestId("revision")).toHaveText("3");
});

test("a dragged Net label moves freely while retaining its Net tether", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await placeComponent(page, "resistor", { x: 520, y: 180 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-R2-1").click();
  await page.keyboard.press("Escape");

  await page.keyboard.press("l");
  const editor = page.getByTestId("net-label-editor");
  await editor
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("NETA");
  await editor.getByRole("button", { name: "Apply text changes" }).click();
  await clickRoute(page, "route-ui-1", 0.5, 0);

  const label = page.getByTestId("annotation-hit-net-label-route-ui-1");
  const renderedLabel = page.locator('[data-object-id="net-label-route-ui-1"]');
  await expect(label).toBeVisible();
  const before = await renderedLabel.boundingBox();
  if (!before) throw new Error("Net label is not measurable");
  const revisionBefore = await page.getByTestId("revision").textContent();

  // Well past the left end of the short Route: the label must follow the
  // pointer rather than clamping its horizontal position to that Route. Start
  // on the overlap between the text's lower hit area and the wire hit stroke:
  // this press used to move the Route instead of the visible label.
  const start = await page.evaluate(({ x, y, width, height }) => {
    for (let py = y; py <= y + height; py += 2) {
      for (let px = x; px <= x + width; px += 2) {
        const ids = document
          .elementsFromPoint(px, py)
          .map((element) => element.getAttribute("data-testid"));
        if (
          ids.includes("annotation-hit-net-label-route-ui-1") &&
          ids.includes("route-hit-route-ui-1")
        ) {
          return { x: px, y: py };
        }
      }
    }
    return null;
  }, before);
  if (!start) throw new Error("Net label and Route do not overlap");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x - 240, start.y + 80, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("revision")).not.toHaveText(revisionBefore!);
  const after = await renderedLabel.boundingBox();
  if (!after) throw new Error("Net label vanished after the drag");
  expect(after.x - before.x).toBeLessThan(-200);
  expect(after.y - before.y).toBeGreaterThan(60);
  await expect(renderedLabel).toHaveAttribute("data-anchor-kind", "free");
  const tether = page.getByTestId("label-tether");
  await expect(tether).toBeVisible();
  await expect(tether).toHaveAttribute("data-tether-kind", "wire");
});

test("L puts a vertical wire's label on its right, and a selected name points at its part", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 160 });
  await placeComponent(page, "resistor", { x: 300, y: 400 });
  await clickDrawTool(page, "wire");
  // Drawn from R2 up to R1: a vertical wire whose direction used to put
  // the label on its left, across the wire.
  await page.getByTestId("terminal-R2-1").click();
  await page.getByTestId("terminal-R1-2").click();
  await page.keyboard.press("Escape");
  await clickRoute(page, "route-ui-1", 0.5, 0);
  await page.keyboard.press("l");
  const editor = page.getByTestId("net-label-editor");
  await editor.getByRole("textbox", { name: "Canvas text editor" }).fill("MID");
  await editor.getByRole("button", { name: "Apply text changes" }).click();
  const label = page.locator('[data-object-id="net-label-route-ui-1"]');
  await expect(label).toContainText("MID");
  const wire = await page.getByTestId("route-hit-route-ui-1").boundingBox();
  const text = await label.boundingBox();
  if (!wire || !text) throw new Error("Wire or label is not measurable");
  expect(text.x).toBeGreaterThan(wire.x + wire.width / 2);

  // A part's selected name draws its line to the part and lights the part.
  await page.keyboard.press("Escape");
  await page.getByTestId("annotation-hit-instance-label-R1").click();
  const tether = page.getByTestId("label-tether");
  await expect(tether).toHaveCount(1);
  await expect(tether).toHaveAttribute("data-tether-kind", "part");
  await expect(page.getByTestId("selection-halo-label-owner")).toHaveCount(1);
  // Selecting the part alone shows which labels are its own.
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R2").click();
  await expect(
    page.locator('[data-testid="label-tether"][data-tether-kind="part"]'),
  ).not.toHaveCount(0);
});

test("keeps the rich-text editor outside its target and shields canvas input", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 420, y: 280 });
  const label = page.getByTestId("annotation-hit-instance-label-R1");
  await label.dblclick();

  const overlay = page.getByTestId("canvas-text-editor");
  await expect(overlay).toBeVisible();
  const [labelBox, overlayBox, componentBox] = await Promise.all([
    label.boundingBox(),
    overlay.boundingBox(),
    page.getByTestId("hit-R1").boundingBox(),
  ]);
  if (!labelBox || !overlayBox || !componentBox) {
    throw new Error("Text editor geometry is not measurable");
  }
  expect(
    overlayBox.y + overlayBox.height <= labelBox.y ||
      overlayBox.y >= labelBox.y + labelBox.height,
  ).toBe(true);

  await page.mouse.move(
    overlayBox.x + overlayBox.width / 2,
    overlayBox.y + overlayBox.height - 4,
  );
  await page.mouse.down();
  await page.mouse.move(
    overlayBox.x + overlayBox.width / 2 + 16,
    overlayBox.y + overlayBox.height - 4,
  );
  await page.mouse.up();
  await expect(overlay).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");
  expect(await page.getByTestId("hit-R1").boundingBox()).toEqual(componentBox);
});

test("deletes imported Net Labels with non-editor ids", async ({ page }) => {
  const project = createRoutingDemoProject();
  const document = project.documents[0]!;
  document.routes.push(
    createRoutePath({
      id: "route-imported-h",
      netId: "net-h",
      start: { kind: "terminal", instanceId: "A", pinName: "P" },
      end: { kind: "terminal", instanceId: "B", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  );
  document.annotations.push({
    id: "imported-label-horizontal",
    kind: "net-label",
    content: { runs: [{ kind: "text", value: "HORIZONTAL" }] },
    netId: "net-h",
    anchor: { kind: "free", position: { x: 300, y: 280 } },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "legacy-net-label.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });

  const importedLabel = page.getByTestId(
    "annotation-hit-imported-label-horizontal",
  );
  await importedLabel.click();
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
    "data-net-id",
    "net-h",
  );
  await expect(
    page.locator(".net-highlight-overlay .net-highlight-core"),
  ).toHaveCount(1);
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
  await page.keyboard.press("Delete");
  await expect(importedLabel).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(importedLabel).toHaveCount(1);

  await clickRoute(page, "route-imported-h");
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "";
  });
  await expect(
    page.getByTestId("annotation-hit-imported-label-horizontal"),
  ).toHaveCount(0);
  expect(
    (await readComponentPropertyCode(page)).match(/"name": ""/u),
  ).not.toBeNull();

  // The label was selected alongside the Route. Its deletion must not poison
  // the following atomic Wire deletion or leave a hidden electrical name.
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("route-hit-route-imported-h")).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "Deleted wire route-imported-h",
  );
  await page.keyboard.press("Control+z");

  const savedWithoutLabel = await downloadBytes(
    page,
    "File",
    "Export Project File…",
  );
  const savedDocument = parseSavedProject(savedWithoutLabel.toString("utf8"))
    .documents[0];
  expect(savedDocument.annotations).toHaveLength(0);
  expect(savedDocument.connectivityEvidence).not.toContainEqual(
    expect.objectContaining({ kind: "name-claim", netId: "net-h" }),
  );
  await page.getByTestId("project-file").setInputFiles({
    name: "legacy-net-label-reopened.icproj.json",
    mimeType: "application/json",
    buffer: savedWithoutLabel,
  });
  await clickRoute(page, "route-imported-h");
  await openSelectionShelf(page);
  expect(JSON.parse(await readComponentPropertyCode(page)).net.name ?? "").toBe(
    "",
  );
});

test("keeps a long right-aligned Port label readable while editing", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("shapes-chip-port").click();
  await canvas.click({ position: { x: 400, y: 250 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const editable = page.locator(".rich-text-editable");
  await expect(editable).toBeVisible();
  await editable.click();
  await page.keyboard.type("VinputDifferentialPositive");

  // The outer foreignObject follows the editor's measured height. The text
  // stays fully visible without turning the main editing surface into a
  // nested vertical scroller.
  const layout = await page
    .getByTestId("canvas-text-editor")
    .evaluate((element) => {
      const editable = element.querySelector<HTMLElement>(
        ".rich-text-editable",
      );
      const shell = element.querySelector<HTMLElement>(
        ".rich-text-editor-shell",
      );
      return {
        hidden: (editable?.scrollHeight ?? 0) - (editable?.clientHeight ?? 0),
        editableOverflowY: editable ? getComputedStyle(editable).overflowY : "",
        frameHeight: Number(element.getAttribute("height")),
        shellScrollHeight: shell?.scrollHeight ?? 0,
      };
    });
  expect(layout.hidden).toBeLessThanOrEqual(0);
  expect(layout.editableOverflowY).not.toBe("auto");
  expect(layout.editableOverflowY).not.toBe("scroll");
  expect(layout.frameHeight).toBeGreaterThanOrEqual(layout.shellScrollHeight);
});
