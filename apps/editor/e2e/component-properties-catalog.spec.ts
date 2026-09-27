import { expect, test } from "@playwright/test";
import { createEmptyProject, createRoutePath } from "@icm/model";

import {
  awaitEditorReady,
  revealPropertiesShelf,
  chooseComponent,
  editComponentPropertyCode,
  expectComponentCodeField,
} from "./editor-fixtures.js";

// Full catalog projection/parse coverage lives in component-property-catalog.test.ts.
// These exercise distinct UI capabilities through placement, selection and Q:
// passive, model, waveform, variant, internal mark, formula, electrical marker,
// expanded-library device and independent magnetic parameter display.
const componentSymbolIds = [
  "resistor",
  "nmos",
  "pulse-voltage-source",
  "ideal-switch",
  "voltage-amplifier",
  "discrete-time-integrator",
  "vdd-port",
  "ndmos",
  "xfmr",
  "vccs",
];

for (const symbolId of componentSymbolIds) {
  test(`${symbolId} uses the text-first component Properties surface`, async ({
    page,
  }) => {
    await page.goto("/editor");
    if (symbolId === "pulse-voltage-source") {
      // Retired from insertion, but saved Projects must keep their clock
      // component and its editable Properties surface.
      const project = createEmptyProject("legacy-clock", "Legacy Clock");
      project.documents[0]!.instances.push({
        id: "CLK",
        symbolId,
        placement: {
          position: { x: 520, y: 350 },
          rotation: 0,
          mirror: "none",
        },
        reference: "V1",
        netlist: {
          parameters: { period: "10ns", dutyCycle: "50", initial: "0" },
        },
      });
      await revealPropertiesShelf(page);
      await page.getByTestId("project-file").setInputFiles({
        name: "legacy-clock.icproj.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(project)),
      });
    } else {
      await chooseComponent(page, symbolId);
      const canvas = page.getByTestId("schematic-canvas");
      await canvas.click({ position: { x: 520, y: 350 } });
      await page.keyboard.press("Escape");
    }

    const instance = page.locator('[data-canvas-hit-kind="instance"]');
    await expect(instance).toHaveCount(1);
    await instance.click();
    await revealPropertiesShelf(page);
    const shelf = page.getByTestId("selection-shelf");
    if ((await shelf.getAttribute("aria-expanded")) === "true") {
      await shelf.click();
    }
    await page.keyboard.press("q");

    const properties = page.getByRole("region", {
      name: "Component properties",
    });
    await expect(properties).toBeVisible();
    await expect(
      properties.getByLabel("Editable Canvas property code"),
    ).toBeVisible();
    if (symbolId === "vdd-port") {
      await expectComponentCodeField(page, "connection", "cell-pin");
    }
    if (symbolId === "vccs") {
      await expectComponentCodeField(page, "name", "g_{m}v_{1}");
      await expectComponentCodeField(page, "control", {
        positiveNetId: "",
        negativeNetId: "",
      });
      await expectComponentCodeField(page, "parameters.gm", "1m");
    }
    await expect(properties.locator(":scope > *")).toHaveCount(1);
    await expect(properties.locator(":scope > :only-child")).toHaveAttribute(
      "aria-label",
      "Canvas property code",
    );
  });
}

for (const [symbolId, formula, parameter, netlistName] of [
  ["vcvs", "A_{v}v_{1}", "gain", "E1"],
  ["vccs", "g_{m}v_{1}", "gm", "G1"],
  ["cccs", "βi_{1}", "gain", "F1"],
  ["ccvs", "R_{m}i_{1}", "rm", "H1"],
] as const) {
  test(`${symbolId} Visual Annotation edits without crashing or changing electrical identity`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto("/editor");
    await chooseComponent(page, symbolId);
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x: 520, y: 350 } });
    await page.keyboard.press("Escape");
    await page.locator('[data-canvas-hit-kind="instance"]').click();
    await revealPropertiesShelf(page);
    const shelf = page.getByTestId("selection-shelf");
    if ((await shelf.getAttribute("aria-expanded")) === "true")
      await shelf.click();
    await page.keyboard.press("q");
    await expectComponentCodeField(page, "name", formula);
    await editComponentPropertyCode(page, (code) => {
      code.name = "k_{x}u_{y}";
      code.parameters[parameter] = "2m";
    });
    await expectComponentCodeField(page, "name", "k_{x}u_{y}");
    await expectComponentCodeField(page, `parameters.${parameter}`, "2m");
    await expectComponentCodeField(page, "netlistName", netlistName);
    expect(errors).toEqual([]);
  });
}

async function openFixture(
  page: import("@playwright/test").Page,
  symbolId: string,
) {
  const project = createEmptyProject("control-pick", "Control pick");
  const document = project.documents[0]!;
  for (const suffix of ["a", "b"]) {
    document.instances.push({
      id: `ground-${suffix}`,
      symbolId: "ground",
      placement: {
        position: { x: suffix === "a" ? 330 : 430, y: 460 },
        rotation: 0,
        mirror: "none",
      },
    });
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
    {
      id: "controlled",
      symbolId,
      reference: "X1",
      placement: { position: { x: 470, y: 360 }, rotation: 0, mirror: "none" },
    },
    {
      id: "sensor",
      symbolId: "voltage-source",
      reference: "V1",
      placement: { position: { x: 670, y: 360 }, rotation: 0, mirror: "none" },
    },
    {
      id: "invalid",
      symbolId: "resistor",
      reference: "R1",
      placement: { position: { x: 780, y: 360 }, rotation: 0, mirror: "none" },
    },
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
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "control-pick.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await revealPropertiesShelf(page);
  await page.getByTestId("hit-controlled").click({ force: true });
  const shelf = page.getByTestId("selection-shelf");
  if ((await shelf.getAttribute("aria-expanded")) === "true")
    await shelf.click();
  await page.keyboard.press("q");
  await expect(page.getByTestId("component-control-pick")).toBeVisible();
}

for (const symbolId of ["vcvs", "vccs"]) {
  test(`${symbolId} highlights control Nets and commits each pick immediately`, async ({
    page,
  }) => {
    await openFixture(page, symbolId);
    const picker = page.getByTestId("component-control-pick");
    await expect(
      page.locator(".cm-content").getByTestId("component-control-pick"),
    ).toBeVisible();
    await expect(picker.locator("xpath=..")).toContainText('"control": {');
    const positive = page.getByLabel("Control + Net options", { exact: true });
    const negative = page.getByLabel("Control − Net options", { exact: true });
    await expect(positive.locator("option", { hasText: /^0$/ })).toHaveCount(1);
    await positive.selectOption("net-plus");
    await negative.selectOption("net-minus");
    await expectComponentCodeField(page, "control", {
      positiveNetId: "net-plus",
      negativeNetId: "net-minus",
    });
    await positive.selectOption("");
    await negative.selectOption("");
    await picker
      .getByRole("button", { name: "Pick control on canvas" })
      .click();
    await page.getByTestId("route-hit-route-plus").hover({ force: true });
    await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
    await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
      "data-net-id",
      "net-plus",
    );
    await page.getByTestId("route-hit-route-plus").click({ force: true });
    await expect(picker).toContainText("Click control − Net");
    await expectComponentCodeField(page, "control.positiveNetId", "net-plus");
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
    await expectComponentCodeField(page, "control", {
      positiveNetId: "net-plus",
      negativeNetId: "",
    });
    await picker
      .getByRole("button", { name: "Pick control on canvas" })
      .click();
    await page.getByTestId("terminal-sensor-+").click({ force: true });
    await page.getByTestId("route-hit-route-minus").hover({ force: true });
    await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
    await expect(page.getByTestId("net-highlight-overlay")).toHaveAttribute(
      "data-net-id",
      "net-minus",
    );
    await page.getByTestId("route-hit-route-minus").click({ force: true });
    await expectComponentCodeField(page, "control", {
      positiveNetId: "net-plus",
      negativeNetId: "net-minus",
    });
    await expect(
      picker.getByRole("button", { name: "Pick control on canvas" }),
    ).toBeVisible();
  });
}

for (const symbolId of ["cccs", "ccvs"]) {
  test(`${symbolId} picks a device terminal with immediate direction feedback`, async ({
    page,
  }) => {
    await openFixture(page, symbolId);
    const picker = page.getByTestId("component-control-pick");
    const devices = page.getByLabel("Control device options", { exact: true });
    await devices.selectOption("sensor");
    await page
      .getByLabel("Control terminal options", { exact: true })
      .selectOption("+");
    await page
      .getByLabel("Current direction options", { exact: true })
      .selectOption("out");
    await expectComponentCodeField(page, "control", {
      instanceId: "sensor",
      pinName: "+",
      direction: "out",
    });
    await devices.selectOption("invalid");
    await expectComponentCodeField(page, "control.pinName", "");
    await picker
      .getByRole("button", { name: "Pick control on canvas" })
      .click();
    await page.getByTestId("hit-sensor").hover({ force: true });
    await expect(page.getByTestId("hit-sensor")).toHaveAttribute(
      "data-control-sensor",
      "false",
    );
    await page.getByTestId("hit-invalid").hover({ force: true });
    await expect(page.getByTestId("hit-invalid")).toHaveCSS(
      "cursor",
      "not-allowed",
    );
    await page.getByTestId("terminal-invalid-1").hover({ force: true });
    await expect(page.getByTestId("terminal-invalid-1")).toHaveCSS(
      "stroke-width",
      "2px",
    );
    await page.getByTestId("hit-invalid").click({ force: true });
    await expect(picker).toContainText("Click a device terminal");
    await page.getByTestId("terminal-invalid-1").hover({ force: true });
    await expect(
      page.getByTestId("control-current-direction-preview"),
    ).toHaveAttribute("data-direction", "out");
    await page.getByTestId("terminal-invalid-1").click({ force: true });
    await expectComponentCodeField(page, "control", {
      instanceId: "invalid",
      pinName: "1",
      direction: "out",
    });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expectComponentCodeField(page, "control.pinName", "");
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expectComponentCodeField(page, "control.pinName", "1");
    await expect(
      picker.getByRole("button", { name: "Pick control on canvas" }),
    ).toBeVisible();
  });
}

for (const [symbolId, secondId, expression] of [
  ["vcvs", "E2", "A_{v}v_{2}"],
  ["cccs", "F2", "βi_{2}"],
] as const) {
  test(`${symbolId} increments the default input/sensor subscript on placement`, async ({
    page,
  }) => {
    await page.goto("/editor");
    await chooseComponent(page, symbolId);
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.click({ position: { x: 420, y: 350 } });
    await canvas.click({ position: { x: 620, y: 350 } });
    await page.keyboard.press("Escape");
    await page.getByTestId(`hit-${secondId}`).click({ force: true });
    await revealPropertiesShelf(page);
    const shelf = page.getByTestId("selection-shelf");
    if ((await shelf.getAttribute("aria-expanded")) === "true")
      await shelf.click();
    await page.keyboard.press("q");
    await expectComponentCodeField(page, "name", expression);
  });
}
