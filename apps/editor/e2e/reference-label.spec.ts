import { serializeProject } from "@icm/project-protocol";
import { parseSavedProject } from "./editor-fixtures";
import { expect, test, type Page } from "@playwright/test";
import {
  awaitEditorReady,
  chooseComponent,
  downloadBytes,
  editComponentPropertyCode,
  expectComponentCodeField,
} from "./editor-fixtures.js";

async function placeResistor(page: Page) {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 240 } });
  await page.keyboard.press("Escape");
}
async function projectFile(page: Page) {
  return parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
}
const visual = (page: Page) =>
  page.locator(
    '[data-layer="annotations"] [data-object-id="instance-label-R1"]',
  );

test("canvas edits one visual annotation without changing the Netlist Reference", async ({
  page,
}) => {
  await placeResistor(page);
  const before = await projectFile(page);
  const original = before.documents[0].annotations.find(
    (a: { id: string }) => a.id === "instance-label-R1",
  );
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
  const saved = await projectFile(page);
  expect(saved.documents[0].instances[0].reference).toBe("R1");
  const labels = saved.documents[0].annotations.filter(
    (a: { kind: string }) => a.kind === "instance-label",
  );
  expect(labels).toHaveLength(1);
  expect(labels[0]).toMatchObject({ id: original.id, anchor: original.anchor });
  expect(labels[0]).not.toHaveProperty("binding");
  expect(JSON.stringify(labels[0].content)).toContain("line-break");

  // Undo / redo restores both source mode and authored content atomically.
  await page.keyboard.press("Control+z");
  await expect(visual(page)).toContainText("R1");
  await page.keyboard.press("Control+Shift+z");
  await expect(visual(page)).toContainText("input pair");
  await page.getByTestId("project-file").setInputFiles({
    name: "visual-annotation.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(saved)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened visual-annotation.icproj.json",
  );
  await expect(visual(page)).toContainText("input pair");
  const reopened = await projectFile(page);
  expect(reopened.documents[0].annotations).toEqual(
    saved.documents[0].annotations,
  );
  expect(reopened.documents[0].instances[0].reference).toBe("R1");
});

test("Properties renames the electrical identity explicitly; restore is an in-place editor action", async ({
  page,
}) => {
  await placeResistor(page);
  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill("load");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("q");
  const properties = page.getByRole("complementary", { name: "Properties" });
  await expectComponentCodeField(page, "name", "load");
  await expectComponentCodeField(page, "netlistName", "R1");
  await expect(properties.getByLabel("Component label")).toHaveCount(0);
  await editComponentPropertyCode(page, (code) => {
    code.name = "RL";
  });
  await expectComponentCodeField(page, "name", "RL");
  await expectComponentCodeField(page, "netlistName", "R1");
  await expect(visual(page)).toContainText("RL");
  await editComponentPropertyCode(page, (code) => {
    code.netlistName = "R7";
  });
  await expectComponentCodeField(page, "netlistName", "R7");
  await expect(visual(page)).toContainText("RL");
  // Prefix validation still applies to this explicitly electrical field.
  await editComponentPropertyCode(page, (code) => {
    code.netlistName = "gm";
  });
  await expect(properties).toContainText("Canvas property code was rejected");
  await properties.getByRole("button", { name: "Discard draft" }).click();
  await expectComponentCodeField(page, "netlistName", "R7");
  await editComponentPropertyCode(page, (value) => {
    value.display.visualAnnotation = false;
  });
  await expect(visual(page)).toHaveCount(0);
  await editComponentPropertyCode(page, (value) => {
    value.display.visualAnnotation = true;
  });
  await expect(visual(page)).toContainText("RL");

  await page.getByTestId("annotation-hit-instance-label-R1").dblclick();
  const restore = page.getByRole("checkbox", {
    name: "Use display alias",
    exact: true,
  });
  await expect(restore).toBeChecked();
  await restore.uncheck();
  await expect(visual(page)).toContainText("R7");
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toHaveText("R7");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(visual(page)).toContainText("R7");
  const saved = await projectFile(page);
  const labels = saved.documents[0].annotations.filter(
    (a: { kind: string }) => a.kind === "instance-label",
  );
  expect(labels).toHaveLength(1);
  expect(labels[0]).toMatchObject({
    id: "instance-label-R1",
    binding: { kind: "instance-reference", instanceId: "R1" },
  });
  expect(labels[0]).not.toHaveProperty("content");
  expect(saved.documents[0].instances[0].reference).toBe("R7");
});
