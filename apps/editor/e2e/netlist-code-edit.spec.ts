import { test, expect } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  awaitEditorReady,
  clickCommand,
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

test("restores process and device choices, applies defaults and keeps copy/edit/undo consistent", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto("/editor?example=current-mirror-loaded-differential-pair");
  await awaitEditorReady(page);
  const code = page.getByLabel("Netlist code", { exact: true });
  await expect(code).toContainText("NMOS");
  await expect(code).not.toContainText("TODO");
  const process = page.getByLabel("Netlist process", { exact: true });
  await process.selectOption("sky130");
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8");
  await expect(code).toContainText("XM1");
  await clickCommand(page, "Edit", "Undo");
  await expect(code).toContainText("NMOS");
  await expect(code).not.toContainText("XM1");
  await clickCommand(page, "Edit", "Redo");
  await expect(code).toContainText("XM1");
  await page
    .getByLabel("Netlist format", { exact: true })
    .selectOption("spectre");
  await page
    .getByLabel("NMOS netlist target", { exact: true })
    .selectOption("sky130_fd_pr__nfet_01v8_lvt");
  await expect(code).toContainText("simulator lang=spectre");
  await expect(code).not.toContainText("simulator lang=spice");
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8_lvt");
  await page.getByTestId("copy-netlist-panel").click();
  const nonemptyLines = (text: string) =>
    text.split(/\r?\n/u).filter((line) => line.trim());
  expect(
    nonemptyLines(await page.evaluate(() => navigator.clipboard.readText())),
  ).toEqual(nonemptyLines(await code.innerText()));
  const saved = JSON.parse(
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
  await clickCommand(page, "Netlist", "Configuration…");
  const configuration = page.getByLabel("Netlist configuration JSON");
  const preferences = JSON.parse(await configuration.inputValue());
  preferences.format = "spice";
  await configuration.fill(JSON.stringify(preferences));
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(code).toContainText("sky130_fd_pr__nfet_01v8_lvt");
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
  ).toContainText("M_load");
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
  await expect(capacitorLabel).toContainText("C_input");
  await page.getByTestId("annotation-hit-instance-label-C1").dblclick();
  await expect(
    page.getByRole("checkbox", { name: "Use display alias" }),
  ).not.toBeChecked();
});

test("explicit component and Issues inspection replaces the default netlist panel", async ({
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
  await expect(page.getByLabel("Netlist code", { exact: true })).toHaveCount(0);
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
  await expect(label(page)).toContainText("R_load");
  const saved = JSON.parse(
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
  await clickCommand(page, "Edit", "Undo");
  await expect(label(page)).toContainText("R1");
  await expect(code).toContainText("10k");
  await clickCommand(page, "Edit", "Redo");
  await expect(label(page)).toContainText("R_load");
  await page.getByLabel("Netlist format").selectOption("spectre");
  await expect(code).toContainText("simulator lang=spectre");
  await code.fill((await code.innerText()).replace("R_load ", "R_final "));
  await code.press("Enter");
  await expect(label(page)).toContainText("R_final");
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
  await expect(label(page)).toContainText("R_new");
  await expect(
    page.getByRole("textbox", { name: "Canvas text editor" }),
  ).toHaveValue("R_new");
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
  await expect(code).toContainText("TODO");
  const revision = await page.getByTestId("revision").textContent();
  await page
    .getByRole("button", { name: "Close project tools", exact: true })
    .click();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(code).toContainText("TODO");
  await expect(page.getByTestId("revision")).toHaveText(revision!);
  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances[0].netlist.parameters).not.toHaveProperty(
    "value",
  );
});
