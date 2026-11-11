import { createEmptyProject, type Point } from "@icm/model";
import { expect, test, type Page } from "@playwright/test";

import {
  clickDrawTool,
  closeProjectTools,
  clickNetlistWorkflowCommand,
  expectStatus,
  openProject,
  placeComponentAt,
} from "./editor-fixtures";
import {
  addStraightWire,
  centre,
  instanceIds,
  onScreen,
  placedInstance,
  polylinePoints,
  routeIdOf,
  awaitCanvasSettled,
} from "./canvas-fixtures";

/**
 * The check found nothing but the loose wires' open ends. They are drawn
 * ending in empty space, and ERC names each such end; nothing else, and
 * nothing ambiguous, is left to report.
 */
async function expectOnlyOpenWireEnds(page: Page, ends: number) {
  await expect(page.getByTestId("statusbar-issues")).toHaveText(
    `${ends} warnings`,
  );
  await page.getByTestId("statusbar-issues").click();
  await expect(
    page.getByTestId("project-diagnostics").getByText(/ends in the open/u),
  ).toHaveCount(ends);
}

// The smallest and the largest scale; the ones between add nothing new, and
// each target kind is captured at one of them.
for (const [scale, targetKind] of [
  [4, "pin"],
  [0.5, "route"],
] as const) {
  test(`single click captures ${targetKind} at canvas scale ${scale}`, async ({
    page,
  }) => {
    const project = createEmptyProject("wire-capture", "Wire capture");
    const document = project.documents[0]!;
    document.instances.push(placedInstance("C1", "capacitor", 300, 300));
    addStraightWire(
      document,
      "bus-route",
      { id: "left", netId: "bus", position: { x: 240, y: 400 } },
      { id: "right", netId: "bus", position: { x: 400, y: 400 } },
    );
    await openProject(page, project);
    const canvas = page.getByTestId("schematic-canvas");
    await expect(page.getByTestId("terminal-C1-1")).toBeAttached();
    await awaitCanvasSettled(canvas);
    const target =
      targetKind === "pin"
        ? await page.getByTestId("terminal-C1-1").evaluate((element) => ({
            x: (element as SVGCircleElement).cx.baseVal.value,
            y: (element as SVGCircleElement).cy.baseVal.value,
          }))
        : { x: 305, y: 400 };
    // Use the real wheel camera path, anchored at the destination. This
    // exercises its live CTM rather than faking the React viewBox state. One
    // Ctrl+wheel step zooms at most e^0.2 (#2191), so step until the scale
    // is reached.
    const zoom = () =>
      canvas.evaluate(
        (element) => (element as SVGSVGElement).getScreenCTM()!.a,
      );
    for (let step = 0; step < 40; step += 1) {
      const before = await zoom();
      const remaining = Math.log(before / scale) / 0.01;
      if (Math.abs(remaining) < 0.5) break;
      await canvas.evaluate(
        (element, { target, deltaY }) => {
          const svg = element as SVGSVGElement;
          const anchor = new DOMPoint(target.x, target.y).matrixTransform(
            svg.getScreenCTM()!,
          );
          svg.dispatchEvent(
            new WheelEvent("wheel", {
              clientX: anchor.x,
              clientY: anchor.y,
              ctrlKey: true,
              deltaY,
              bubbles: true,
              cancelable: true,
            }),
          );
        },
        { target, deltaY: Math.max(-20, Math.min(20, remaining)) },
      );
      await expect.poll(zoom).not.toBe(before);
    }
    await expect
      .poll(() =>
        canvas.evaluate(
          (element) => (element as SVGSVGElement).getScreenCTM()!.a,
        ),
      )
      .toBeCloseTo(scale, 1);
    await awaitCanvasSettled(canvas);
    await clickDrawTool(page, "wire");
    const [start, destination] = await onScreen(canvas, [
      { x: target.x - 30, y: target.y + (targetKind === "pin" ? 20 : -20) },
      target,
    ]);
    await page.mouse.click(start!.x, start!.y);
    await expectStatus(page, "Wire source: free grid point");
    // At high zoom this is beyond the old 7px circle AND the DOM hit band.
    // At low zoom it checks the minimum capture size on the same path.
    const offset = Math.min(24, Math.max(6, 7 * scale)) * 0.8;
    await page.mouse.move(destination!.x, destination!.y - offset);
    await expect(page.getByTestId("wire-snap-target")).toBeVisible();
    await page.mouse.click(destination!.x, destination!.y - offset);
    await expectStatus(page, "Committed route");
    await expect(page.getByTestId("wire-preview")).toHaveCount(0);
    await expect(page.getByTestId("wire-snap-target")).toHaveCount(0);
    await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(
      targetKind === "pin" ? 2 : 3,
    );
  });
}

test("a click on the active pin fixes no step, Delete on a junction dot disconnects its tap, and the wire tool branches from the dot", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 260, y: 200 });
  await placeComponentAt(page, "resistor", { x: 260, y: 420 });
  await placeComponentAt(page, "resistor", { x: 460, y: 310 });
  await placeComponentAt(page, "resistor", { x: 80, y: 310 });
  const ids = await instanceIds(page);
  const routes = page.locator('[data-canvas-hit-kind="route"]');
  await clickDrawTool(page, "wire");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  // Clicking the active pin again does not fix a zero-length wire step.
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await expectStatus(page, "Wire source:");
  await expect(page.getByTestId("status")).not.toContainText("step fixed");
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await expectStatus(page, "Committed route");
  await expect(routes).toHaveCount(1);
  const box = (await routes.first().boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByTestId(`terminal-${ids[2]}-1`).click();
  await page.keyboard.press("Escape");
  const dot = page.locator('g[data-layer="junctions"] circle');
  await expect(dot).toHaveCount(1);
  await expect(routes).toHaveCount(3);

  // Click exactly on the visible dot: the junction's hit circle sits on the
  // same contact point, so the dot is clickable. Delete removes the tap.
  const dotCentre = centre((await dot.boundingBox())!);
  await page.mouse.click(dotCentre.x, dotCentre.y);
  await page.keyboard.press("Delete");
  await expect(dot).toHaveCount(0);
  await expect(routes).not.toHaveCount(3);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(dot).toHaveCount(1);
  await expect(routes).toHaveCount(3);

  // The tee's two collinear arms are the same conductor as the dot, so the
  // click is not an ambiguous crossing: it starts the wire at the junction.
  await clickDrawTool(page, "wire");
  await page.mouse.click(dotCentre.x, dotCentre.y);
  await expectStatus(page, "Wire source: junction:");
  await page.getByTestId(`terminal-${ids[3]}-2`).click();
  await expectStatus(page, "Committed route");
  await expect(routes).toHaveCount(4);
  await expect(dot).toHaveCount(1);
});

test("middle clicks reach 45 degrees after one corner flip from a fixed vertical leg", async ({
  page,
}) => {
  await page.goto("/editor");
  await clickDrawTool(page, "wire");
  const canvas = page.getByTestId("schematic-canvas");
  await awaitCanvasSettled(canvas);
  const [start, bend, end] = await onScreen(canvas, [
    { x: 100, y: 100 },
    { x: 100, y: 140 },
    { x: 260, y: 200 },
  ]);
  await page.mouse.click(start!.x, start!.y);
  await page.mouse.click(bend!.x, bend!.y);
  await page.mouse.move(end!.x, end!.y);
  const preview = page.getByTestId("wire-preview");
  const points = () => polylinePoints(preview);
  await expect(preview).toBeVisible();
  const original = await points();
  const middle = () => page.mouse.click(end!.x, end!.y, { button: "middle" });

  await middle();
  await expectStatus(page, "horizontal first");
  const flipped = await points();
  expect(flipped).not.toEqual(original);
  expect(
    flipped.every(
      (point, index) =>
        index === 0 ||
        point.x === flipped[index - 1]!.x ||
        point.y === flipped[index - 1]!.y,
    ),
  ).toBe(true);

  await middle();
  await expectStatus(page, "45° diagonal");
  const diagonal = await points();
  expect(
    diagonal.some((point, index) => {
      if (!index) return false;
      const dx = Math.abs(point.x - diagonal[index - 1]!.x);
      const dy = Math.abs(point.y - diagonal[index - 1]!.y);
      return dx > 0 && dx === dy;
    }),
  ).toBe(true);
  await middle();
  await expectStatus(page, "any angle");
  await middle();
  await expectStatus(page, "auto");
  expect(await points()).toEqual(original);
  await expect(page.getByTestId("revision")).toHaveText("0");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);

  await middle();
  await middle();
  await page.mouse.dblclick(end!.x, end!.y);
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  const committed = await polylinePoints(
    page.locator('[data-layer="routes"] polyline'),
  );
  expect(committed).toEqual(diagonal);
});

test("a middle press cycles the wire corner, even drifting under the hand, and never commits the wire", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 260, y: 200 });
  await placeComponentAt(page, "resistor", { x: 460, y: 420 });
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();

  // Drafting toward the second pin: middle over bare canvas cycles the
  // corner shape instead of placing a point. Clicking a scroll wheel drags
  // the hand a few pixels; that is still a click, not a pan.
  await page.mouse.move(360, 320);
  await page.mouse.down({ button: "middle" });
  await page.mouse.move(366, 325);
  await page.mouse.up({ button: "middle" });
  await expectStatus(page, "Wire corner:");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);

  // Middle directly over the destination endpoint's snap circle is the
  // reported hazard: it must cycle again, not commit the wire.
  const destination = page.getByTestId(`terminal-${ids[1]}-1`);
  const box = (await destination.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "middle" });
  await page.mouse.up({ button: "middle" });
  await expectStatus(page, "Wire corner:");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(0);

  // The primary button still commits.
  await destination.click();
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
});

test("Wire options and / choose the corner without a middle button, and Enter finishes at the latest pointer", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.getByTestId("draw-tool-wire").click();
  const chip = page.getByTestId("wire-options-toggle");
  await expect(chip).toHaveText("Orthogonal · F3");

  // An idle Wire tool used to restore its remembered shape on the next
  // render, so a status-bar choice snapped straight back.
  await chip.click();
  const options = page.getByTestId("wire-options");
  await options.getByLabel("Route").selectOption("octilinear");
  await expect(chip).toHaveText("45° · F3");
  await expect(options.getByLabel("Route")).toHaveValue("octilinear");

  // The keyboard twin of a middle click continues the same cycle.
  await options.getByLabel("Route").blur();
  await page.keyboard.press("/");
  await expectStatus(page, "Wire corner: any angle");
  await expect(chip).toHaveText("Any angle · F3");
  await page.keyboard.press("/");
  await expect(chip).toHaveText("Orthogonal · F3");

  // Enter finishes the wire at the latest pointer without waiting for a
  // preview frame: the move and the key arrive in one task.
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 240, y: 200 } });
  await canvas.evaluate((element) => {
    const svg = element as SVGSVGElement;
    const screen = new DOMPoint(500, 400).matrixTransform(svg.getScreenCTM()!);
    svg.dispatchEvent(
      new PointerEvent("pointermove", {
        bubbles: true,
        clientX: screen.x,
        clientY: screen.y,
        buttons: 0,
        pointerId: 1,
        pointerType: "mouse",
      }),
    );
    svg.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
    );
  });
  const route = page.locator('[data-canvas-hit-kind="route"]');
  await expect(route).toHaveCount(1);
  const endpoint = await route.evaluate((element) => {
    const points = (element as SVGPolylineElement).points;
    const end = points.getItem(points.numberOfItems - 1);
    return { x: end.x, y: end.y };
  });
  expect(endpoint).toEqual({ x: 500, y: 400 });
});

test("dragging a wire's end onto another wire joins them into one net", async ({
  page,
}) => {
  // A horizontal wire, and a separate vertical one clear above it.
  const project = createEmptyProject("wire-landing", "Wire landing");
  const document = project.documents[0]!;
  for (const [net, from, to] of [
    ["across", { x: 240, y: 320 }, { x: 480, y: 320 }],
    ["down", { x: 360, y: 160 }, { x: 360, y: 240 }],
  ] as const) {
    addStraightWire(
      document,
      `wire-${net}`,
      { id: `${net}-a`, netId: net, position: from, role: "route-anchor" },
      { id: `${net}-b`, netId: net, position: to, role: "route-anchor" },
    );
  }
  await openProject(page, project);
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  await awaitCanvasSettled(canvas);

  // Drag the vertical wire down so its lower end comes to rest on the
  // horizontal one. This is the gesture that used to leave two nets touching
  // at a point, with an ambiguous-junction error the author could not clear.
  // It is aimed through the canvas transform, so the end is released ON the
  // wire instead of a rounding step past it.
  const [grab, halfway, release] = await onScreen(canvas, [
    { x: 360, y: 200 },
    { x: 360, y: 240 },
    { x: 360, y: 280 },
  ]);
  await page.mouse.move(grab!.x, grab!.y);
  await page.mouse.down();
  await page.mouse.move(halfway!.x, halfway!.y, { steps: 6 });
  await page.mouse.move(release!.x, release!.y, { steps: 6 });
  await page.mouse.up();

  // The landing tapped the horizontal wire: it splits, and a junction dot
  // marks the connection — exactly what drawing the same wire would produce.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(3);
  await expect(page.locator('g[data-layer="junctions"] circle')).toHaveCount(1);
  // Drawing and model agree, so there is nothing ambiguous left to report:
  // the landed end is joined, and the other three stay open.
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expectOnlyOpenWireEnds(page, 3);
});

test("a connected wire's segments drag with a live preview, a diagonal along the pointer's axis, a no-op drag records nothing, and a deleted part leaves its wires dangling", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 260, y: 200 });
  await placeComponentAt(page, "resistor", { x: 560, y: 420 });
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  // Two middle clicks: the opposite right angle, then 45 degrees.
  const canvas = page.getByTestId("schematic-canvas");
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + 420, box.y + 320);
  for (let click = 0; click < 2; click += 1) {
    await page.mouse.down({ button: "middle" });
    await page.mouse.up({ button: "middle" });
  }
  await expectStatus(page, "45° diagonal");
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
  await awaitCanvasSettled(canvas);

  const wire = page.locator('[data-testid^="route-hit-"]');
  const routeId = await routeIdOf(wire);
  const drawn = page.locator(
    `[data-layer="routes"] [data-object-id="${routeId}"]`,
  );
  const revision = () => page.getByTestId("revision").textContent();
  const drag = async (
    path: readonly { x: number; y: number }[],
    during?: () => Promise<void>,
  ) => {
    const [first, ...rest] = await onScreen(canvas, path);
    await page.mouse.move(first!.x, first!.y);
    await page.mouse.down();
    for (const point of rest)
      await page.mouse.move(point.x, point.y, { steps: 8 });
    await during?.();
    await page.mouse.up();
  };
  // R1's pin, straight into the diagonal, then a leg across to R2's pin.
  const [pin, corner, end] = (await polylinePoints(wire)) as [
    Point,
    Point,
    Point,
  ];
  expect(corner.x - pin.x).toBe(corner.y - pin.y);
  expect(corner.y).toBe(end.y);

  // Pulled mostly down, the diagonal moves along that axis: R1's lead jogs
  // down and the diagonal slides along the leg to R2, keeping its angle.
  const grab = { x: pin.x + 130, y: pin.y + 130 };
  await drag([grab, { x: grab.x + 3, y: grab.y + 20 }]);
  await expectStatus(page, "Moved route segment");
  const jogged = [
    pin,
    { x: pin.x, y: pin.y + 20 },
    { ...corner, x: corner.x - 20 },
    end,
  ];
  expect(await polylinePoints(wire)).toEqual(jogged);

  // The connected leg to R2 drags too: both pins keep their ends, and the
  // live preview is the wire the release commits, with no slanted leg
  // closing it back to where it started.
  const legMiddle = { x: (corner.x - 20 + end.x) / 2, y: end.y };
  let preview: Point[] = [];
  await drag([legMiddle, { x: legMiddle.x, y: legMiddle.y + 40 }], async () => {
    await expect.poll(() => polylinePoints(drawn)).not.toEqual(jogged);
    preview = await polylinePoints(drawn);
  });
  const moved = await polylinePoints(wire);
  expect(moved).toEqual(preview);
  expect(moved[0]).toEqual(pin);
  expect(moved.at(-1)).toEqual(end);
  expect(
    moved.every((point, index) => {
      if (!index) return true;
      const dx = Math.abs(point.x - moved[index - 1]!.x);
      const dy = Math.abs(point.y - moved[index - 1]!.y);
      return dx === 0 || dy === 0 || dx === dy;
    }),
  ).toBe(true);

  // Away and back to where it started: nothing changed, so there is no new
  // revision and no empty undo step.
  const before = await revision();
  const diagonal = moved.findIndex((point, index) => {
    if (!index) return false;
    const dx = Math.abs(point.x - moved[index - 1]!.x);
    return dx > 0 && dx === Math.abs(point.y - moved[index - 1]!.y);
  });
  const middle = {
    x: (moved[diagonal]!.x + moved[diagonal - 1]!.x) / 2,
    y: (moved[diagonal]!.y + moved[diagonal - 1]!.y) / 2,
  };
  await drag([middle, { x: middle.x - 30, y: middle.y + 1 }, middle]);
  await expectStatus(page, "unchanged");
  expect(await revision()).toBe(before);
  expect(await polylinePoints(wire)).toEqual(moved);

  // Deleting a connected part keeps its wires, now open where it was.
  await page.getByTestId(`hit-${ids[0]}`).click();
  await page.keyboard.press("Delete");
  await expectStatus(page, "connected wires remain dangling");
  await expect(wire).toHaveCount(1);
});

test("the preview draws the wire the release commits, joining every compatible pin it crosses", async ({
  page,
}) => {
  // The defect this pins: the draft used to be computed one way and the
  // committed wire another, so the line the author watched was not the line
  // they got. One straight run across three pins is where the two answers
  // used to differ most — the commit splits at every crossed pin and the
  // preview drew none of them.
  const project = createEmptyProject("wire-preview-truth", "Wire preview");
  const document = project.documents[0]!;
  document.instances.push(
    placedInstance("C1", "capacitor", 80, 120),
    placedInstance("R1", "resistor", 120, 120),
    placedInstance("GND1", "ground", 160, 110),
  );
  document.nets.push({
    id: "net-ground",
    terminals: [{ instanceId: "GND1", pinName: "0" }],
  });
  document.connectivityEvidence.push({
    id: "claim-ground",
    kind: "name-claim",
    netId: "net-ground",
    name: "0",
    owner: { kind: "power-marker", objectId: "GND1" },
    scope: "global",
    powerDomain: "ground",
  });

  await openProject(page, project);
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  const [start, end] = await onScreen(canvas, [
    { x: 40, y: 100 },
    { x: 200, y: 100 },
  ]);

  await clickDrawTool(page, "wire");
  await page.mouse.click(start!.x, start!.y);
  // Hover, do not release: this is the moment the author is looking at.
  await page.mouse.move(end!.x, end!.y);

  const previewPoints = await polylinePoints(page.getByTestId("wire-preview"));
  // Every compatible crossed pin, the Ground's too, is drawn as a contact, so
  // the run reads as joining them rather than passing over them.
  await expect(page.getByTestId("wire-preview-contact")).toHaveCount(3);

  await page.mouse.dblclick(end!.x, end!.y);
  await expectStatus(page, "Committed route");
  // The commit splits at each of them: four pieces meeting at three contacts.
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(4);
  await expect(
    page.locator('[data-layer="junctions"] [data-node-kind="contact"]'),
  ).toHaveCount(3);

  // Every leg of this gesture lies on one horizontal line, so ordering the
  // committed vertices by x reassembles the single conductor the author drew.
  const committedPoints = await page
    .locator('[data-testid^="route-hit-"]')
    .evaluateAll((elements) => {
      const seen = new Map<string, { x: number; y: number }>();
      for (const element of elements) {
        for (const point of Array.from(
          (element as SVGPolylineElement).points,
        )) {
          seen.set(`${point.x}:${point.y}`, { x: point.x, y: point.y });
        }
      }
      return [...seen.values()].sort((left, right) => left.x - right.x);
    });

  expect(previewPoints.length).toBeGreaterThan(2);
  expect(previewPoints).toEqual(committedPoints);
});
