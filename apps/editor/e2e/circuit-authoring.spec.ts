// Authoring a circuit by hand: power rails, Cell Pins and Bias Voltage Ports,
// MOS bulk, switch contacts and No Connect marks.

import { parseSavedProject } from "./editor-fixtures";
import type { SchematicDocument } from "@icm/model";
import { expect, test } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  revealPropertiesShelf,
  awaitEditorReady,
  chooseComponent,
  clickDrawTool,
  downloadBytes,
  setComponentCodeField,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import {
  clickRoute,
  routeInk,
  readRoutePoints,
  dragBy,
} from "./canvas-fixtures.js";

test("constructs VDD as a drawn dotless power rail", async ({ page }) => {
  await page.goto("/editor");
  await page.getByTestId("shapes-chip-vdd").click();
  const canvas = page.getByTestId("schematic-canvas");

  await canvas.hover({ position: { x: 180, y: 120 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.hover({ position: { x: 520, y: 120 } });
  const preview = page.getByTestId("vdd-rail-preview");
  await expect(preview).toHaveAttribute("stroke-width", "3.24");
  expect(
    await preview.evaluate(
      (element) => element.getAttribute("x1") !== element.getAttribute("x2"),
    ),
  ).toBe(true);
  await canvas.click({ position: { x: 520, y: 120 } });

  await expect(page.getByTestId("route-hit-route-vdd1-rail")).toHaveCount(1);
  await expect(
    canvas.locator('[data-object-id="route-vdd1-rail"]'),
  ).toHaveAttribute("data-route-presentation", "power-rail");
  await expect(
    canvas.locator('[data-object-id="junction-vdd1-start"]'),
  ).toHaveCount(0);
  await expect(page.getByTestId("hit-VDD1")).toHaveCount(0);
  await expect(canvas.locator('[data-symbol-id="vdd"]')).toHaveCount(0);
  const powerLabel = canvas.locator('[data-kind="power-label"]');
  await expect(powerLabel).toHaveText("VDD");
  // A new rail shows its standard supply look: italic V, upright DD subscript.
  const subscript = powerLabel.locator('[data-text-run="subscript"]');
  await expect(subscript).toHaveText("DD");
  await expect(subscript).toHaveAttribute("style", /font-style:normal/u);
  await expect(
    powerLabel
      .locator(
        '[data-text-run="span"][style*="font-style:italic"][style*="font-weight:700"]',
      )
      .first(),
  ).toHaveText("V");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);

  await page.keyboard.press("Delete");
  await expect(page.getByTestId("route-hit-route-vdd1-rail")).toHaveCount(0);
  await expect(powerLabel).toHaveCount(0);
});

test("a switch changes contact style in place, keeping its wires", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await chooseComponent(page, "spdt-switch");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 220 } });
  await page.keyboard.press("Escape");

  // Wire the common terminal, so the swap has something to lose.
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-S1-COM").click();
  await canvas.dblclick({ position: { x: 200, y: 320 } });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  await page.locator('[data-canvas-hit-kind="instance"]').first().click();
  await revealPropertiesShelf(page);
  await page.getByTestId("selection-shelf").click();

  // The plain drawing is a state of this component, not a second part: the
  // Library never grew a tile for it.
  await expect(page.getByTestId("shapes-chip-simple-spdt-switch")).toHaveCount(
    0,
  );

  await setComponentCodeField(page, "symbol", "simple-spdt-switch");
  await expect(page.locator("[data-symbol-id]").first()).toHaveAttribute(
    "data-symbol-id",
    "simple-spdt-switch",
  );
  // Same instance, same designator, same wire: the exchange keeps terminal
  // identity, so nothing is orphaned.
  await expect(page.getByTestId("hit-S1")).toHaveCount(1);
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  await setComponentCodeField(page, "symbol", "spdt-switch");
  await expect(page.locator("[data-symbol-id]").first()).toHaveAttribute(
    "data-symbol-id",
    "spdt-switch",
  );
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
});

test("a rail ending on a wire joins it, and says so in plain words", async ({
  page,
}) => {
  await page.goto("/editor");
  // One horizontal wire out of a resistor pin, drawn the ordinary way.
  await placeComponent(page, "resistor", { x: 300, y: 200 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.dblclick({ position: { x: 600, y: 300 } });
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);

  // A rail drawn down onto that wire ENDS on it, which connects — the same
  // gesture as dropping a pin on a wire. It used to be refused with the
  // routing gate's own vocabulary.
  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.click({ position: { x: 500, y: 180 } });
  await canvas.click({ position: { x: 500, y: 300 } });
  await expect(page.getByTestId("status")).toContainText("Added VDD rail");
  await expect(page.getByTestId("status")).not.toContainText("preserve effect");
  await expect(page.getByTestId("route-hit-route-vdd1-rail")).toHaveCount(1);
});

test("keeps a tapped VDD rail movable and stretchable as one supply bar", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.click({ position: { x: 520, y: 120 } });
  await placeComponent(page, "resistor", { x: 360, y: 300 });

  await clickDrawTool(page, "wire");
  await clickRoute(page, "route-vdd1-rail");
  await page.locator('[data-testid^="terminal-R"][data-testid$="-1"]').click();
  await page.keyboard.press("Escape");

  const railHits = page.locator('[data-testid^="route-hit-route-vdd1-rail"]');
  await expect(railHits).toHaveCount(2);
  const selectedTestId = await railHits.first().getAttribute("data-testid");
  if (!selectedTestId) throw new Error("Tapped VDD rail is not selectable");
  const selectedRailId = selectedTestId.replace(/^route-hit-/u, "");
  const railIds = await railHits.evaluateAll((elements) =>
    elements.map((element) =>
      element.getAttribute("data-testid")!.replace(/^route-hit-/u, ""),
    ),
  );
  const beforeMove = await Promise.all(
    railIds.map((id) => readRoutePoints(page, id)),
  );

  await clickRoute(page, selectedRailId);
  await dragBy(page.getByTestId(`route-handle-${selectedRailId}`), {
    x: 30,
    y: 40,
  });
  await expect(page.getByTestId("status")).toContainText("Moved Power Rail");
  const afterMove = await Promise.all(
    railIds.map((id) => readRoutePoints(page, id)),
  );
  expect(Math.min(...afterMove.flat().map((point) => point.y))).toBeGreaterThan(
    Math.min(...beforeMove.flat().map((point) => point.y)),
  );

  const beforeResizeRight = Math.max(
    ...afterMove.flat().map((point) => point.x),
  );
  await dragBy(page.getByTestId("junction-junction-vdd1-end"), {
    x: 80,
    y: 0,
  });
  await expect(page.getByTestId("status")).toContainText("Resized Power Rail");
  const afterResize = await Promise.all(
    railIds.map((id) => readRoutePoints(page, id)),
  );
  expect(
    Math.max(...afterResize.flat().map((point) => point.x)),
  ).toBeGreaterThan(beforeResizeRight);
});

test("cancels VDD rail placement before or after its first endpoint", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.hover({ position: { x: 180, y: 120 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);

  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.hover({ position: { x: 520, y: 120 } });
  await expect(page.getByTestId("vdd-rail-preview")).toHaveAttribute(
    "stroke-width",
    "3.24",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("vdd-rail-preview")).toHaveCount(0);
  await expect(
    page.locator('[data-route-presentation="power-rail"]'),
  ).toHaveCount(0);
});

test("P shortcut starts Cell Pin placement", async ({ page }) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const canvas = page.getByTestId("schematic-canvas");
  await page.keyboard.press("p");
  // No setup dialog: the shortcut goes straight to the placement cursor.
  await expect(
    page.getByRole("dialog", { name: "Place Cell Pin" }),
  ).toHaveCount(0);
  await canvas.hover({ position: { x: 320, y: 180 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 320, y: 180 } });
  await expect(page.getByTestId("status")).toContainText("Added Cell Pin Vinp");
  await expect(page.getByTestId("hit-P1")).toBeVisible();
  const inputLabel = page.locator('[data-object-id="instance-label-P1"]');
  await expect(inputLabel).toHaveText("Vinp");
  await expect(
    inputLabel.locator(
      '[data-text-run="span"][style*="font-style:italic"][style*="font-weight:700"]',
    ),
  ).toHaveText("V");
  await expect(inputLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "inp",
  );

  await canvas.click({ position: { x: 520, y: 180 } });
  await expect(page.getByTestId("status")).toContainText("Added Cell Pin Vinn");
  const outputLabel = page.locator('[data-object-id="instance-label-P2"]');
  await expect(outputLabel).toHaveText("Vinn");
  await expect(outputLabel.locator('[data-text-run="subscript"]')).toHaveText(
    "inn",
  );
  await page.keyboard.press("Escape");

  await chooseComponent(page, "port-filled");
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 320, y: 260 } });
  await expect(page.getByTestId("status")).toContainText(
    "Added Bias Voltage Port VB1",
  );
  await page.keyboard.press("Escape");
  await chooseComponent(page, "port-filled");
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 520, y: 260 } });
  await expect(page.getByTestId("status")).toContainText(
    "Added Bias Voltage Port VB2",
  );
  await page.keyboard.press("Escape");
  const firstBias = page.locator('[data-object-id="instance-label-P3"]');
  const secondBias = page.locator('[data-object-id="instance-label-P4"]');
  await expect(firstBias).toHaveText("VB1");
  await expect(secondBias).toHaveText("VB2");
  await expect(firstBias.locator('[data-text-run="subscript"]')).toHaveText(
    "B1",
  );
  await expect(secondBias.locator('[data-text-run="subscript"]')).toHaveText(
    "B2",
  );
  await openSelectionShelf(page);
  await expect(
    page.getByRole("region", { name: "Routing guidance" }),
  ).toHaveCount(0);
});

test("Cell Pin deletion releases its interface and Base Net lifecycle", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  const canvas = page.getByTestId("schematic-canvas");

  const placeNamedPort = async (
    name: string,
    position: { x: number; y: number },
  ) => {
    await page.keyboard.press("p");
    await canvas.click({ position });
    await page.keyboard.press("Escape");
    await page.getByTestId("annotation-hit-instance-label-P1").dblclick();
    await page.getByRole("textbox", { name: "Canvas text editor" }).fill(name);
    await page.getByRole("button", { name: "Apply text changes" }).click();
  };

  await placeNamedPort("BUS", { x: 260, y: 180 });

  let saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      nets: Array<{
        id: string;
        name?: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
      connectivityEvidence: Array<{
        kind: string;
        netId?: string;
        name?: string;
        owner?: { kind: string; instanceId?: string };
      }>;
      netlist: {
        terminals: Array<{ name: string; interfaceInstanceIds: [string] }>;
      };
    }>;
  };
  expect(saved.documents[0]!.nets).toEqual([
    expect.objectContaining({
      id: "net-cell-pin-p1",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    }),
  ]);
  expect(saved.documents[0]!.connectivityEvidence).toEqual([]);
  expect(saved.documents[0]!.netlist.terminals).toEqual([
    expect.objectContaining({ name: "BUS", interfaceInstanceIds: ["P1"] }),
  ]);

  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as typeof saved;
  expect(saved.documents[0]!.nets).toEqual([]);
  expect(saved.documents[0]!.connectivityEvidence).toEqual([]);
  expect(saved.documents[0]!.netlist.terminals).toEqual([]);

  await placeNamedPort("BUS", { x: 360, y: 260 });
  await expect(page.getByTestId("hit-P1")).toBeVisible();
});

test("authors Cell Pins and Bias Voltage Ports as independent interfaces", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 460, y: 240 });
  await placeComponent(page, "port", { x: 260, y: 220 });
  await placeComponent(page, "port-filled", { x: 260, y: 300 });

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-P1-P").click();
  await page.getByTestId("terminal-R1-1").click();
  await page.keyboard.press("Escape");
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-P2-P").click();
  await page.getByTestId("terminal-R1-2").click();
  await page.keyboard.press("Escape");

  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);
  await dragBy(page.getByTestId("hit-P1"), { x: 40, y: 0 });
  await dragBy(page.getByTestId("hit-P2"), { x: 40, y: 20 });
  await expect(page.locator('[data-testid^="route-hit-"]')).toHaveCount(2);

  await page.getByTestId("hit-P1").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P1")).toHaveCount(0);
  await page.getByTestId("hit-P2").click();
  await page.keyboard.press("Delete");
  await expect(page.getByTestId("hit-P2")).toHaveCount(0);
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      nets: Array<{ terminals: Array<{ instanceId: string }> }>;
      routes: Array<{
        start: { kind: string; instanceId?: string };
        legs: Array<{
          to:
            | { kind: "bend" }
            | {
                kind: "endpoint";
                endpoint: { kind: string; instanceId?: string };
              };
        }>;
      }>;
    }>;
  };
  const document = saved.documents[0]!;
  expect(
    document.nets
      .flatMap((net) => net.terminals)
      .map((item) => item.instanceId),
  ).not.toEqual(expect.arrayContaining(["P1", "P2"]));
  expect(
    document.routes.flatMap((route) => {
      const target = route.legs.at(-1)?.to;
      return [
        route.start,
        ...(target?.kind === "endpoint" ? [target.endpoint] : []),
      ];
    }),
  ).not.toEqual(
    expect.arrayContaining([
      expect.objectContaining({ instanceId: "P1" }),
      expect.objectContaining({ instanceId: "P2" }),
    ]),
  );
});

test("authors components and connectivity manually from an empty canvas", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  // A flat Project has no hierarchy to navigate, so that row stays hidden.
  await expect(page.getByTestId("cell-navigation")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "nmos", { x: 560, y: 220 });
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("hit-M1")).toBeVisible();
  await expect(page.getByTestId("terminal-M1-B")).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(page.getByTestId("source-status")).toHaveText(
    "connectivity-modified",
  );

  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-M1-G").click();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await page.keyboard.press("Escape");

  await page.getByTestId("terminal-R1-2").click({ button: "right" });
  await openSelectionShelf(page);
  await expect(
    page.getByRole("button", { name: "Disconnect endpoint" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Delete connection" }).click();
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(0);
  await expect(page.getByTestId("status")).toHaveText(
    "Deleted endpoint connection",
  );

  await page.keyboard.press("Control+z");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("revision")).toHaveText("6");
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(0);
});

test("keeps Bulk status and its prominent draw action on one compact row", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);

  const bulk = page.getByLabel("MOS bulk connection");
  const draw = bulk.getByRole("button", { name: "Draw bulk connection" });
  await expect(draw).toBeVisible();
  await expect(draw).toHaveText("Connect");
  await expect(bulk.locator(".mos-bulk-status")).toHaveText("Unconnected");
  await expect(bulk).not.toContainText("unresolved");
  const layout = await bulk.evaluate((section) => {
    const heading = section.querySelector("h2")!.getBoundingClientRect();
    const action = section.querySelector("button")!.getBoundingClientRect();
    return {
      height: section.getBoundingClientRect().height,
      headingY: heading.y + heading.height / 2,
      actionY: action.y + action.height / 2,
    };
  });
  expect(layout.height).toBeLessThan(58);
  expect(Math.abs(layout.headingY - layout.actionY)).toBeLessThan(2);

  await draw.click();
  await expect(page.getByTestId("status")).toContainText(
    "Drawing M1.B bulk connection",
  );
  await expect(page.getByTestId("terminal-M1-B")).toBeVisible();
});

test("keeps DMOS bulk hidden until drawing an explicit bulk route", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "ndmos", { x: 360, y: 220 });
  await placeComponent(page, "resistor", { x: 560, y: 220 });
  await expect(page.getByTestId("terminal-M1-B")).toHaveCount(0);

  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Edit line color" }).click();
  await page.getByRole("button", { name: "Use Red for line" }).click();
  await page.getByTestId("draw-bulk-connection").click();

  await expect(page.getByTestId("status")).toContainText(
    "Drawing M1.B bulk connection",
  );
  await expect(page.getByTestId("terminal-M1-B")).toBeVisible();
  await page.getByTestId("terminal-R1-1").click();
  await page.keyboard.press("Escape");

  const bulkRoute = page.locator(
    '[data-layer="routes"] [data-object-id="route-ui-1"]',
  );
  await expect(bulkRoute).toHaveCount(1);
  await expect(bulkRoute).toHaveAttribute(
    "data-route-presentation",
    "bulk-dashed",
  );
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke"))
    .toBe("#dc2626");
  await expect
    .poll(() => routeInk(page, "route-ui-1", "stroke-dasharray"))
    .toBe("3 3");

  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 50, y: 50 } });
  const bulkHit = page.getByTestId("route-hit-route-ui-1");
  const bulkSegmentPoint = await bulkHit.evaluate((element) => {
    const polyline = element as SVGPolylineElement;
    const first = polyline.points.getItem(0);
    const second = polyline.points.getItem(1);
    const point = polyline.ownerSVGElement!.createSVGPoint();
    point.x = (first.x + second.x) / 2;
    point.y = (first.y + second.y) / 2;
    const screen = point.matrixTransform(polyline.getScreenCTM()!);
    return { x: screen.x, y: screen.y };
  });
  await page.mouse.click(bulkSegmentPoint.x, bulkSegmentPoint.y);
  await revealPropertiesShelf(page);
  await expect(page.getByTestId("selection-shelf")).toContainText("Bulk · M1");
  await expect(page.getByLabel("MOS bulk route actions")).toContainText(
    "Follows M1 line color",
  );
  await expect(page.getByLabel("Route actions", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByText("Electrical route", { exact: true })).toHaveCount(
    0,
  );
});

test("initializes NMOS bulk from the first explicitly placed Ground", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 360, y: 220 });
  await placeComponent(page, "ground", { x: 620, y: 280 });

  await page.getByTestId("hit-M1").click();
  await openSelectionShelf(page);
  const bulk = page.getByLabel("MOS bulk connection");
  await expect(bulk.locator(".mos-bulk-status")).toHaveText("0");
  await expect(bulk.locator(".mos-bulk-status")).toHaveAttribute(
    "title",
    "M1.B → 0 · Cell default",
  );
  await expect(
    bulk.getByRole("button", { name: "Draw bulk connection" }),
  ).toHaveText("Draw");

  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as {
    documents: Array<{
      mosBulkDefaults?: { nmosNetId?: string };
      instances: Array<{
        id: string;
        mosBulkBinding?: { origin: string; netId: string };
      }>;
      routes: Array<{ presentation?: string }>;
      connectivityEvidence: Array<{
        kind: string;
        netId?: string;
        name?: string;
      }>;
      nets: Array<{
        id: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
    }>;
  };
  const document = saved.documents[0]!;
  expect(
    document.instances.find((instance) => instance.id === "M1")?.mosBulkBinding,
  ).toEqual({ origin: "cell-default", netId: "net-power-gnd1" });
  expect(document.mosBulkDefaults?.nmosNetId).toBe("net-power-gnd1");
  expect(document.routes).not.toContainEqual(
    expect.objectContaining({ presentation: "bulk-dashed" }),
  );
  const groundNetId = document.connectivityEvidence.find(
    (evidence) => evidence.kind === "name-claim" && evidence.name === "0",
  )?.netId;
  expect(
    document.nets.find((net) => net.id === groundNetId)?.terminals,
  ).toEqual(
    expect.arrayContaining([
      { instanceId: "M1", pinName: "B" },
      { instanceId: "GND1", pinName: "0" },
    ]),
  );
});

test("marks and clears an unconnected endpoint as No Connect", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 380, y: 260 });

  await page.getByTestId("terminal-R1-1").click({ button: "right" });
  await openSelectionShelf(page);
  await page.getByRole("button", { name: "Mark No Connect" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Marked terminal-R1-1 No Connect",
  );
  await expect(page.locator('[data-role="no-connect"]')).toHaveCount(1);

  await page.getByTestId("terminal-R1-1").click({ button: "right" });
  await page.getByRole("button", { name: "Clear No Connect" }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Cleared No Connect on terminal-R1-1",
  );
  await expect(page.locator('[data-role="no-connect"]')).toHaveCount(0);
});

test("resizes a plain Power Rail from its end handle", async ({ page }) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("shapes-chip-vdd").click();
  await canvas.click({ position: { x: 180, y: 120 } });
  await canvas.click({ position: { x: 520, y: 120 } });
  await page.keyboard.press("Escape");

  const before = await readRoutePoints(page, "route-vdd1-rail");
  await clickRoute(page, "route-vdd1-rail");

  // The end handle sits under the Junction's endpoint circle. The canvas
  // capture layer used to claim the press there and translate the whole rail,
  // which left a rail's length uneditable.
  await dragBy(page.getByTestId("junction-junction-vdd1-end"), {
    x: 100,
    y: 0,
  });
  await expect(page.getByTestId("status")).toContainText("Resized Power Rail");

  const after = await readRoutePoints(page, "route-vdd1-rail");
  const leftOf = (points: typeof before) =>
    Math.min(...points.map((point) => point.x));
  const rightOf = (points: typeof before) =>
    Math.max(...points.map((point) => point.x));
  expect(leftOf(after)).toBe(leftOf(before));
  expect(rightOf(after)).toBeGreaterThan(rightOf(before));
  expect(new Set(after.map((point) => point.y)).size).toBe(1);
});

test("bonds pins crossed by Power Rail drawing, resizing, and dragging", async ({
  page,
}) => {
  const project = createEmptyProject("rail-pin-gestures", "Rail pin gestures");
  const document = project.documents[0]!;
  document.instances = [
    {
      id: "M1",
      symbolId: "pmos",
      placement: { position: { x: 100, y: 200 }, rotation: 0, mirror: "none" },
    },
    {
      id: "M2",
      symbolId: "pmos",
      placement: {
        position: { x: 240, y: 200 },
        rotation: 0,
        mirror: "horizontal",
      },
    },
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 340, y: 200 }, rotation: 0, mirror: "none" },
    },
    {
      id: "C1",
      symbolId: "capacitor",
      placement: { position: { x: 200, y: 140 }, rotation: 0, mirror: "none" },
    },
  ];
  document.nets.push({
    id: "old-source",
    terminals: [{ instanceId: "M1", pinName: "S" }],
  });
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "rail-pins.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("hit-M2")).toBeVisible();
  const canvas = page.getByTestId("schematic-canvas");
  const screen = (point: { x: number; y: number }) =>
    canvas.evaluate((element, point) => {
      const matrix = (element as SVGSVGElement).getScreenCTM()!;
      const screen = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      return { x: screen.x, y: screen.y };
    }, point);
  const clickAt = async (point: { x: number; y: number }) => {
    const position = await screen(point);
    await page.mouse.click(position.x, position.y);
  };
  const drag = async (from: { x: number; y: number }, to: typeof from) => {
    const start = await screen(from),
      end = await screen(to);
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  };
  const readDocument = async () =>
    parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(
        "utf8",
      ),
    ).documents[0] as SchematicDocument;
  const expectVddPins = (
    saved: SchematicDocument,
    pins: Array<[string, string]>,
  ) => {
    const rail = saved.routes.find(
      (route) => route.presentation === "power-rail",
    )!;
    const net = saved.nets.find((net) => net.id === rail.netId)!;
    for (const [instanceId, pinName] of pins)
      expect(net.terminals).toContainEqual({ instanceId, pinName });
    expect(net.terminals).not.toContainEqual({
      instanceId: "M1",
      pinName: "G",
    });
    expect(net.terminals).not.toContainEqual({
      instanceId: "M2",
      pinName: "D",
    });
  };
  const sources: Array<[string, string]> = [
    ["M1", "S"],
    ["M2", "S"],
  ];
  await page.getByTestId("shapes-chip-vdd").click();
  await clickAt({ x: 60, y: 180 });
  await clickAt({ x: 280, y: 180 });
  await expect(page.getByTestId("status")).toContainText("Added VDD rail");
  await page.keyboard.press("Escape");
  expectVddPins(await readDocument(), sources);

  await page.keyboard.press("ControlOrMeta+z");
  const undone = await readDocument();
  expect(undone.routes).toHaveLength(0);
  expect(undone.nets.find((net) => net.id === "old-source")?.terminals).toEqual(
    [{ instanceId: "M1", pinName: "S" }],
  );
  await page.keyboard.press("ControlOrMeta+Shift+z");
  expectVddPins(await readDocument(), sources);

  await clickAt({ x: 80, y: 180 });
  await drag({ x: 280, y: 180 }, { x: 380, y: 180 });
  await expect(page.getByTestId("status")).toContainText("Resized Power Rail");
  expectVddPins(await readDocument(), [...sources, ["R1", "1"]]);

  await clickAt({ x: 80, y: 180 });
  await drag({ x: 80, y: 180 }, { x: 80, y: 120 });
  await expect(page.getByTestId("status")).toContainText("Moved Power Rail");
  const moved = await readDocument();
  expectVddPins(moved, [...sources, ["R1", "1"], ["C1", "1"]]);
  project.documents = [moved];
  await page.getByTestId("project-file").setInputFiles({
    name: "rail-pins-saved.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  expectVddPins(await readDocument(), [...sources, ["R1", "1"], ["C1", "1"]]);
});
