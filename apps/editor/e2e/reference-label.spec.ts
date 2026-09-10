import { expect, test, type Page } from "@playwright/test";
import {
  awaitEditorReady,
  chooseComponent,
  downloadBytes,
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
  return JSON.parse(
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
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(
    page.getByRole("button", { name: "Bold", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Subscript", exact: true }),
  ).toBeVisible();
  const [sizeControl, ...actionControls] = await Promise.all(
    [
      page.getByRole("button", { name: "Increase text size" }),
      page.getByRole("button", { name: "Apply text changes" }),
      page.getByRole("button", { name: "Cancel text changes" }),
      page.getByRole("button", { name: "Delete text" }),
      page.getByRole("button", { name: "Use netlist name", exact: true }),
    ].map(async (control) => {
      const bounds = await control.boundingBox();
      if (!bounds) throw new Error("Text editor control is not measurable");
      return bounds;
    }),
  );
  expect(
    actionControls.every(({ y }) => Math.abs(y - actionControls[0]!.y) < 1),
  ).toBe(true);
  expect(actionControls[0]!.y).toBeGreaterThan(sizeControl!.y);
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
    buffer: Buffer.from(JSON.stringify(saved)),
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
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill("load");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("selection-shelf").click();
  const properties = page.getByRole("complementary", { name: "Properties" });
  const reference = properties.getByLabel("Netlist Reference");
  await expect(reference).toHaveValue("R1");
  await expect(properties.getByLabel("Component label")).toHaveCount(0);
  await reference.fill("R7");
  await reference.press("Enter");
  await expect(reference).toHaveValue("R7");
  await expect(visual(page)).toContainText("load");
  // Prefix validation still applies to this explicitly electrical field.
  await reference.fill("gm");
  await reference.press("Enter");
  await expect(reference).toHaveValue("R7");
  const toggle = properties
    .getByLabel("Component display toggles")
    .getByLabel("Visual annotation");
  await toggle.uncheck();
  await expect(visual(page)).toHaveCount(0);
  await toggle.check();
  await expect(visual(page)).toContainText("load");

  await properties.getByRole("button", { name: "Edit annotation" }).click();
  const restore = page.getByRole("button", {
    name: "Use netlist name",
    exact: true,
  });
  await restore.click();
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
