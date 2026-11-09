import { test, expect, type Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  clickCommand,
  expectStatus,
  exportedProject,
  openProjectFile,
  renameProject,
  openEditor,
  openProject,
} from "./editor-fixtures.js";
import { placedInstance } from "./canvas-fixtures.js";

function fixture() {
  const project = createEmptyProject("netlist-edit", "Editable netlist");
  const document = project.documents[0]!;
  // This imported fixture represents a drawing saved before the new-label
  // defaults existed. Tests that exercise the new defaults start in the
  // Editor instead of importing this compatibility fixture.
  delete document.presentation.labelSubscriptAfterFirst;
  delete document.presentation.labelSubscriptItalic;
  for (const [index, id] of ["R1", "R2"].entries()) {
    document.instances.push({
      ...placedInstance(id, "resistor", 200 + index * 160, 200),
      reference: id,
      netlist: {
        binding: { kind: "primitive", deviceClass: "resistor" },
        parameters: { value: "10k" },
      },
    });
    document.annotations.push({
      id: `label-${id}`,
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: id },
      anchor: {
        kind: "object",
        objectId: id,
        localOffset: { x: 0, y: -30 },
        fallbackPosition: { x: 200 + index * 160, y: 170 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
  }
  for (const pinName of ["1", "2"])
    document.nets.push({
      id: `net-${pinName}`,
      terminals: ["R1", "R2"].map((instanceId) => ({ instanceId, pinName })),
    });
  return project;
}
const label = (page: Page) =>
  page.locator('[data-layer="annotations"] [data-object-id="label-R1"]');
const netlistAlert = (page: Page) =>
  page.getByRole("region", { name: "Live netlist" }).getByRole("alert");

/** Open the editor, wait until it is ready, then open this Project. */
async function openEditorOn(page: Page, project: object) {
  await openProject(page, project);
}

test("selects an export entry independently of saved Top and edits only that Cell", async ({
  page,
}) => {
  const project = fixture();
  const child = structuredClone(project.documents[0]!);
  child.id = "child";
  child.name = "Child";
  child.netlist!.name = "Child";
  for (const instance of child.instances)
    instance.netlist!.parameters.value = "20k";
  project.documents.push(child);
  await openEditorOn(page, project);
  const code = page.getByLabel("Netlist code", { exact: true });
  const entry = page.getByLabel("Netlist entry Cell", { exact: true });
  await expect(code).toContainText("10k");
  await entry.selectOption("child");
  await expect(code).toContainText("20k");
  await expect(code).not.toContainText("10k");
  await expect(page.getByTestId("active-document-id")).toHaveText(
    project.topDocumentId,
  );
  await expect(page.getByTestId("copy-netlist-panel")).toBeEnabled();
  await code.fill((await code.innerText()).replace("20k", "30k"));
  await code.press("Enter");
  await expect(entry).toBeEnabled();
  const saved = await exportedProject(page);
  expect(saved.topDocumentId).toBe(project.topDocumentId);
  expect(saved.documents[0].instances[0].netlist.parameters.value).toBe("10k");
  expect(saved.documents[1].instances[0].netlist.parameters.value).toBe("30k");
  await entry.selectOption("");
  await expect(code).toContainText("10k");
  await expect(code).not.toContainText("30k");
});

test("restores process and device choices, applies defaults and keeps edit/undo consistent", async ({
  page,
}) => {
  await openEditor(
    page,
    "/editor?example=current-mirror-loaded-differential-pair",
  );
  const code = page.getByLabel("Netlist code", { exact: true });
  // The editor works in SKY130, so the example opens bound to that process.
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8");
  await expect(code).not.toContainText("TODO");
  const mosLabel = page.locator(
    '[data-layer="annotations"] [data-object-id="instance-label-M1"]',
  );
  await expect(mosLabel).toHaveText("M1");
  const process = page.getByLabel("Netlist process", { exact: true });
  const format = page.getByLabel("Netlist format", { exact: true });
  await process.selectOption("abstract");
  await expect(code).toContainText("NMOS");
  await process.selectOption("sky130");
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8");
  await expect(code).toContainText("XM1");
  await expect(mosLabel).toHaveText("M1");
  await page.getByTestId("draw-tool-undo").click();
  await expect(code).toContainText("NMOS");
  await expect(code).not.toContainText("XM1");
  await page.getByTestId("draw-tool-redo").click();
  await expect(code).toContainText("XM1");
  await expect(mosLabel).toHaveText("M1");
  await format.selectOption("spectre");
  await page
    .getByLabel("NMOS netlist target", { exact: true })
    .selectOption("sky130_fd_pr__nfet_01v8_lvt");
  await expect(code).toContainText("simulator lang=spectre");
  await expect(code).not.toContainText("simulator lang=spice");
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8_lvt");
  await expect(code).not.toContainText("XM1");
  await expect(mosLabel).toHaveText("M1");
  await expect(page.getByTestId("copy-netlist-panel")).toBeVisible();
  const saved = await exportedProject(page);
  expect(
    saved.externalSubcircuitDefinitions.some(
      (definition: { name: string }) =>
        definition.name === "sky130_fd_pr__nfet_01v8_lvt",
    ),
  ).toBe(true);
  await clickCommand(page, "Netlist", "Netlist Settings…");
  const configuration = page.getByLabel("Netlist configuration JSON");
  const preferences = JSON.parse(await configuration.inputValue());
  preferences.format = "spice";
  await configuration.fill(JSON.stringify(preferences));
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8_lvt");
  await format.selectOption("spectre");
  await process.selectOption("abstract");
  await expect(code).toContainText("NMOS");
  await code.fill((await code.innerText()).replace(/^M1 /mu, "M_load "));
  await code.press("Enter");
  await expect(mosLabel).toContainText("Mload");
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await expect(format).toHaveValue("spice");
  await expect(code).toContainText("M_load");
});

test("explicit inspectors yield to Netlist for a replacement while ordinary edits preserve the panel choice", async ({
  page,
}) => {
  await openEditorOn(page, fixture());
  await page.getByTestId("hit-R1").dblclick();
  await expect(
    page.getByRole("complementary", { name: "Properties", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Editable Canvas property code")).toContainText(
    '"netlistName": "R1"',
  );
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(page.getByLabel("Netlist code", { exact: true })).toBeVisible();
  await page.getByTestId("statusbar-issues").click();
  await expect(
    page.getByRole("region", { name: "Project diagnostics" }),
  ).toBeVisible();
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toHaveCount(0);

  // Opening a different Project deliberately returns to its live Netlist,
  // regardless of the inspector the previous Project left open. The opened
  // file was never saved, so replacing it asks first (#2147).
  await openProjectFile(page, fixture());
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(code).toBeVisible();
  await expect(code).toContainText("R2");

  // An ordinary edit respects the workspace the reader explicitly chose.
  await page.getByTestId("netlist-panel-toggle").click();
  await renameProject(page, "Changed circuit name");
  await expect(page.getByTestId("project-name")).toHaveText(
    "Changed circuit name",
  );
  await expect(code).toHaveCount(0);
});

test("lists every netlist issue and shows the one clicked on the canvas", async ({
  page,
}) => {
  // Parts no netlist can describe; the panel used to name only the first.
  const project = createEmptyProject("netlist-issues", "Netlist issues");
  for (const [index, id] of ["D1", "D2"].entries())
    project.documents[0]!.instances.push({
      ...placedInstance(id, "unit-delay", 200 + index * 200, 200),
      reference: id,
    });
  await openEditorOn(page, project);
  const list = page.getByTestId("netlist-issues");
  const issues = page.getByTestId("netlist-issue");
  await expect(list).toContainText("2 issues");
  await expect(issues.nth(1)).toContainText("D2");
  await issues.nth(1).click();
  const halo = page.getByTestId("selection-halo-selected");
  await expect(halo.locator('[data-object-id="D2"]')).toBeVisible();
  await expect(halo.locator('[data-object-id="D1"]')).toHaveCount(0);
  // The list stays in the dock, one click from the next finding.
  await expect(list).toBeVisible();
  await expectStatus(
    page,
    "Netlist: Symbol unit-delay has no reviewed netlist definition",
  );
});

test("opens editable netlist by default, links cards and parts both ways, and synchronizes names and values with undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await openEditor(page);
  await expect(page.getByTestId("netlist-panel-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await openProjectFile(page, fixture());
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toHaveAttribute("contenteditable", "true");
  await expect(code).toContainText("R1");
  const halo = page.getByTestId("selection-halo-selected");
  const lit = code.locator(".cm-code-highlight");
  await expect(lit).toHaveCount(0);
  // Netlist to canvas: the card under the cursor lights its part, and only it.
  await code.locator(".cm-line").filter({ hasText: /^R1 /u }).click();
  await expect(halo.locator('[data-object-id="R1"]')).toBeVisible();
  await expect(halo.locator('[data-object-id="R2"]')).toHaveCount(0);
  await code.locator(".cm-line").filter({ hasText: /^R2 /u }).click();
  await expect(halo.locator('[data-object-id="R2"]')).toBeVisible();
  await expect(halo.locator('[data-object-id="R1"]')).toHaveCount(0);
  await code
    .locator(".cm-line")
    .filter({ hasText: /subckt/u })
    .click();
  await expect(halo).toHaveCount(0);
  // Canvas to netlist: the picked part's card lights, and only it.
  await page.getByTestId("hit-R2").click();
  await expect(lit.filter({ hasText: /^R2 /u })).toHaveCount(1);
  await expect(lit.filter({ hasText: /^R1 /u })).toHaveCount(0);
  // The clicked card's part lights beside the pick.
  await code.locator(".cm-line").filter({ hasText: /^R1 /u }).click();
  await expect(halo.locator('[data-object-id="R1"]')).toBeVisible();
  await expect(lit.filter({ hasText: /^R1 /u })).toHaveCount(1);
  // A new pick on the canvas takes over from the cursor's part.
  await page.getByTestId("hit-R1").click();
  await expect(halo.locator('[data-object-id="R2"]')).toHaveCount(0);
  await expect(lit.filter({ hasText: /^R1 /u })).toHaveCount(1);
  await expect(lit.filter({ hasText: /^R2 /u })).toHaveCount(0);
  const initial = await code.innerText();
  await code.fill(initial.replace("R1 ", "R_load ").replace("10k", "22k"));
  await code.press("Enter");
  await expect(label(page)).toContainText("Rload");
  const saved = await exportedProject(page);
  const instance = saved.documents[0].instances.find(
    (item: { id: string }) => item.id === "R1",
  );
  expect(instance.reference).toBe("R_load");
  expect(instance.netlist.parameters.value).toBe("22k");
  expect(instance.placement).toEqual(
    fixture().documents[0]!.instances[0]!.placement,
  );
  await page.getByTestId("draw-tool-undo").click();
  await expect(label(page)).toContainText("R1");
  await expect(code).toContainText("10k");
  await page.getByTestId("draw-tool-redo").click();
  await expect(label(page)).toContainText("Rload");
  await page.getByLabel("Netlist format").selectOption("spectre");
  await expect(code).toContainText("simulator lang=spectre");
  await code.fill((await code.innerText()).replace("R_load ", "R_final "));
  await code.press("Enter");
  await expect(label(page)).toContainText("Rfinal");
  expect(errors).toEqual([]);
});

test("rejects duplicate names atomically, retains a draft when the canvas changes, and Refresh drops cards the code adds or deletes", async ({
  page,
}) => {
  await openEditorOn(page, fixture());
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("R1");
  await code.fill((await code.innerText()).replace("R1 ", "R2 "));
  await code.press("Enter");
  await expect(netlistAlert(page)).toContainText("Edit rejected");
  await expect(label(page)).toContainText("R1");
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("R_canvas");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(netlistAlert(page)).toContainText("canvas or Agent changed");
  await expect(code).not.toContainText("R_canvas");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(code).toContainText("R_canvas");

  // Refresh regenerates the netlist from the circuit, dropping cards added
  // or deleted in the code.
  const alert = netlistAlert(page);
  const refresh = page.getByRole("button", { name: "Refresh netlist" });
  await expect(code).toContainText("R2 ");
  const generated = await code.innerText();
  // Deleting a card never reaches the circuit ...
  await code.fill(
    generated
      .split("\n")
      .filter((line) => !/^R2\s/u.test(line))
      .join("\n"),
  );
  await expect(alert).toContainText("Refresh regenerates the netlist");
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
  // ... and Refresh brings back the circuit's own netlist.
  await refresh.click();
  await expect(alert).toHaveCount(0);
  await expect(code).toContainText("R2 ");
  // Adding a card is no different: only the drawing adds parts.
  await code.fill(`${generated.trimEnd()}\nR9 a b 1k\n`);
  await expect(alert).toContainText("Refresh regenerates the netlist");
  await refresh.click();
  await expect(alert).toHaveCount(0);
  await expect(code).not.toContainText("R9");
  await expect(page.getByTestId("active-instance-count")).toHaveText("2");
});

test("an incomplete circuit shows a read-only draft linked to the canvas, and reopening Netlist preserves its data", async ({
  page,
}) => {
  const project = fixture();
  delete project.documents[0]!.instances[0]!.netlist!.parameters.value;
  await openEditorOn(page, project);
  const code = page.getByLabel("Netlist code", { exact: true });
  // A netlist that cannot print yet shows its draft, with ? for the value.
  await expect(code).toContainText("* Draft:");
  await expect(code).toContainText("R1 net0 net1 ?");
  await expect(netlistAlert(page)).toContainText("requires parameter value");
  const card = (reference: string) =>
    code
      .locator(".cm-line")
      .filter({ hasText: new RegExp(`^${reference} `, "u") });
  await expect(card("R1")).toHaveClass(/cm-code-warning/u);
  // A draft is for reading: it cannot be copied or edited.
  await expect(page.getByTestId("copy-netlist-panel")).toBeDisabled();
  await expect(code).toHaveAttribute("aria-readonly", "true");
  await expect(page.locator(".netlist-edit-hint")).toContainText("Draft");
  // The draft keeps the canvas link both ways.
  await page.getByTestId("hit-R1").click();
  await expect(card("R1")).toHaveClass(/cm-code-highlight/u);
  await expect(card("R2")).not.toHaveClass(/cm-code-highlight/u);
  await card("R2").click();
  await expect(
    page
      .getByTestId("selection-halo-selected")
      .locator('[data-object-id="R2"]'),
  ).toBeVisible();
  const revision = await page.getByTestId("revision").textContent();
  // The Netlist button closes the panel it opened, and opens it again.
  await page.getByTestId("netlist-panel-toggle").click();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(code).toContainText("R1 net0 net1 ?");
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  const saved = await exportedProject(page);
  expect(saved.documents[0].instances[0].netlist.parameters).not.toHaveProperty(
    "value",
  );
});

test("bound labels retain typography on rename and support manual scripts without an alias", async ({
  page,
}) => {
  await openEditorOn(page, fixture());
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  const alias = page.getByRole("checkbox", { name: "Use display alias" });
  await expect(alias).not.toBeChecked();
  for (const name of ["Bold", "Italic", "Subscript", "Superscript"])
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.fill("R7");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(label(page)).toHaveText("R7");
  const typefaces = () =>
    label(page)
      .locator("tspan")
      .evaluateAll((elements) =>
        elements
          .filter((el) => el.childElementCount === 0 && el.textContent)
          .map((el) => ({
            weight: getComputedStyle(el).fontWeight,
            style: getComputedStyle(el).fontStyle,
          })),
      );
  expect(await typefaces()).toEqual([{ weight: "700", style: "italic" }]);
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Shift+ArrowLeft");
  await page.getByRole("button", { name: "Subscript", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const saved = await exportedProject(page);
  const annotation = saved.documents[0].annotations.find(
    (item: { id: string }) => item.id === "label-R1",
  );
  expect(annotation.binding).toEqual({
    kind: "instance-reference",
    instanceId: "R1",
  });
  await expect(
    label(page).locator('[data-text-run="subscript"]'),
  ).toContainText("7");
  // Subscripting the 7 is styling: the Reference stays R7.
  expect(saved.documents[0].instances[0].reference).toBe("R7");
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("R7");
  await code.fill((await code.innerText()).replace("R7 ", "R8 "));
  await code.press("Enter");
  await expect(label(page)).toHaveText("R8");
  // The script keeps the label's weight but, like every script, is upright.
  expect(await typefaces()).toEqual([
    { weight: "700", style: "italic" },
    { weight: "700", style: "normal" },
  ]);
  // The author's subscript stays on the index through the rename.
  await expect(label(page).locator('[data-text-run="subscript"]')).toHaveText(
    "8",
  );
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await expect(alias).not.toBeChecked();
  await expect(editor.locator("sub")).toHaveText("8");
});
