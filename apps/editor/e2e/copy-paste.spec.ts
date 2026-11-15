// Copying with C and C/V: fresh identities, the copy ghost, turning before
// placing, and repeated placement.

import {
  exportedProject,
  awaitEditorReady,
  clickDrawTool,
  expectStatus,
  setComponentCodeField,
  expectRecoveredRevision,
  openProject,
} from "./editor-fixtures";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { busReuseProject } from "./bus-reuse-fixtures";
import { expect, test } from "@playwright/test";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { centre, copySelectionAt, drawWire } from "./canvas-fixtures.js";

const documentsWithoutRevision = (project: CircuitProject) =>
  project.documents.map((document) => ({ ...document, revision: 0 }));

test("moves and copies converted bus groups across tabs with member bindings, history and recovery", async ({
  page,
}) => {
  await openProject(page, serializeProject(busReuseProject()));
  const original: CircuitProject = await exportedProject(page);
  const originalTop = original.documents.find((cell) => cell.id === "top")!;
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+a");
  const start = centre((await page.getByTestId("hit-X1").boundingBox())!);
  await page.mouse.move(start.x, start.y);
  await page.keyboard.press("m");
  await page.keyboard.down("Alt");
  await page.mouse.move(start.x + 70, start.y + 40, { steps: 3 });
  await page.mouse.click(start.x + 70, start.y + 40);
  await page.keyboard.up("Alt");
  const moved: CircuitProject = await exportedProject(page);
  const movedTop = moved.documents.find((cell) => cell.id === "top")!;
  const first = movedTop.instances.find((instance) => instance.id === "X1")!
    .placement!.position;
  const delta = { x: first.x - 400, y: first.y - 200 };
  expect(Math.hypot(delta.x, delta.y)).toBeGreaterThan(0);
  for (const instance of originalTop.instances) {
    expect(
      movedTop.instances.find((item) => item.id === instance.id)!.placement!
        .position,
    ).toEqual({
      x: instance.placement!.position.x + delta.x,
      y: instance.placement!.position.y + delta.y,
    });
  }
  for (const junction of originalTop.junctions)
    expect(
      movedTop.junctions.find((item) => item.id === junction.id)!.position,
    ).toEqual({
      x: junction.position.x + delta.x,
      y: junction.position.y + delta.y,
    });
  expect(movedTop.nets).toEqual(originalTop.nets);
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect(documentsWithoutRevision(await exportedProject(page))).toEqual(
    documentsWithoutRevision(original),
  );
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 380, y: 280 } });
  const ghost = page.getByTestId("copy-placement-preview");
  await expect(ghost).toBeVisible();
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+r");
  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await canvas.hover({ position: { x: 380, y: 280 } });
  await expect(ghost).toBeVisible();
  const blank: CircuitProject = await exportedProject(page);
  await page.keyboard.press("Escape");
  expect((await exportedProject(page)).documents).toEqual(blank.documents);
  await page.keyboard.press("v");
  await canvas.hover({ position: { x: 380, y: 280 } });
  await expect(ghost).toBeVisible();
  await page.keyboard.press("r");
  await page.keyboard.press("Shift+r");
  await canvas.click({ position: { x: 400, y: 300 } });
  await page.keyboard.press("Escape");
  const copied: CircuitProject = await exportedProject(page);
  const target = copied.documents.find(
    (cell) => cell.id === copied.topDocumentId,
  )!;
  const child = copied.documents.find(
    (cell) => cell.id !== copied.topDocumentId,
  )!;
  expect(target.instances).toHaveLength(2);
  const copiedPositions = target.instances.map(
    (instance) => instance.placement!.position,
  );
  expect({
    x: copiedPositions[1]!.x - copiedPositions[0]!.x,
    y: copiedPositions[1]!.y - copiedPositions[0]!.y,
  }).toEqual({ x: 200, y: 250 });
  expect(copied.documents).toHaveLength(2);
  expect(child.netlist!.terminals[0]!.signal!.expression).toBe("IN<1:0>");
  expect(
    child.netlist!.terminals[0]!.signal!.members.map((member) => member.id),
  ).not.toEqual(
    original.documents
      .find((cell) => cell.id === "child")!
      .netlist!.terminals[0]!.signal!.members.map((member) => member.id),
  );
  const claim = target.connectivityEvidence.find(
    (item) =>
      item.kind === "name-claim" && item.signal?.expression === "DATA<1:0>",
  )!;
  expect(claim.kind).toBe("name-claim");
  if (claim.kind !== "name-claim" || claim.owner.kind !== "net-label")
    throw new Error("Copied naming owner missing");
  const labelId = claim.owner.annotationId;
  const label = target.annotations.find((item) => item.id === labelId)!;
  expect(label.formatOverride).toEqual(
    movedTop.annotations.find((item) => item.id === "label")!.formatOverride,
  );
  expect(label.sizeScale).toBe(1.25);
  expect(
    target.annotations.some(
      (item) =>
        item.binding?.kind === "net-name" && item.binding.memberEndpoint,
    ),
  ).toBe(true);
  expect(target.routes.filter((route) => route.members).length).toBe(
    movedTop.routes.filter((route) => route.members).length,
  );
  expect(
    target.nets.every((net) => !movedTop.nets.some((old) => old.id === net.id)),
  ).toBe(true);
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+z");
  expect(documentsWithoutRevision(await exportedProject(page))).toEqual(
    documentsWithoutRevision(blank),
  );
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const restored: CircuitProject = await exportedProject(page);
  expect(documentsWithoutRevision(restored)).toEqual(
    documentsWithoutRevision(copied),
  );
  await expectRecoveredRevision(
    page,
    restored.documents.find((cell) => cell.id === restored.topDocumentId)!
      .revision,
  );
  await page.reload();
  await awaitEditorReady(page);
  expect(documentsWithoutRevision(await exportedProject(page))).toEqual(
    documentsWithoutRevision(copied),
  );
  await openProject(page, serializeProject(restored));
  expect((await exportedProject(page)).documents).toEqual(restored.documents);
});

test("keeps a captured bus snapshot after source rename and reuses its child on repeated cross-tab paste", async ({
  page,
}) => {
  await openProject(page, serializeProject(busReuseProject()));
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.focus();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 380, y: 280 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("annotation-hit-label").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("RENAMED<1:0>");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const migration = page.getByRole("dialog", { name: "Update bus Label" });
  await migration
    .getByLabel("Map DATA<1>", { exact: true })
    .selectOption({ label: "RENAMED<1>" });
  await migration
    .getByLabel("Map DATA<0>", { exact: true })
    .selectOption({ label: "RENAMED<0>" });
  await migration.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(
    migration,
    (await page.getByTestId("status").textContent()) ??
      "Label migration status",
  ).toBeHidden();
  const renamed: CircuitProject = await exportedProject(page);
  expect(
    renamed.documents[0]!.connectivityEvidence.some(
      (item) => item.kind === "name-claim" && item.name === "RENAMED<1:0>",
    ),
  ).toBe(true);

  await page
    .getByRole("button", { name: "New project tab", exact: true })
    .click();
  for (const point of [
    { x: 260, y: 240 },
    { x: 620, y: 480 },
  ]) {
    await canvas.focus();
    await page.keyboard.press("v");
    await canvas.hover({ position: { x: 380, y: 280 } });
    await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
    await canvas.click({ position: point });
    await page.keyboard.press("Escape");
  }
  const copied: CircuitProject = await exportedProject(page);
  const top = copied.documents.find(
    (cell) => cell.id === copied.topDocumentId,
  )!;
  expect(copied.documents).toHaveLength(2);
  expect(top.instances).toHaveLength(4);
  expect(
    top.connectivityEvidence
      .filter((item) => item.kind === "name-claim")
      .map((item) => item.kind === "name-claim" && item.name),
  ).toEqual(["DATA<1:0>", "DATA<1:0>"]);
  const childIds = top.instances
    .map((instance) => instance.netlist?.binding)
    .map(
      (binding) => binding?.kind === "subcircuit" && binding.childDocumentId,
    );
  expect(new Set(childIds).size).toBe(1);
  const firstMembers = top.routes
    .filter((route) => route.members)
    .map((route) => route.members![0]!.id);
  expect(new Set(firstMembers).size).toBe(firstMembers.length);
  await page.getByRole("tab", { name: /Bus reuse source$/ }).click();
  expect((await exportedProject(page)).documents).toEqual(renamed.documents);
});

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
  await expectRecoveredRevision(page, Number(revision));
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
