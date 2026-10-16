import { expect, test } from "@playwright/test";
import { createEmptyProject, createRoutePath } from "@icm/model";

import {
  revealPropertiesShelf,
  editComponentPropertyCode,
  expectComponentCodeField,
  openProjectFile,
  placeComponentAt,
  openProject,
} from "./editor-fixtures.js";
import { openSelectionShelf } from "./manual-editor-fixtures.js";
import { closeSelectionShelf, placedInstance } from "./canvas-fixtures.js";

// Full catalog projection/parse coverage, every part's initial parameters
// included, lives in component-property-catalog.test.ts. These open the
// Properties surface through placement, selection and Q: a part whose
// parameter edits, the VDD Power connection, and a legacy clock read from a
// file. Every other part reaches the same surface through the same path.
async function openPropertiesWithQ(
  page: import("@playwright/test").Page,
  instanceTestId: string,
) {
  await page.getByTestId(instanceTestId).click({ force: true });
  await closeSelectionShelf(page);
  const properties = page.getByRole("region", {
    name: "Component properties",
  });
  // Q toggles the surface; a part selected while it is open keeps it open.
  if (!(await properties.isVisible())) await page.keyboard.press("q");
  await expect(properties).toBeVisible();
  await expect(properties.locator(":scope > *")).toHaveCount(1);
  await expect(properties.locator(":scope > :only-child")).toHaveAttribute(
    "aria-label",
    "Canvas property code",
  );
}

test("Properties resumes displayed PDK source on opening and changing the selection", async ({
  page,
}) => {
  const project = createEmptyProject("source-demand", "Source demand");
  project.externalSubcircuitDefinitions.push({
    id: "sky-res",
    name: "sky130_fd_pr__res_high_po",
    interfaceStatus: "declared",
    terminals: ["R0", "R1", "B"].map((name) => ({
      id: `sky-res-${name}`,
      name,
      direction: "passive",
    })),
    formalParameters: [],
  });
  project.documents[0]!.instances.push(
    {
      ...placedInstance("XR1", "resistor", 300, 220),
      reference: "XR1",
      netlist: {
        binding: { kind: "external-subcircuit", definitionId: "sky-res" },
        parameters: { w: "1u", l: "5.5u", mult: "1" },
      },
    },
    {
      ...placedInstance("R2", "resistor", 500, 220),
      reference: "R2",
      netlist: { parameters: { value: "1k" } },
    },
  );
  await openProject(page, project, "source-demand.icproj.json");
  await page.getByTestId("hit-XR1").click({ force: true });
  await closeSelectionShelf(page);
  const source = page.getByLabel("SPICE component code");
  await expect(source).toHaveCount(0);
  await page.keyboard.press("q");
  await expect(page.getByLabel("Substrate Net", { exact: true })).toBeVisible();
  // This intentionally unwired part uses the existing placeholder preview.
  await expect(source.locator("code")).toHaveText(
    "XR1 <unconnected:1> <unconnected:2> <value> l=5.5u mult=1 w=1u",
  );
  await expect(source).toHaveAttribute("data-exact", "false");
  const text = await source.innerText();
  await page.getByTestId("hit-R2").click({ force: true });
  await expect(source).toHaveCount(0);
  await page.getByTestId("hit-XR1").click({ force: true });
  await expect(source).toHaveText(text, { useInnerText: true });
  await closeSelectionShelf(page);
  await page.keyboard.press("q");
  await expect(source).toHaveText(text, { useInnerText: true });
});

test("placed parts, the VDD marker and a legacy clock use the text-first Properties surface", async ({
  page,
}) => {
  // Retired from insertion, but saved Projects must keep their clock
  // component and its editable Properties surface.
  const project = createEmptyProject("legacy-clock", "Legacy Clock");
  project.documents[0]!.instances.push({
    ...placedInstance("CLK", "pulse-voltage-source", 520, 350),
    reference: "V1",
    netlist: { parameters: { period: "10ns", dutyCycle: "50", initial: "0" } },
  });
  await page.goto("/editor");
  await revealPropertiesShelf(page);
  await openProjectFile(page, project, "legacy-clock.icproj.json");
  await openPropertiesWithQ(page, "hit-CLK");
  await expectComponentCodeField(page, "parameters.period", "10ns");

  for (const [symbolId, x] of [
    ["opamp", 300],
    ["vdd-port", 700],
  ] as const)
    await placeComponentAt(page, symbolId, { x, y: 200 });
  await openPropertiesWithQ(page, "hit-X1");
  await expectComponentCodeField(page, "parameters.gain", "1e6");
  await editComponentPropertyCode(page, (code) => {
    code.parameters.gain = "123";
  });
  await expectComponentCodeField(page, "parameters.gain", "123");
  await openPropertiesWithQ(
    page,
    (await page
      .locator('[data-canvas-hit-kind="instance"]')
      .last()
      .getAttribute("data-testid"))!,
  );
  await expectComponentCodeField(page, "connection", "cell-pin");
});

// A current-controlled source: how a controlled source's visual name stays
// apart from its electrical identity (component-property-code covers vccs).
test("cccs Visual Annotation edits without crashing or changing electrical identity", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/editor");
  await placeComponentAt(page, "cccs", { x: 520, y: 350 });
  await openPropertiesWithQ(page, "hit-F1");
  await expectComponentCodeField(page, "name", "βi_{1}");
  await editComponentPropertyCode(page, (code) => {
    code.name = "k_{x}u_{y}";
    code.parameters.gain = "2m";
  });
  await expectComponentCodeField(page, "name", "k_{x}u_{y}");
  await expectComponentCodeField(page, "parameters.gain", "2m");
  await expectComponentCodeField(page, "netlistName", "F1");
  expect(errors).toEqual([]);
});

async function openFixture(
  page: import("@playwright/test").Page,
  symbolId: string,
) {
  const project = createEmptyProject("control-pick", "Control pick");
  const document = project.documents[0]!;
  for (const suffix of ["a", "b"]) {
    document.instances.push(
      placedInstance(
        `ground-${suffix}`,
        "ground",
        suffix === "a" ? 330 : 430,
        460,
      ),
    );
    document.nets.push({
      id: `ground-net-${suffix}`,
      terminals: [{ instanceId: `ground-${suffix}`, pinName: "0" }],
    });
    document.connectivityEvidence.push({
      id: `ground-claim-${suffix}`,
      kind: "name-claim",
      netId: `ground-net-${suffix}`,
      owner: { kind: "power-marker", objectId: `ground-${suffix}` },
      name: "0",
      scope: "global",
      powerDomain: "ground",
    });
  }
  document.instances.push(
    { ...placedInstance("controlled", symbolId, 470, 360), reference: "X1" },
    {
      ...placedInstance("sensor", "voltage-source", 670, 360),
      reference: "V1",
    },
    { ...placedInstance("invalid", "resistor", 780, 360), reference: "R1" },
  );
  for (const [name, y] of [
    ["plus", 210],
    ["minus", 270],
  ] as const) {
    const netId = `net-${name}`;
    const leftId = `${name}-left`;
    const rightId = `${name}-right`;
    document.nets.push({
      id: netId,
      terminals:
        name === "plus" ? [{ instanceId: "sensor", pinName: "+" }] : [],
    });
    document.junctions.push(
      { id: leftId, netId, position: { x: 330, y }, role: "route-anchor" },
      { id: rightId, netId, position: { x: 430, y }, role: "route-anchor" },
    );
    document.routes.push(
      createRoutePath({
        id: `route-${name}`,
        netId,
        start: { kind: "junction", junctionId: leftId },
        end: { kind: "junction", junctionId: rightId },
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  await openProject(page, project, "control-pick.icproj.json");
  await openPropertiesWithQ(page, "hit-controlled");
  await expect(page.getByTestId("component-control-pick")).toBeVisible();
}

// The binding's terminal edit is component-property-code-edits' ("binds
// hidden supplies with the existing terminal edit and clears to Auto…").
test("hidden block supplies preview Nets and bind explicitly or Auto", async ({
  page,
}) => {
  const project = createEmptyProject("block-supply", "Block supply");
  const document = project.documents[0]!;
  document.instances.push({
    ...placedInstance("block", "opamp", 480, 300),
    reference: "X1",
  });
  for (const [name, x] of [
    ["AVDD", 230],
    ["DVDD", 330],
  ] as const) {
    const markerId = `marker-${name}`;
    const netId = `net-${name}`;
    document.instances.push(placedInstance(markerId, "vdd-port", x, 180));
    document.nets.push({
      id: netId,
      terminals: [{ instanceId: markerId, pinName: "P" }],
    });
    document.connectivityEvidence.push({
      id: `claim-${name}`,
      kind: "name-claim",
      netId,
      owner: { kind: "power-marker", objectId: markerId },
      name,
      scope: "global",
      powerDomain: "vdd",
    });
  }
  document.instances.push(placedInstance("ground", "ground", 230, 420));
  document.nets.push({
    id: "net-ground",
    terminals: [{ instanceId: "ground", pinName: "0" }],
  });
  await openProject(page, project, "block-supply.icproj.json");
  await revealPropertiesShelf(page);
  await page.getByTestId("hit-block").click({ force: true });
  await openSelectionShelf(page);
  const properties = page.getByRole("complementary", { name: "Properties" });
  const vdd = properties.getByRole("button", { name: "VDD Net options" });
  const vss = properties.getByRole("button", { name: "VSS Net options" });
  await expectComponentCodeField(page, "supplies.VDD", "");
  await vss.click();
  await expect(
    page.getByRole("option", { name: "Auto · net-ground" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await vdd.click();
  const option = page
    .getByRole("listbox", { name: "VDD Net previews" })
    .getByRole("option", { name: "AVDD" });
  const overlay = page.getByTestId("net-highlight-overlay");
  await option.hover();
  await expect(overlay).toHaveAttribute("data-net-id", "net-AVDD");
  await option.click();
  await expectComponentCodeField(page, "supplies.VDD", "net-AVDD");
  await expect(overlay).toHaveCount(0);
  await vdd.click();
  await page
    .getByRole("listbox", { name: "VDD Net previews" })
    .getByRole("option", { name: /Auto/ })
    .click();
  await expectComponentCodeField(page, "supplies.VDD", "");
});

// vcvs picks its control Nets through the same picker; replacing one end
// while keeping the other is controlled-source-canvas-pick's.
test("vccs highlights control Nets and commits each pick immediately", async ({
  page,
}) => {
  await openFixture(page, "vccs");
  const picker = page.getByTestId("component-control-pick");
  await expect(
    page.locator(".cm-content").getByTestId("component-control-pick"),
  ).toBeVisible();
  await expect(picker.locator("xpath=..")).toContainText('"control": {');
  const positive = page.getByLabel("Control + Net options", { exact: true });
  const negative = page.getByLabel("Control − Net options", { exact: true });
  const menu = page.getByRole("listbox");
  const overlay = page.getByTestId("net-highlight-overlay");
  await positive.click();
  await expect(
    menu.getByRole("option", { name: "0", exact: true }),
  ).toHaveCount(1);
  const plusOption = menu.getByRole("option", { name: /plus/i });
  await plusOption.hover();
  await expect(overlay).toHaveAttribute("data-net-id", "net-plus");
  await plusOption.click();
  await expect(overlay).toHaveCount(0);
  await negative.click();
  await menu.getByRole("option", { name: /minus/i }).click();
  await expectComponentCodeField(page, "control", {
    positiveNetId: "net-plus",
    negativeNetId: "net-minus",
  });
  await positive.click();
  await menu.getByRole("option", { name: /plus/i }).hover();
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await positive.click();
  await menu.getByRole("option", { name: "Select Net", exact: true }).click();
  await negative.click();
  await menu.getByRole("option", { name: "Select Net", exact: true }).click();
  await picker.getByRole("button", { name: "Pick control on canvas" }).click();
  await page.getByTestId("route-hit-route-plus").hover({ force: true });
  await expect(overlay).toBeVisible();
  await expect(overlay).toHaveAttribute("data-net-id", "net-plus");
  await page.getByTestId("route-hit-route-plus").click({ force: true });
  await expect(picker).toContainText("Click control − Net");
  await expectComponentCodeField(page, "control.positiveNetId", "net-plus");
  await page.keyboard.press("Escape");
  await expect(overlay).toHaveCount(0);
  await expectComponentCodeField(page, "control", {
    positiveNetId: "net-plus",
    negativeNetId: "",
  });
  await positive.click();
  await menu.getByRole("option", { name: /plus/i }).hover();
  await expect(overlay).toBeVisible();
  await page.getByTestId("selection-shelf").click();
  await expect(overlay).toHaveCount(0);
  await expect(menu).toHaveCount(0);
});

// ccvs picks its control terminals through the same picker.
test("cccs picks ordered current terminals with snap and direction feedback, and survives an incomplete draft", async ({
  page,
}) => {
  await openFixture(page, "cccs");
  const picker = page.getByTestId("component-control-pick");
  await expect(
    page.getByLabel("Control device options", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel("Current direction options", { exact: true }),
  ).toHaveCount(0);
  await picker.getByRole("button", { name: "Pick control on canvas" }).click();
  const sensor = page.getByTestId("hit-sensor");
  const invalid = page.getByTestId("hit-invalid");
  const invalidPin = page.getByTestId("terminal-invalid-1");
  await sensor.hover({ force: true });
  await expect(sensor).toHaveAttribute("data-control-sensor", "false");
  await invalid.hover({ force: true });
  await expect(invalid).toHaveCSS("cursor", "not-allowed");
  await invalidPin.hover({ force: true });
  await expect(invalidPin).toHaveCSS("stroke-width", "2px");
  await invalid.click({ force: true });
  await expect(picker).toContainText("Pick control + terminal");
  await invalidPin.hover({ force: true });
  await expect(
    page.getByTestId("control-current-direction-preview"),
  ).toHaveAttribute("data-direction", "into");
  // Deliberately click off the actual pin center, inside the snap radius.
  const pin = await invalidPin.boundingBox();
  if (!pin) throw new Error("Missing terminal");
  await page.mouse.click(
    pin.x + pin.width / 2 + pin.width * 0.3,
    pin.y + pin.height / 2,
  );
  await expect(picker).toContainText("Pick highlighted − terminal");
  await expect(
    page.getByTestId("terminal-invalid-1-current-pick-marker"),
  ).toHaveClass(/origin/);
  await expect(
    page.getByTestId("terminal-invalid-2-current-pick-marker"),
  ).toHaveClass(/partner/);
  await expect(page.getByTestId("terminal-sensor-+")).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expectComponentCodeField(page, "control.instanceId", "");
  await picker.getByRole("button", { name: "Pick control on canvas" }).click();
  await invalidPin.click({ force: true });
  await page.getByTestId("terminal-invalid-2").click({ force: true });
  await expectComponentCodeField(page, "control", {
    instanceId: "invalid",
    pinName: "1",
    direction: "into",
  });
  const positive = page.getByLabel("Positive terminal options", {
    exact: true,
  });
  const negative = page.getByLabel("Negative terminal options", {
    exact: true,
  });
  await expect(positive).toHaveValue(JSON.stringify(["invalid", "1"]));
  await expect(negative).toHaveValue(JSON.stringify(["invalid", "2"]));
  expect((await positive.boundingBox())!.width).toBeLessThan(32);
  expect((await negative.boundingBox())!.width).toBeLessThan(32);
  await picker.getByRole("button", { name: "Reverse control current" }).click();
  await expectComponentCodeField(page, "control.direction", "out");
  await expect(positive).toHaveValue(JSON.stringify(["invalid", "2"]));
  await expect(negative).toHaveValue(JSON.stringify(["invalid", "1"]));
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectComponentCodeField(page, "control.direction", "into");
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expectComponentCodeField(page, "control.pinName", "");
  await page.getByRole("button", { name: "Redo", exact: true }).click();
  await expectComponentCodeField(page, "control.pinName", "1");
  await positive.selectOption(JSON.stringify(["sensor", "-"]));
  await expectComponentCodeField(page, "control", {
    instanceId: "sensor",
    pinName: "-",
    direction: "into",
  });
  await expect(negative).toHaveValue(JSON.stringify(["sensor", "+"]));
  await expect(negative.locator("option")).toHaveCount(2);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(positive).toHaveValue(JSON.stringify(["invalid", "1"]));
  await negative.selectOption("");
  await expectComponentCodeField(page, "control.instanceId", "");
  await expect(
    picker.getByRole("button", { name: "Pick control on canvas" }),
  ).toBeVisible();

  // An incomplete JSON draft of the control does not crash the editor.
  const editor = page.getByLabel("Editable Canvas property code", {
    exact: true,
  });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.insertText('{"control":{');
  await expect(editor).toContainText('"control"');
  await expect(
    page.getByText("The editor hit an unexpected problem"),
  ).toHaveCount(0);
});
