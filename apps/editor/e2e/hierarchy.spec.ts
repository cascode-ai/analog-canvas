import { expect, test } from "@playwright/test";

import { clickCommand, downloadBytes } from "./editor-fixtures.js";

async function runCellCommand(
  page: import("@playwright/test").Page,
  name: "Manage Cells…" | "Place Cell",
): Promise<void> {
  // The hierarchy row only appears once there is a hierarchy to navigate, so
  // the first Cell is created from Edit.
  if (name === "Manage Cells…") {
    const row = page.getByTestId("cell-command-menu");
    if ((await row.count()) === 0) {
      await clickCommand(page, "Edit", "Manage Cells…");
      return;
    }
  }
  await page
    .getByTestId("cell-command-menu")
    .getByRole("button", { name, exact: true })
    .click();
}

async function createCell(
  page: import("@playwright/test").Page,
  name: string,
): Promise<void> {
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByRole("button", { name: "New Cell" }).click();
  const editor = page.getByRole("dialog", { name: "New Cell" });
  await editor.getByLabel("Cell name").fill(name);
  await editor.getByRole("button", { name: "Create" }).click();
}

async function placeCellPin(
  page: import("@playwright/test").Page,
  options: {
    name: string;
    direction?: "input" | "output" | "inout" | "passive";
    position: { x: number; y: number };
  },
): Promise<void> {
  await page.getByTestId("shapes-chip-port").click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: options.position });
  await page.keyboard.press("Escape");
  const shelf = page.getByTestId("selection-shelf");
  const wasExpanded = (await shelf.getAttribute("aria-expanded")) === "true";
  if (!wasExpanded) await shelf.click();
  const nameField = page.getByLabel("Cell Pin name");
  await nameField.fill(options.name);
  await nameField.blur();
  if (options.direction) {
    await page.getByLabel("Cell Pin direction").selectOption(options.direction);
  }
  // Leave the shelf as the caller found it so its own assertions still drive
  // the panel state.
  if (!wasExpanded) await shelf.click();
}

test("reviews an unreferenced top Symbol and places that DUT in an ordinary new TB", async ({
  page,
}) => {
  await page.goto("/editor");
  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByText("Review Symbol", { exact: true }).click();
  await expect(manager).toContainText("valid zero-port interface");
  await manager.getByLabel("Symbol width", { exact: true }).fill("160");
  await manager
    .getByRole("button", { name: "Apply Symbol", exact: true })
    .click();
  await manager.getByRole("button", { name: "Close Cell Manager" }).click();
  await createCell(page, "Testbench");
  await runCellCommand(page, "Place Cell");
  await page
    .getByRole("dialog", { name: "Place Hierarchical Cell" })
    .getByRole("option", { name: /Main/u })
    .click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 180 } });
  await page.keyboard.press("Escape");
  const project = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(project.topDocumentId).toBe("document-main");
  expect(
    project.documents.find((d: { id: string }) => d.id === "document-main")
      .presentation.cellSymbol.minimumBodySize.width,
  ).toBe(160);
  const tb = project.documents.find(
    (d: { name: string }) => d.name === "Testbench",
  );
  expect(tb.instances[0].netlist.binding).toEqual({
    kind: "subcircuit",
    childDocumentId: "document-main",
  });
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
});

test("shows the hierarchy row only once there is a hierarchy", async ({
  page,
}) => {
  await page.setViewportSize({ width: 420, height: 700 });
  await page.goto("/editor");

  // A flat Project has nothing to navigate, so the row stays out of the way
  // and the first Cell is created from Edit.
  const toolbar = page.locator('.toolbar-row[aria-label="Document hierarchy"]');
  // A negative count can succeed before the code-split editor route mounts.
  // Use the always-present Edit command as the positive startup anchor first.
  await expect(page.getByTestId("edit-manage-cells")).toHaveCount(1, {
    timeout: 15_000,
  });
  await expect(toolbar).toHaveCount(0);

  await createCell(page, "FirstStage");
  await expect(toolbar).toHaveCount(1);
  await expect(page.getByRole("button", { name: "Place Cell" })).toBeVisible();
  await expect(
    toolbar.getByRole("button", { name: "Edit Cell Interface…" }),
  ).toHaveCount(0);
  await expect(toolbar.getByRole("button", { name: /Preflight/u })).toHaveCount(
    0,
  );
  expect(
    await toolbar.evaluate((element) => element.getBoundingClientRect().height),
  ).toBeLessThan(90);
});

test("creates and deletes an unreferenced reusable Cell", async ({ page }) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");

  await expect(page.getByTestId("document-count")).toHaveText("2");
  await expect(page.getByTestId("document-selector")).toHaveValue(/document-/u);
  await expect(page.getByTestId("status")).toContainText(
    "Created Cell ReusableStage",
  );

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager.getByRole("button", { name: "Delete" }).last().click();
  const confirm = page.getByRole("dialog", { name: "Delete Cell" });
  await confirm.getByRole("button", { name: "Delete Cell" }).click();
  await expect(page.getByTestId("document-count")).toHaveText("1");
  await expect(page.getByTestId("active-document-id")).toHaveText(
    "document-main",
  );
  await expect(page.getByTestId("status")).toContainText(
    "Deleted Cell ReusableStage",
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("document-count")).toHaveText("2");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("document-count")).toHaveText("1");
});

test("manages Cell rename and lists callers", async ({ page }) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await runCellCommand(page, "Place Cell");
  const insert = page.getByRole("dialog", { name: "Place Hierarchical Cell" });
  await insert.getByRole("option", { name: /ReusableStage/u }).click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 180 } });
  await page.keyboard.press("Escape");

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await manager
    .getByRole("button", { name: /ReusableStage.*1 callers/u })
    .click();
  await expect(manager).toContainText("1 callers");
  await manager.getByRole("button", { name: "Rename" }).click();
  const rename = page.getByRole("dialog", { name: "Rename Cell" });
  await rename.getByLabel("Cell name").fill("Stage");
  await rename.getByRole("button", { name: "Rename" }).click();
  await expect(manager).toContainText("Stage");
  await manager.locator(".cell-manager-callers summary").click();
  await manager.getByRole("button", { name: "Jump to caller" }).click();
  await expect(page.getByTestId("active-document-id")).toHaveText(
    "document-main",
  );
});

test("declares and places a Cell Pin on a new local Net", async ({ page }) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");

  const canvas = page.getByTestId("schematic-canvas");
  await placeCellPin(page, {
    name: "Vout",
    direction: "output",
    position: { x: 300, y: 180 },
  });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");

  await page.getByTestId("selection-shelf").click();
  const portProperties = page.getByLabel("Cell Pin properties");
  await expect(portProperties).toBeVisible();
  const terminalName = portProperties.getByLabel("Cell Pin name");
  await expect(terminalName).toHaveValue("Vout");
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  const nameEditor = page.getByRole("textbox", { name: "Canvas text editor" });
  await expect(
    page.getByRole("toolbar", { name: "Text formatting" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-P1").click();
  await expect(terminalName).toHaveValue("Vout");
  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await nameEditor.fill("OUT");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Renamed Cell Pin to OUT",
  );
  await page.getByTestId("hit-P1").click();
  await expect(terminalName).toHaveValue("OUT");
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  const renamedPortProperties = page.getByLabel("Cell Pin properties");
  await renamedPortProperties
    .getByLabel("Cell Pin direction")
    .selectOption("input");
  await expect(page.getByTestId("status")).toContainText(
    "Updated Cell port direction",
  );

  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();
  await page
    .getByTestId("cell-command-menu")
    .getByRole("button", { name: "Place Cell" })
    .click();
  const insertDialog = page.getByRole("dialog", {
    name: "Place Hierarchical Cell",
  });
  await insertDialog.getByRole("option", { name: /ReusableStage/u }).click();
  await canvas.click({ position: { x: 420, y: 180 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(canvas.locator('[data-pin-name="OUT"]')).toHaveCount(1);

  await page.getByTestId("hit-X1").click();
  const layoutShelf = page.getByTestId("selection-shelf");
  if ((await layoutShelf.getAttribute("aria-expanded")) === "false") {
    await layoutShelf.click();
  }
  const layout = page.getByLabel("Cell symbol layout");
  await expect(layout).toBeVisible();
  await layout.getByLabel("Cell symbol width").fill("120");
  await layout.getByLabel("Cell symbol width").press("Tab");
  await expect(page.getByTestId("status")).toContainText(
    "Resized ReusableStage",
  );
  await layout.getByLabel("Cell symbol OUT pin side").selectOption("north");
  await expect(page.getByTestId("status")).toContainText(
    "Moved Cell symbol pin",
  );
  await layout
    .getByRole("button", { name: "Edit symbol layout on canvas" })
    .click();
  const layoutOverlay = page.getByTestId("cell-symbol-layout-overlay");
  await expect(layoutOverlay).toBeVisible();
  const bodyHandle = page.getByTestId("cell-symbol-body-handle");
  const bodyHandleBox = await bodyHandle.boundingBox();
  expect(bodyHandleBox).not.toBeNull();
  if (bodyHandleBox) {
    await page.mouse.move(
      bodyHandleBox.x + bodyHandleBox.width / 2,
      bodyHandleBox.y + bodyHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      bodyHandleBox.x + bodyHandleBox.width / 2 + 30,
      bodyHandleBox.y + bodyHandleBox.height / 2 + 30,
    );
    await page.mouse.up();
  }
  await expect(page.getByTestId("status")).toContainText(
    /Resized ReusableStage|Committed revision/u,
  );
  const pinHandle = page.locator('[data-testid^="cell-symbol-pin-handle-"]');
  const pinHandleBox = await pinHandle.boundingBox();
  expect(pinHandleBox).not.toBeNull();
  if (pinHandleBox) {
    await page.mouse.move(
      pinHandleBox.x + pinHandleBox.width / 2,
      pinHandleBox.y + pinHandleBox.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      pinHandleBox.x + pinHandleBox.width / 2 + 20,
      pinHandleBox.y + pinHandleBox.height / 2,
    );
    await page.mouse.up();
  }
  await expect(page.getByTestId("status")).toContainText(
    "Moved Cell symbol pin",
  );

  // Closing Properties must leave the transient grip mode too; otherwise the
  // selected Cell keeps suppressing its ordinary hit target.
  await layoutShelf.click();
  await expect(layoutOverlay).toBeHidden();
  await expect(page.getByTestId("hit-X1")).toBeVisible();

  await layoutShelf.click();
  await layout
    .getByRole("button", { name: "Edit symbol layout on canvas" })
    .click();
  await expect(layoutOverlay).toBeVisible();

  // A normal canvas click exits the mode before normal pointer handling. The
  // Cell can then use its normal direct-manipulation path again.
  await canvas.click({ position: { x: 40, y: 420 } });
  await expect(layoutOverlay).toBeHidden();
  const instanceHit = page.getByTestId("hit-X1");
  const beforeMove = await instanceHit.boundingBox();
  expect(beforeMove).not.toBeNull();
  if (beforeMove) {
    await page.mouse.move(
      beforeMove.x + beforeMove.width / 2,
      beforeMove.y + beforeMove.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(
      beforeMove.x + beforeMove.width / 2 + 40,
      beforeMove.y + beforeMove.height / 2,
    );
    await page.mouse.up();
    await expect
      .poll(async () => (await instanceHit.boundingBox())?.x ?? 0)
      .toBeGreaterThan(beforeMove.x + 10);
  }
});

test("declares a top Formal Cell Pin and exports the top interface", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "VIN",
    direction: "input",
    position: { x: 300, y: 180 },
  });
  await page.getByTestId("hit-P1").click();
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(page.getByLabel("Cell Pin properties")).toBeVisible();

  await clickCommand(page, "Netlist", "Check Report…");
  const preflight = page.getByRole("dialog", { name: "Check Report" });
  await expect(preflight.getByTestId("netlist-preview")).toContainText(
    ".subckt Main VIN",
  );
  await expect(preflight).not.toContainText("GENERATED_NET_NAME");
  await expect(preflight).not.toContainText("MISSING_DEVICE_DEFINITION");
});

test("copies and independently deletes Formal Cell Pins", async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.clear();
    window.sessionStorage.clear();
  });
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await placeCellPin(page, {
    name: "VIN",
    direction: "input",
    position: { x: 280, y: 180 },
  });

  await page.getByTestId("hit-P1").click();
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(page.getByLabel("Cell Pin properties")).toBeVisible();
  const canvasBox = await canvas.boundingBox();
  expect(canvasBox).not.toBeNull();
  await page.keyboard.press("c");
  await page.mouse.move(canvasBox!.x + 440, canvasBox!.y + 180);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 440, y: 180 } });
  await expect(page.getByTestId("status")).toContainText("Copied 1 components");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(page.getByLabel("Cell Pin properties")).toBeVisible();
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-P1-copy-1")).toBeVisible();
  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  await expect(page.getByTestId("hit-P1-copy-1")).toBeVisible();

  await page.getByTestId("hit-P1-copy-1").click();
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await expect(
    page.getByLabel("Cell Pin properties").getByLabel("Cell Pin name"),
  ).toHaveValue("VIN");
  await clickCommand(page, "Netlist", "Check Report…");
  await expect(
    page
      .getByRole("dialog", { name: "Check Report" })
      .getByTestId("netlist-preview"),
  ).toContainText(".subckt Main VIN");
});

test("edits a Cell Pin name and RichText presentation in place", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "VBIAS",
    position: { x: 300, y: 180 },
  });
  await expect(
    page.getByTestId("annotation-hit-instance-reference-P1"),
  ).toHaveCount(0);
  await page.getByTestId("hit-P1").click();
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  const netName = page.getByLabel("Cell Pin name");
  await expect(netName).toHaveValue("VBIAS");
  await expect(page.getByLabel("Cell Pin properties")).toBeVisible();

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await page.getByRole("button", { name: "Bold" }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-P1").click();
  await expect(netName).toHaveValue("VBIAS");

  await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill("VINP");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId("hit-P1").click();
  await expect(netName).toHaveValue("VINP");

  await clickCommand(page, "Netlist", "Check Report…");
  const preflight = page.getByRole("dialog", { name: "Check Report" });
  await expect(preflight).not.toContainText("MISSING_DEVICE_DEFINITION");
  await expect(preflight.getByTestId("netlist-preview")).toContainText(
    ".subckt Main VINP",
  );
});

test("returns a formal Cell Pin to the Tray without deleting its interface", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await placeCellPin(page, {
    name: "Vout",
    position: { x: 300, y: 180 },
  });
  await expect(
    page.getByTestId("annotation-hit-instance-label-P1"),
  ).toBeVisible();
  await expect(
    page.getByTestId("annotation-hit-instance-reference-P1"),
  ).toHaveCount(0);
  await page.getByTestId("hit-P1").click();
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  await page
    .getByRole("button", { name: "Return component to Placement Tray" })
    .click();

  await expect(page.getByTestId("status")).toContainText(
    "Cell interfaces and electrical facts were retained",
  );
  await expect(page.getByTestId("unplaced-P1")).toContainText("Vout · port");
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  await page
    .getByRole("region", { name: "Placement Tray" })
    .getByRole("button", { name: "Place all" })
    .click();
  await expect(page.getByTestId("hit-P1")).toBeVisible();
  await page.getByTestId("hit-P1").click();
  await expect(page.getByLabel("Cell Pin properties")).toBeVisible();
});

test("authors formal Cell parameters without entering Cell Symbol Layout", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await placeCellPin(page, {
    name: "Vout",
    position: { x: 300, y: 180 },
  });

  await runCellCommand(page, "Manage Cells…");
  const dialog = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(dialog.getByLabel("Formal terminal 1 name")).toHaveValue("Vout");
  await expect(
    dialog.getByText("Cell symbol layout", { exact: false }),
  ).toHaveCount(0);
  await dialog
    .getByLabel("Formal parameters")
    .getByRole("button", { name: "Add" })
    .click();
  await dialog.getByLabel("Formal parameter 1 name").fill("gain");
  await dialog.getByLabel("Formal parameter gain default").fill("10");
  await dialog.getByRole("button", { name: "Apply parameters" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Updated Cell formal parameters",
  );
  await dialog.getByRole("button", { name: "Close Cell Manager" }).click();
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("status")).toContainText("Committed revision");
});

test("deletes a wired child Cell Pin through the ordinary instance path", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await placeCellPin(page, {
    name: "Vout",
    position: { x: 300, y: 180 },
  });
  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("hit-P1")).toHaveCount(1);
});

test("places an existing Cell and blocks deleting its shared definition", async ({
  page,
}) => {
  await page.goto("/editor");
  await createCell(page, "ReusableStage");
  await page
    .getByTestId("cell-navigation")
    .getByRole("button", { name: "Top", exact: true })
    .click();

  await runCellCommand(page, "Place Cell");
  const dialog = page.getByRole("dialog", { name: "Place Hierarchical Cell" });
  await expect(
    dialog.getByRole("option", { name: /ReusableStage/u }),
  ).toBeVisible();
  await expect(dialog.getByTestId("insert-component-nmos")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await page.keyboard.press("i");
  const fullInsert = page.getByRole("dialog", { name: "Insert Component" });
  await expect(fullInsert.getByTestId("insert-component-nmos")).toBeVisible();
  await page.keyboard.press("Escape");

  await runCellCommand(page, "Place Cell");
  const cellDialog = page.getByRole("dialog", {
    name: "Place Hierarchical Cell",
  });
  await cellDialog.getByRole("option", { name: /ReusableStage/u }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 360, y: 230 } });
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toBeVisible();
  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /rotate\(90\)/u);
  await page.keyboard.press("Shift+R");
  await expect(preview).toHaveAttribute("transform", /scale\(-1 1\)/u);
  await canvas.click({ position: { x: 360, y: 230 } });
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  await expect(page.getByTestId("status")).toContainText(
    "Placed ReusableStage as X1",
  );
  await expect(canvas.locator('[data-kind="instance-value"]')).toContainText(
    "ReusableStage",
  );
  await expect(canvas.locator('[data-kind="instance-label"]')).toContainText(
    "X1",
  );
  await page.keyboard.press("Escape");

  await runCellCommand(page, "Manage Cells…");
  const manager = page.getByRole("dialog", { name: "Cell Manager" });
  await expect(
    manager.getByRole("button", { name: "Delete" }).last(),
  ).toBeDisabled();
  await expect(page.getByTestId("document-count")).toHaveText("2");
});

test("allows distinct Cell Pins to expose one internal contact", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await page.getByTestId("shapes-chip-port").click();
  await canvas.click({ position: { x: 240, y: 200 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("shapes-chip-port").click();
  await canvas.click({ position: { x: 240, y: 200 } });
  // The existing Port is the visible current Net name, so a second Cell Pin
  // placed on the same contact adopts it while retaining independent identity.
  await expect(page.getByTestId("status")).toContainText("Added Cell Pin Vin");
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-P1")).toBeVisible();
  await expect(page.getByTestId("hit-P2")).toBeVisible();
});

test("renaming one Cell Pin leaves another interface Pin alone", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "Vother",
    position: { x: 260, y: 180 },
  });
  await placeCellPin(page, {
    name: "Vshared",
    position: { x: 260, y: 320 },
  });

  const labels = page.locator(
    '[data-testid^="annotation-hit-instance-label-"]',
  );
  await expect(labels).toHaveCount(2);

  await page.getByTestId("hit-P2").click();
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false")
    await shelf.click();
  const nameField = page.getByLabel("Cell Pin name");
  await nameField.fill("Vbias");
  await nameField.blur();

  await expect(page.getByTestId("status")).toContainText("Renamed Cell Pin");
  const texts = await page
    .locator('[data-testid="schematic-canvas"] text')
    .allTextContents();
  expect(texts).toContain("Vother");
  expect(texts).toContain("Vbias");
});

test("same-name Cell Pins stay independent while the final interface groups them", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeCellPin(page, {
    name: "VIN",
    direction: "input",
    position: { x: 260, y: 180 },
  });
  await placeCellPin(page, {
    name: "ALIAS",
    direction: "output",
    position: { x: 260, y: 320 },
  });

  await page.getByTestId("hit-P2").click();
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "false") {
    await shelf.click();
  }
  const nameField = page.getByLabel("Cell Pin name");
  await nameField.fill("vin");
  await nameField.blur();

  await expect(page.getByTestId("status")).toContainText("Renamed Cell Pin");
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      netlist: {
        terminals: Array<{
          id: string;
          name: string;
          netId: string;
          direction: string;
          interfaceInstanceIds: string[];
        }>;
      };
    }>;
  };
  const terminals = saved.documents[0]!.netlist.terminals;
  expect(terminals).toHaveLength(2);
  expect(terminals.map((terminal) => terminal.name.toLowerCase())).toEqual([
    "vin",
    "vin",
  ]);
  expect(new Set(terminals.map((terminal) => terminal.id)).size).toBe(2);
  expect(new Set(terminals.map((terminal) => terminal.netId)).size).toBe(2);
  expect(terminals.map((terminal) => terminal.direction)).toEqual([
    "input",
    "output",
  ]);
  expect(terminals.map((terminal) => terminal.interfaceInstanceIds)).toEqual([
    ["P1"],
    ["P2"],
  ]);

  await clickCommand(page, "Netlist", "Check Report…");
  const preview = await page
    .getByRole("dialog", { name: "Check Report" })
    .getByTestId("netlist-preview")
    .innerText();
  expect(preview).toContain(".subckt Main VIN");
  expect(preview).not.toContain("ALIAS");
  await page.getByTestId("check-report-close").click();

  await page.getByTestId("hit-P2").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P2")).toHaveCount(0);
  await expect(page.getByTestId("hit-P1")).toBeVisible();
});
