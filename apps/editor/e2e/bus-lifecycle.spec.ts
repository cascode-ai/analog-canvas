import { expect, test } from "@playwright/test";
import {
  createEmptyProject,
  createRoutePath,
  type CircuitProject,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  openProject,
  exportedProject,
  revealPropertiesShelf,
  editComponentPropertyCode,
} from "./editor-fixtures.js";
import { clickRoute, placedInstance } from "./canvas-fixtures.js";
import { openSelectionShelf } from "./manual-editor-fixtures.js";

function legacyLabelProject() {
  const project = createEmptyProject("legacy-label-ui", "Legacy Label");
  const cell = project.documents[0]!;
  cell.nets.push({ id: "old-net", terminals: [] });
  cell.junctions.push(
    { id: "a", netId: "old-net", position: { x: 200, y: 200 } },
    { id: "b", netId: "old-net", position: { x: 500, y: 200 } },
  );
  cell.routes.push(
    createRoutePath({
      id: "wire",
      netId: "old-net",
      start: { kind: "junction", junctionId: "a" },
      end: { kind: "junction", junctionId: "b" },
      bends: [],
      modes: ["manual"],
    }),
  );
  cell.annotations.push({
    id: "label",
    kind: "net-label",
    netId: "old-net",
    binding: { kind: "net-name", netId: "old-net" },
    anchor: { kind: "free", position: { x: 350, y: 180 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  cell.connectivityEvidence.push({
    id: "claim",
    kind: "name-claim",
    netId: "old-net",
    name: "DATA[1:0]",
    scope: "local",
    owner: { kind: "net-label", annotationId: "label" },
  });
  return project;
}

test("explicitly converts a legacy Label, cancels safely, and preserves migration through undo and reopening", async ({
  page,
}) => {
  await openProject(page, serializeProject(legacyLabelProject()));
  const before: CircuitProject = await exportedProject(page);
  await page.getByTestId("annotation-hit-label").click();
  await revealPropertiesShelf(page);
  if (
    (await page
      .getByTestId("selection-shelf")
      .getAttribute("aria-expanded")) === "false"
  )
    await page.getByTestId("selection-shelf").click();
  await page.getByRole("button", { name: "Convert to bus…" }).click();
  let dialog = page.getByRole("dialog", { name: "Convert Label to bus" });
  await expect(dialog.getByLabel("Target signal expression")).toHaveValue(
    "DATA[1:0]",
  );
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Convert", exact: true }),
  ).toBeDisabled();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await exportedProject(page)).documents).toEqual(before.documents);
  await page.getByTestId("annotation-hit-label").click();
  await revealPropertiesShelf(page);
  if (
    (await page
      .getByTestId("selection-shelf")
      .getAttribute("aria-expanded")) === "false"
  )
    await page.getByTestId("selection-shelf").click();
  await page.getByRole("button", { name: "Convert to bus…" }).click();
  dialog = page.getByRole("dialog", { name: "Convert Label to bus" });
  await dialog.getByLabel("Target signal expression").fill("DATA<1:0>");
  await expect(dialog.getByLabel("Signal member preview")).toHaveText(
    "2 members · DATA<1> → DATA<0>",
  );
  await dialog.getByLabel("Map DATA[1:0]").selectOption({ label: "DATA<1>" });
  await dialog.getByLabel("Target signal expression").fill("DATA<0:1>");
  await expect(dialog.getByLabel("Map DATA[1:0]")).toHaveValue("");
  await expect(
    dialog.getByRole("button", { name: "Convert", exact: true }),
  ).toBeDisabled();
  await dialog.getByLabel("Target signal expression").fill("DATA<1:>");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await dialog.getByLabel("Target signal expression").fill("DATA<1:0>");
  await dialog.getByLabel("Map DATA[1:0]").selectOption({ label: "DATA<1>" });
  await dialog.getByRole("button", { name: "Convert", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const converted: CircuitProject = await exportedProject(page);
  expect(
    converted.documents[0]!.routes.find((route) => route.id === "wire")!
      .members,
  ).toHaveLength(2);
  await page.keyboard.press("ControlOrMeta+z");
  const undone: CircuitProject = await exportedProject(page);
  expect(
    undone.documents.map((document, index) => ({
      ...document,
      revision: before.documents[index]!.revision,
    })),
  ).toEqual(before.documents);
  await page.keyboard.press("ControlOrMeta+Shift+z");
  const redone: CircuitProject = await exportedProject(page);
  expect(
    redone.documents.map((document, index) => ({
      ...document,
      revision: converted.documents[index]!.revision,
    })),
  ).toEqual(converted.documents);
  await openProject(page, serializeProject(converted));
  expect((await exportedProject(page)).documents).toEqual(converted.documents);
  const ids = converted.documents[0]!.routes.find(
    (route) => route.id === "wire",
  )!.members!.map((member) => member.id);
  const memberMenu = page.getByLabel("Inspect member", { exact: true });
  await clickRoute(page, "wire");
  await openSelectionShelf(page);
  await expect(memberMenu.getByRole("option")).toHaveText([
    "Choose a member…",
    "DATA<1> · On a Net",
    "DATA<0> · On a Net",
  ]);
  await page.getByTestId("annotation-hit-label").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("INPUT<0:1>");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const rename = page.getByRole("dialog", { name: "Update bus Label" });
  await expect(
    rename.getByRole("button", { name: "Apply", exact: true }),
  ).toBeDisabled();
  await rename
    .getByLabel("Map DATA<1>", { exact: true })
    .selectOption({ label: "INPUT<1>" });
  await rename
    .getByLabel("Map DATA<0>", { exact: true })
    .selectOption({ label: "INPUT<0>" });
  await rename.getByRole("button", { name: "Apply", exact: true }).click();
  await expect(rename).toHaveCount(0);
  const renamed: CircuitProject = await exportedProject(page);
  expect(
    renamed.documents[0]!.routes.find(
      (route) => route.id === "wire",
    )!.members!.map((member) => member.id),
  ).toEqual([ids[1], ids[0]]);
  await clickRoute(page, "wire");
  await openSelectionShelf(page);
  await expect(memberMenu.getByRole("option")).toHaveText([
    "Choose a member…",
    "INPUT<0> · On a Net",
    "INPUT<1> · On a Net",
  ]);
  await memberMenu.selectOption({ label: "INPUT<1> · On a Net" });
  await expect(memberMenu).toHaveValue(ids[0]!);
  await page.getByRole("button", { name: "Trace member" }).click();
  await expect(
    page.getByText("Highlighted Net old-net", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("annotation-hit-label").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .press("ControlOrMeta+A");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const styled: CircuitProject = await exportedProject(page);
  expect(styled.documents[0]!.connectivityEvidence).toEqual(
    renamed.documents[0]!.connectivityEvidence,
  );
  expect(styled.documents[0]!.routes).toEqual(renamed.documents[0]!.routes);
  expect(
    styled.documents[0]!.annotations.find(
      (annotation) => annotation.id === "label",
    )!.formatOverride,
  ).not.toEqual(
    renamed.documents[0]!.annotations.find(
      (annotation) => annotation.id === "label",
    )!.formatOverride,
  );
  await page.getByTestId("annotation-hit-label").click();
  await revealPropertiesShelf(page);
  if (
    (await page
      .getByTestId("selection-shelf")
      .getAttribute("aria-expanded")) === "false"
  )
    await page.getByTestId("selection-shelf").click();
  await editComponentPropertyCode(page, (code) => {
    code.display.visible = false;
  });
  await expect(page.getByTestId("annotation-hit-label")).toHaveCount(0);
  const hidden: CircuitProject = await exportedProject(page);
  expect(
    hidden.documents[0]!.annotations.find(
      (annotation) => annotation.id === "label",
    )!.visible,
  ).toBe(false);
  expect(hidden.documents[0]!.connectivityEvidence).toEqual(
    renamed.documents[0]!.connectivityEvidence,
  );
  expect(hidden.documents[0]!.routes).toEqual(renamed.documents[0]!.routes);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("annotation-hit-label")).toBeVisible();
  await page.getByTestId("annotation-hit-label").click();
  await page.keyboard.press("Delete");
  const deleted: CircuitProject = await exportedProject(page);
  expect(
    deleted.documents[0]!.annotations.some(
      (annotation) => annotation.id === "label",
    ),
  ).toBe(false);
  expect(deleted.documents[0]!.routes).toEqual(renamed.documents[0]!.routes);
  expect(
    deleted.documents[0]!.connectivityEvidence.filter(
      (item) => item.kind === "name-claim",
    ),
  ).toHaveLength(0);
});

test("converts a legacy Cell Pin through the same explicit member mapping dialog", async ({
  page,
}) => {
  const project = createEmptyProject("legacy-pin-ui", "Legacy Pin");
  const cell = project.documents[0]!;
  cell.instances.push(placedInstance("P1", "port", 300, 200));
  cell.instances.push({
    ...placedInstance("R1", "resistor", 500, 200),
    reference: "R1",
    netlist: { parameters: { value: "1k" } },
  });
  cell.nets.push({
    id: "old",
    terminals: [
      { instanceId: "P1", pinName: "P" },
      { instanceId: "R1", pinName: "1" },
    ],
  });
  cell.netlist!.terminals.push({
    id: "formal",
    name: "DATA[1:0]",
    netId: "old",
    direction: "input",
    interfaceInstanceIds: ["P1"],
  });
  cell.annotations.push({
    id: "pin-label",
    kind: "instance-label",
    binding: { kind: "cell-terminal-name", terminalId: "formal" },
    anchor: {
      kind: "object",
      objectId: "P1",
      localOffset: { x: 0, y: -20 },
      fallbackPosition: { x: 300, y: 180 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  await openProject(page, serializeProject(project));
  await page.getByTestId("hit-P1").click();
  await revealPropertiesShelf(page);
  if (
    (await page
      .getByTestId("selection-shelf")
      .getAttribute("aria-expanded")) === "false"
  )
    await page.getByTestId("selection-shelf").click();
  await page.getByRole("button", { name: "Convert to bus…" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("button", { name: /Convert/ })).toBeDisabled();
  await dialog.getByLabel("Target signal expression").fill("DATA<1:0>");
  await dialog.getByLabel("Map DATA[1:0]").selectOption({ label: "DATA<0>" });
  await dialog.getByRole("button", { name: /Convert/ }).click();
  await expect(dialog).toHaveCount(0);
  const converted: CircuitProject = await exportedProject(page);
  expect(
    converted.documents[0]!.netlist!.terminals[0]!.signal!.members.map(
      (member) => member.name,
    ),
  ).toEqual(["DATA<1>", "DATA<0>"]);
  const ids =
    converted.documents[0]!.netlist!.terminals[0]!.signal!.members.map(
      (member) => member.id,
    );
  await page.getByTestId("annotation-hit-pin-label").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("INPUT<0:1>");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const rename = page.getByRole("dialog", {
    name: "Change Cell signal members?",
  });
  await rename
    .getByLabel("Map DATA<1>", { exact: true })
    .selectOption({ label: "INPUT<1>" });
  await rename
    .getByLabel("Map DATA<0>", { exact: true })
    .selectOption({ label: "INPUT<0>" });
  await rename.getByRole("button", { name: "Apply Member Changes" }).click();
  await expect(rename).toHaveCount(0);
  const renamed: CircuitProject = await exportedProject(page);
  expect(
    renamed.documents[0]!.netlist!.terminals[0]!.signal!.members.map(
      (member) => member.id,
    ),
  ).toEqual([ids[1], ids[0]]);
  await page.getByTestId("annotation-hit-pin-label").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("INPUT<0>");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const reduce = page.getByRole("dialog", {
    name: "Change Cell signal members?",
  });
  await reduce
    .getByLabel("Map INPUT<1>", { exact: true })
    .selectOption({ label: "Disconnect · keep wire stubs" });
  await reduce.getByRole("button", { name: "Apply Member Changes" }).click();
  await expect(reduce).toHaveCount(0);
  const reduced: CircuitProject = await exportedProject(page);
  expect(
    reduced.documents[0]!.netlist!.terminals[0]!.signal!.members.map(
      (member) => member.id,
    ),
  ).toEqual([ids[1]]);
  await page.getByTestId("annotation-hit-pin-label").dblclick();
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("Data input");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  const aliased: CircuitProject = await exportedProject(page);
  expect(aliased.documents[0]!.netlist!.terminals).toEqual(
    reduced.documents[0]!.netlist!.terminals,
  );
  expect(aliased.documents[0]!.nets).toEqual(reduced.documents[0]!.nets);
  expect(
    aliased.documents[0]!.annotations.find(
      (annotation) => annotation.id === "pin-label",
    )!.binding,
  ).toBeUndefined();
  await openProject(page, serializeProject(aliased));
  expect((await exportedProject(page)).documents).toEqual(aliased.documents);
});
