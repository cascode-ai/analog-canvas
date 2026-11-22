import { expect, test, type Page } from "@playwright/test";
import {
  exportedProject,
  placeResistors,
  openEditor,
} from "./editor-fixtures.js";

const visual = (page: Page) =>
  page.locator(
    '[data-layer="annotations"] [data-object-id="instance-label-R1"]',
  );

test("canvas edits one visual annotation without changing the Netlist Reference, and restores it in place", async ({
  page,
}) => {
  await openEditor(page);
  await placeResistors(page, [360], 240);
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await expect(
    page.getByRole("checkbox", { name: "Use display alias" }),
  ).not.toBeChecked();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Subscript", exact: true }),
  ).toBeVisible();
  const controlBounds = async (name: string) => {
    const bounds = await page.getByRole("button", { name }).boundingBox();
    if (!bounds) throw new Error("Text editor control is not measurable");
    return bounds;
  };
  const [
    decreaseControl,
    increaseControl,
    applyControl,
    cancelControl,
    deleteControl,
  ] = await Promise.all([
    controlBounds("Decrease text size"),
    controlBounds("Increase text size"),
    controlBounds("Apply text changes"),
    controlBounds("Cancel text changes"),
    controlBounds("Delete text"),
  ]);
  const actionControls = [applyControl, cancelControl, deleteControl];
  expect(
    actionControls.every(({ y }) => Math.abs(y - actionControls[0]!.y) < 1),
  ).toBe(true);
  expect(Math.abs(increaseControl.y - decreaseControl.y)).toBeLessThan(1);
  expect(increaseControl.x).toBeGreaterThan(decreaseControl.x);
  expect(actionControls[0]!.y).toBeGreaterThan(increaseControl.y);
  const toolbarBounds = await page
    .getByRole("toolbar", { name: "Text formatting" })
    .boundingBox();
  if (!toolbarBounds) throw new Error("Text toolbar is not measurable");
  for (const control of [decreaseControl, increaseControl, ...actionControls]) {
    expect(control.x).toBeGreaterThanOrEqual(toolbarBounds.x);
    expect(control.x + control.width).toBeLessThanOrEqual(
      toolbarBounds.x + toolbarBounds.width + 1,
    );
  }
  await editor.fill("R2");
  await editor.press("End");
  await editor.press("Shift+Enter");
  await page.keyboard.type("input pair");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("canvas-text-editor")).toHaveCount(0);
  await expect(visual(page)).toContainText("input pair");
  await expect(page.getByTestId("reference-label-offer")).toHaveCount(0);
  // The one label keeps its anchor, drops its binding and holds the line
  // break (visual-instance-annotation's "edits arbitrary content in place…");
  // the device keeps its Reference.
  const saved = await exportedProject(page);
  expect(saved.documents[0].instances[0].reference).toBe("R1");

  // Undo / redo restores both source mode and authored content atomically.
  await page.keyboard.press("Control+z");
  await expect(visual(page)).toContainText("R1");
  await page.keyboard.press("Control+Shift+z");
  await expect(visual(page)).toContainText("input pair");

  // Turning the alias off in place shows the live Reference again and
  // restores its binding.
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  const alias = page.getByRole("checkbox", { name: "Use display alias" });
  await expect(alias).toBeChecked();
  await alias.uncheck();
  await expect(editor).toHaveText("R1");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(visual(page)).toHaveText("R1");
  const restored = (await exportedProject(page)).documents[0].annotations.find(
    (annotation: { id: string }) => annotation.id === "instance-label-R1",
  );
  expect(restored).toMatchObject({
    binding: { kind: "instance-reference", instanceId: "R1" },
  });
  expect(restored).not.toHaveProperty("content");
});

// Renaming the electrical identity apart from the visual name, restoring
// the live binding, the prefix refusal and hiding the label are
// visual-instance-annotation's, component-property-code's, transaction's
// ("refuses a netlist reference that does not match the device's prefix")
// and property-apply-plan's ("hides and shows a component's name label…").

test("previews and creates a resistor array from the on-canvas reference in one undo", async ({
  page,
}) => {
  await openEditor(page);
  await placeResistors(page, [360], 240);
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("RLOAD<6:0>");
  await expect(page.getByTestId("canvas-text-editor")).toContainText(
    "7 members",
  );
  await editor.press("Enter");
  await expect(visual(page)).toHaveText("RLOAD6");
  const cell = (await exportedProject(page)).documents[0];
  expect(cell.instanceGroups[0].memberIds).toHaveLength(7);
  await page.getByTestId("draw-tool-undo").click();
  await expect(visual(page)).toHaveText("R1");
});
