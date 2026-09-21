import { parseSavedProject } from "./editor-fixtures";
import { test, expect } from "@playwright/test";
import { openSelectionShelf } from "./manual-editor-fixtures.js";
import { createEmptyProject } from "@icm/model";
import {
  awaitEditorReady,
  clickCommand,
  editComponentPropertyCode,
  downloadBytes,
} from "./editor-fixtures.js";

function fixture() {
  const project = createEmptyProject("netlist-edit", "Editable netlist");
  const document = project.documents[0]!;
  for (const [index, id] of ["R1", "R2"].entries()) {
    document.instances.push({
      id,
      reference: id,
      symbolId: "resistor",
      placement: {
        position: { x: 200 + index * 160, y: 200 },
        rotation: 0,
        mirror: "none",
      },
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
const label = (page: import("@playwright/test").Page) =>
  page.locator('[data-layer="annotations"] [data-object-id="label-R1"]');

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
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "entries.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const code = page.getByLabel("Netlist code", { exact: true });
  const entry = page.getByLabel("Netlist entry Cell", { exact: true });
  await expect(code).toContainText("10k");
  await entry.selectOption("child");
  await expect(code).toContainText("20k");
  await expect(code).not.toContainText("10k");
  await expect(page.getByTestId("document-selector")).toHaveValue(
    project.topDocumentId,
  );
  await expect(page.getByTestId("copy-netlist-panel")).toHaveCount(0);
  await code.fill((await code.innerText()).replace("20k", "30k"));
  await code.press("Enter");
  await expect(entry).toBeEnabled();
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
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
  await page.goto("/editor?example=current-mirror-loaded-differential-pair");
  await awaitEditorReady(page);
  const code = page.getByLabel("Netlist code", { exact: true });
  // The editor works in SKY130, so the example opens bound to that process.
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8");
  await expect(code).not.toContainText("TODO");
  const mosLabel = page.locator(
    '[data-layer="annotations"] [data-object-id="instance-label-M1"]',
  );
  await expect(mosLabel).toHaveText("M1");
  const process = page.getByLabel("Netlist process", { exact: true });
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
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spectre");
  await page
    .getByLabel("NMOS netlist target", { exact: true })
    .selectOption("sky130_fd_pr__nfet_01v8_lvt");
  await expect(code).toContainText("simulator lang=spectre");
  await expect(code).not.toContainText("simulator lang=spice");
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8_lvt");
  await expect(code).not.toContainText("XM1");
  await expect(mosLabel).toHaveText("M1");
  await expect(page.getByTestId("copy-netlist-panel")).toHaveCount(0);
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
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
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spectre");
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spice");
  await code.fill((await code.innerText()).replace(/^XM1 /mu, "XM_load "));
  await code.press("Enter");
  await expect(mosLabel).toHaveText("Mload");
  await expect(code).toContainText("XM_load");
  await page.getByTestId("draw-tool-undo").click();
  await expect(mosLabel).toHaveText("M1");
  await expect(code).toContainText("XM1");
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spectre");
  await process.selectOption("tsmc28");
  await expect(code).toContainText("nch_ulvt_mac");
  await expect(code).toContainText("simulator lang=spectre");
  await process.selectOption("tsmc180");
  await expect(code).toContainText(" nch ");
  await process.selectOption("abstract");
  await expect(code).toContainText("NMOS");
  await code.fill((await code.innerText()).replace(/^M1 /mu, "M_load "));
  await code.press("Enter");
  await expect(
    page.locator(
      '[data-layer="annotations"] [data-object-id="instance-label-M1"]',
    ),
  ).toContainText("Mload");
  await page.getByRole("button", { name: "Default", exact: true }).click();
  await expect(page.getByLabel("Netlist format", { exact: true })).toHaveValue(
    "spice",
  );
  await expect(code).toContainText("M_load");
});

test("opens a built-in formatted device name with alias off and follows netlist renames", async ({
  page,
}) => {
  await page.goto("/editor?example=common-source-amplifier");
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText("Opened example:");
  const capacitorLabel = page.locator(
    '[data-layer="annotations"] [data-object-id="instance-label-C1"]',
  );
  await expect(capacitorLabel).toContainText("CGS");
  await page.getByTestId("annotation-hit-instance-label-C1").dblclick();
  await expect(
    page.getByRole("checkbox", { name: "Use display alias" }),
  ).not.toBeChecked();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toHaveAttribute("contenteditable", "true");
  await code.fill((await code.innerText()).replace(/^CGS /mu, "C_input "));
  await code.press("Enter");
  await expect(capacitorLabel).toContainText("Cinput");
  await page.getByTestId("annotation-hit-instance-label-C1").dblclick();
  await expect(
    page.getByRole("checkbox", { name: "Use display alias" }),
  ).not.toBeChecked();
});

test("explicit inspectors yield to Netlist for a replacement while ordinary edits preserve the panel choice", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "editable.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await page.getByTestId("hit-R1").dblclick();
  await expect(
    page.getByRole("complementary", { name: "Properties", exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("Editable Canvas property code")).toContainText(
    '"netlistName": "R1"',
  );
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(page.getByLabel("Netlist code", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: /Open Issues/u }).click();
  await expect(
    page.getByRole("region", { name: "Project diagnostics" }),
  ).toBeVisible();
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toHaveCount(0);

  // Opening a different Project deliberately returns to its live Netlist,
  // regardless of the inspector the previous Project left open.
  await page.getByTestId("project-file").setInputFiles({
    name: "replacement.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await expect(code).toBeVisible();
  await expect(code).toContainText("R2");

  // An ordinary edit respects the workspace the reader explicitly chose.
  await page.getByTestId("netlist-panel-toggle").click();
  await page.getByTestId("project-menu-toggle").click();
  await page.getByTestId("project-name-input").fill("Changed circuit name");
  await page.getByTestId("project-name-input").press("Enter");
  await expect(page.getByTestId("project-name-input")).toHaveValue(
    "Changed circuit name",
  );
  await expect(code).toHaveCount(0);
});

test("opens editable netlist by default, highlights a card, and synchronizes names and values with undo", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/editor");
  await awaitEditorReady(page);
  await expect(page.getByTestId("netlist-panel-toggle")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.getByTestId("project-file").setInputFiles({
    name: "editable.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toHaveAttribute("contenteditable", "true");
  await expect(code).toContainText("R1");
  await code.locator(".cm-line").filter({ hasText: /^R1 /u }).click();
  await expect(
    page
      .getByTestId("selection-halo-selected")
      .locator('[data-object-id="R1"]'),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("selection-halo-selected")
      .locator('[data-object-id="R2"]'),
  ).toHaveCount(0);
  await code.locator(".cm-line").filter({ hasText: /^R2 /u }).click();
  await expect(
    page
      .getByTestId("selection-halo-selected")
      .locator('[data-object-id="R2"]'),
  ).toBeVisible();
  await expect(
    page
      .getByTestId("selection-halo-selected")
      .locator('[data-object-id="R1"]'),
  ).toHaveCount(0);
  await code
    .locator(".cm-line")
    .filter({ hasText: /subckt/u })
    .click();
  await expect(page.getByTestId("selection-halo-selected")).toHaveCount(0);
  const initial = await code.innerText();
  await code.fill(initial.replace("R1 ", "R_load ").replace("10k", "22k"));
  await code.press("Enter");
  await expect(label(page)).toContainText("Rload");
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
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

test("keeps explicit display aliases while renaming netlist and restores the live name immediately", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "editable.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  const alias = page.getByRole("checkbox", { name: "Use display alias" });
  await expect(alias).not.toBeChecked();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("R_source");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("R_source");
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await alias.check();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("Load resistor");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(label(page)).toContainText("Load resistor");
  await code.fill((await code.innerText()).replace("R_source ", "R_new "));
  await code.press("Enter");
  await expect(code).toContainText("R_new");
  await expect(label(page)).toContainText("Load resistor");
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await expect(alias).toBeChecked();
  await alias.uncheck();
  await expect(label(page)).toContainText("Rnew");
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toHaveText("Rnew");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.screenshot({ path: "plan/netlist-edit-preview.png" });
});

test("rejects duplicate names atomically and retains a draft when the canvas changes", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "editable.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("R1");
  await code.fill((await code.innerText()).replace("R1 ", "R2 "));
  await code.press("Enter");
  await expect(
    page.getByRole("region", { name: "Live netlist" }).getByRole("alert"),
  ).toContainText("Edit rejected");
  await expect(label(page)).toContainText("R1");
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await page
    .getByRole("textbox", { name: "Canvas text editor" })
    .fill("R_canvas");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(
    page.getByRole("region", { name: "Live netlist" }).getByRole("alert"),
  ).toContainText("canvas or Agent changed");
  await expect(code).not.toContainText("R_canvas");
  await page.getByRole("button", { name: "Reload", exact: true }).click();
  await expect(code).toContainText("R_canvas");
});

test("opening and reopening Netlist preserves incomplete imported device data", async ({
  page,
}) => {
  const project = fixture();
  delete project.documents[0]!.instances[0]!.netlist!.parameters.value;
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "incomplete.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toHaveText("");
  await expect(
    page.getByRole("region", { name: "Live netlist" }).getByRole("alert"),
  ).toContainText("requires parameter value");
  const revision = await page.getByTestId("revision").textContent();
  // The Netlist button closes the panel it opened, and opens it again.
  await page.getByTestId("netlist-panel-toggle").click();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(code).toHaveText("");
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances[0].netlist.parameters).not.toHaveProperty(
    "value",
  );
});

test("bound labels retain typography on rename and support manual scripts without an alias", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "label-format.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
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
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
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
  expect(saved.documents[0].instances[0].reference).toBe("R_7");
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("R_7");
  await code.fill((await code.innerText()).replace("R_7 ", "R_8 "));
  await code.press("Enter");
  await expect(label(page)).toHaveText("R8");
  expect(
    (await typefaces()).every(
      (face) => face.weight === "700" && face.style === "italic",
    ),
  ).toBe(true);
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await expect(alias).not.toBeChecked();
  await expect(editor.locator("sub")).toHaveText("8");
  await page.screenshot({ path: "plan/label-format-restored.png" });
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Bold", exact: true }).click();
  await page.getByRole("button", { name: "Italic", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(code).toContainText("R_8");
  expect(
    (await typefaces()).every(
      (face) => face.weight === "400" && face.style === "normal",
    ),
  ).toBe(true);
  await code.fill((await code.innerText()).replace("R_8 ", "R9 "));
  await code.press("Enter");
  await expect(label(page)).toHaveText("R9");
  await expect(label(page).locator('[data-text-run="subscript"]')).toHaveCount(
    0,
  );
  expect(
    (await typefaces()).every(
      (face) => face.weight === "400" && face.style === "normal",
    ),
  ).toBe(true);
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await page.getByRole("button", { name: "Cancel text changes" }).click();
  await page.getByTestId("project-file").setInputFiles({
    name: "label-format-reopened.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(saved)),
  });
  const discard = page.getByRole("button", {
    name: "Discard and continue",
    exact: true,
  });
  if (await discard.isVisible()) await discard.click();
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  await expect(editor.locator("sub")).toHaveText("7");
  await expect(alias).not.toBeChecked();
});

test("instance name collisions suggest an alias in status without interrupting the text editor", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "alias-collision.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(fixture())),
  });
  await page.getByTestId("annotation-hit-label-R1").dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.fill("R2");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(page.getByTestId("status")).toContainText("Use display alias");
  await expect(editor).toHaveText("R2");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(label(page)).toHaveText("R1");
  await page.getByRole("checkbox", { name: "Use display alias" }).check();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(label(page)).toHaveText("R2");
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    saved.documents[0].instances.map(
      (item: { reference: string }) => item.reference,
    ),
  ).toEqual(["R1", "R2"]);
});

test("subscript case changes the current circuit code and netlist with one undo", async ({
  page,
}) => {
  const source = fixture();
  source.documents[0]!.instances[0]!.reference = "R_load";
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "subscript-case.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await page.getByTestId("draw-tool-document-style").click();
  const setting = page.getByLabel(
    "Subscript case in this circuit (label + netlist) options",
    { exact: true },
  );
  await setting.selectOption("uppercase");
  await expect(label(page)).toHaveText("RLOAD");
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(saved.documents[0].instances[0].reference).toBe("R_LOAD");
  expect(saved.documents[0].presentation.labelSubscriptCase).toBe("uppercase");
  await page.getByTestId("draw-tool-undo").click();
  await expect(label(page)).toHaveText("Rload");
  await expect(setting).toHaveValue("preserve");
});

test("opening and reopening a PDK BJT adds X only to SPICE, never its canvas name", async ({
  page,
}) => {
  const project = fixture();
  const doc = project.documents[0]!;
  doc.instances = [
    {
      id: "Q1",
      reference: "Q1",
      symbolId: "pnp",
      placement: { position: { x: 250, y: 200 }, rotation: 0, mirror: "none" },
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "pdk-pnp" },
        parameters: { m: "1" },
      },
    },
  ];
  doc.annotations = [
    {
      ...doc.annotations[0]!,
      id: "label-Q1",
      binding: { kind: "instance-reference", instanceId: "Q1" },
      anchor: {
        kind: "object",
        objectId: "Q1",
        localOffset: { x: 40, y: 0 },
        fallbackPosition: { x: 290, y: 200 },
      },
    },
  ];
  doc.nets = ["C", "B", "E"].map((pinName) => ({
    id: `net-${pinName}`,
    terminals: [{ instanceId: "Q1", pinName }],
  }));
  project.externalSubcircuitDefinitions.push({
    id: "pdk-pnp",
    name: "sky130_fd_pr__pnp_05v5_W0p68L0p68",
    terminals: ["C", "B", "E"].map((name) => ({
      id: name,
      name,
      direction: "passive",
    })),
    formalParameters: [],
    interfaceStatus: "declared",
  });
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "pnp.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const canvasLabel = page.locator(
    '[data-layer="annotations"] [data-object-id="label-Q1"]',
  );
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(canvasLabel).toHaveText("Q1");
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spice");
  await expect(code).toContainText("XQ1 ");
  const saved = await downloadBytes(page, "File", "Export Project File…");
  await page.getByTestId("project-file").setInputFiles({
    name: "pnp-reopen.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await expect(canvasLabel).toHaveText("Q1");
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spectre");
  await expect(code).toContainText("Q1 (");
  await expect(code).not.toContainText("XQ1");
  await page.getByTestId("annotation-hit-label-Q1").dblclick();
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toHaveText("Q1");
});

test("Cell Pin overbars rename the exported interface and follow source renames", async ({
  page,
}) => {
  const project = fixture();
  const document = project.documents[0]!;
  document.instances.push({
    id: "P1",
    symbolId: "port",
    placement: { position: { x: 100, y: 200 }, rotation: 0, mirror: "none" },
  });
  document.nets[0]!.terminals.push({ instanceId: "P1", pinName: "P" });
  document.netlist!.terminals.push({
    id: "output",
    name: "F",
    netId: "net-1",
    direction: "output",
    interfaceInstanceIds: ["P1"],
  });
  document.annotations.push({
    id: "label-output",
    kind: "instance-label",
    binding: { kind: "cell-terminal-name", terminalId: "output" },
    anchor: {
      kind: "object",
      objectId: "P1",
      localOffset: { x: 0, y: -30 },
      fallbackPosition: { x: 100, y: 170 },
    },
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "barred-pin.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const hit = page.getByTestId("annotation-hit-label-output");
  const label = page.locator(
    '[data-layer="annotations"] [data-object-id="label-output"]',
  );
  await hit.dblclick();
  const editor = page.getByRole("textbox", { name: "Canvas text editor" });
  await editor.press("ControlOrMeta+a");
  await page.getByRole("button", { name: "Overbar", exact: true }).click();
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await expect(editor).toHaveCount(0);
  await expect(label).toHaveText("F");
  await expect(
    label.locator("..").locator('[data-text-decoration="overbar"]'),
  ).toHaveCount(1);
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("F_bar");
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    saved.documents[0].netlist.terminals.find(
      (item: { id: string }) => item.id === "output",
    ).name,
  ).toBe("F_bar");
  // Device names are writable in the netlist; the marker must round trip there too.
  await code.fill((await code.innerText()).replace("R1 ", "R1_bar "));
  await code.press("Enter");
  const instanceLabel = page.locator(
    '[data-layer="annotations"] [data-object-id="label-R1"]',
  );
  await expect(instanceLabel).toHaveText("R1");
  await expect(instanceLabel.locator('[data-text-run="overbar"]')).toHaveCount(
    1,
  );
  await code.fill((await code.innerText()).replace("R1_bar ", "R1 "));
  await code.press("Enter");
  await expect(instanceLabel.locator('[data-text-run="overbar"]')).toHaveCount(
    0,
  );
  await page.getByTestId("hit-P1").click();
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.name = "Q_bar";
  });
  await expect(label).toHaveText("Q");
  await expect(
    label.locator("..").locator('[data-text-decoration="overbar"]'),
  ).toHaveCount(1);
  await editComponentPropertyCode(page, (code) => {
    code.name = "Q";
  });
  await expect(
    label.locator("..").locator('[data-text-decoration="overbar"]'),
  ).toHaveCount(0);
  const renamed = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(),
  );
  expect(
    renamed.documents[0].netlist.terminals.find(
      (item: { id: string }) => item.id === "output",
    ).name,
  ).toBe("Q");
  expect(
    renamed.documents[0].annotations.find(
      (item: { id: string }) => item.id === "label-output",
    ).binding,
  ).toEqual({ kind: "cell-terminal-name", terminalId: "output" });
});
