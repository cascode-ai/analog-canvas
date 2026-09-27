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
      await expectComponentCodeField(page, "name", "g_{m}v_{i}");
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
  ["vcvs", "A_{v}v_{i}", "gain", "E1"],
  ["vccs", "g_{m}v_{i}", "gm", "G1"],
  ["cccs", "βi_{x}", "gain", "F1"],
  ["ccvs", "R_{m}i_{x}", "rm", "H1"],
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
  test(`${symbolId} picks two control Nets atomically on canvas`, async ({
    page,
  }) => {
    await openFixture(page, symbolId);
    const picker = page.getByTestId("component-control-pick");
    await picker
      .getByRole("button", { name: "Pick control on canvas" })
      .click();
    await page.getByTestId("route-hit-route-plus").click({ force: true });
    await expect(picker).toContainText("Click control − Net");
    await page.keyboard.press("Escape");
    await expectComponentCodeField(page, "control", {
      positiveNetId: "",
      negativeNetId: "",
    });
    await picker
      .getByRole("button", { name: "Pick control on canvas" })
      .click();
    await page.getByTestId("terminal-sensor-+").click({ force: true });
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
  test(`${symbolId} picks a voltage-source current sensor, not an arbitrary part`, async ({
    page,
  }) => {
    await openFixture(page, symbolId);
    const picker = page.getByTestId("component-control-pick");
    await picker
      .getByRole("button", { name: "Pick control on canvas" })
      .click();
    await page.getByTestId("hit-invalid").click({ force: true });
    await expect(picker).toContainText("Click a voltage source");
    await page
      .getByTestId(symbolId === "cccs" ? "terminal-sensor-+" : "hit-sensor")
      .click({ force: true });
    await expectComponentCodeField(page, "control", {
      sensorInstanceId: "sensor",
    });
    await expect(
      picker.getByRole("button", { name: "Pick control on canvas" }),
    ).toBeVisible();
  });
}
