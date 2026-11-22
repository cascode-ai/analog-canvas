import { createEmptyProject, type CircuitProject } from "@icm/model";
import { executeProjectTransaction, planCreateCellPin } from "@icm/edit-engine";
import { serializeProject } from "@icm/project-protocol";
import { openSelectionShelf } from "./manual-editor-fixtures.js";
import { expect, test, type Page } from "@playwright/test";
import {
  clickDrawTool,
  readComponentPropertyCode,
  exportedProject,
  openProject,
  placeResistors,
  placeComponentAt,
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

test("previews and creates a MOS array from the on-canvas reference in one undo", async ({
  page,
}) => {
  await openEditor(page);
  await placeComponentAt(page, "nmos", { x: 360, y: 240 });
  await page.getByTestId("annotation-hit-instance-label-M1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.press("ControlOrMeta+a");
  await editor.pressSequentially("M<7:0>");
  await expect(page.getByTestId("canvas-text-editor")).toContainText(
    "8 members",
  );
  await editor.press("Enter");
  await expect(
    page.locator(
      '[data-layer="annotations"] [data-object-id="instance-label-M1"]',
    ),
  ).toHaveText("M<7:0>");
  const cell = (await exportedProject(page)).documents[0];
  expect(cell.instanceGroups[0].memberIds).toHaveLength(8);
  await page.getByTestId("draw-tool-undo").click();
  await expect(
    page.locator(
      '[data-layer="annotations"] [data-object-id="instance-label-M1"]',
    ),
  ).toHaveText("M1");
});

for (const entry of ["label", "device"] as const)
  test(`applies a MOS range in ${entry} Properties and draws the drain bus and shared gate`, async ({
    page,
  }) => {
    let project = createEmptyProject("mos-array-input", "MOS array");
    for (const [id, name, x, y] of [
      ["out", "DOUT<0:7>", 500, 160],
      ["bias", "VBIAS", 180, 360],
    ] as const) {
      const document = project.documents[0]!;
      const result = executeProjectTransaction(project, {
        projectId: project.id,
        expectedStructureRevision: project.structureRevision,
        transactionId: id,
        actor: { kind: "human", id: "test" },
        edits: planCreateCellPin(project, document.id, {
          instance: {
            id,
            symbolId: "port",
            placement: { position: { x, y }, rotation: 0, mirror: "none" },
          },
          terminal: {
            id: id + "-pin",
            name,
            netId: id + "-net",
            direction: "passive",
            interfaceInstanceIds: [id],
          },
          signalExpression: name,
          connectionEdits: [],
        }),
      });
      if (!result.ok) throw new Error(result.error.message);
      project = result.project;
    }
    await openProject(page, serializeProject(project));
    await placeComponentAt(page, "nmos", { x: 360, y: 240 });
    await page
      .getByTestId(
        entry === "label" ? "annotation-hit-instance-label-M1" : "hit-M1",
      )
      .click();
    await openSelectionShelf(page);
    const code = JSON.parse(await readComponentPropertyCode(page));
    const input = page.getByLabel("Editable Canvas property code");
    const label = page.locator(
      '[data-layer="annotations"] [data-object-id="instance-label-M1"]',
    );
    for (const name of ["M", "M<7", "M<7:0>"]) {
      await input.fill(JSON.stringify({ ...code, name }, null, 2));
      await expect(label).toHaveText("M1");
    }
    await page.getByRole("button", { name: "Apply name", exact: true }).click();
    await expect(
      page.locator(
        '[data-layer="annotations"] [data-object-id="instance-label-M1"]',
      ),
    ).toHaveText("M<7:0>");
    await clickDrawTool(page, "wire");
    await page.getByTestId("terminal-M1-D").click();
    await page.getByTestId("terminal-out-P").hover();
    await expect(
      page.getByText(/M7\.D → DOUT<0>.*M0\.D → DOUT<7>/),
    ).toBeVisible();
    await page.getByTestId("terminal-out-P").click();
    await expect(page.getByTestId("status")).toContainText("Committed route");
    await page.getByTestId("terminal-M1-G").click();
    await page.getByTestId("terminal-bias-P").click();
    await page
      .getByRole("button", { name: "Connect all 8 G pins to VBIAS" })
      .click();
    await expect(page.getByTestId("status")).toContainText("Committed route");
    const after: CircuitProject = await exportedProject(page);
    const doc = after.documents[0]!;
    expect(doc.routes.map((route) => route.members?.length ?? 1)).toEqual([
      8, 1,
    ]);
    const group = doc.instanceGroups![0]!;
    const bits = doc.netlist!.terminals.find((pin) => pin.name === "DOUT<0:7>")!
      .signal!.members;
    for (const [index, instanceId] of group.memberIds.entries()) {
      expect(
        doc.nets.find((net) => net.id === bits[index]!.netId)?.terminals,
      ).toContainEqual({ instanceId, pinName: "D" });
      expect(
        doc.nets.find(
          (net) =>
            net.id ===
            doc.netlist!.terminals.find((pin) => pin.name === "VBIAS")!.netId,
        )?.terminals,
      ).toContainEqual({ instanceId, pinName: "G" });
    }
  });
