import {
  exportedProject,
  expectStatus,
  placeComponentAt,
} from "./editor-fixtures";
import { expect, test, type Page } from "@playwright/test";
import type { SchematicDocument } from "@icm/model";
import { centre, instanceIds, wirePins } from "./canvas-fixtures";

function routePoints(page: Page) {
  return page
    .locator('[data-canvas-hit-kind="route"]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("points")),
    );
}

async function exportedTerminals(
  page: Page,
): Promise<Array<{ instanceId: string; pinName: string }>> {
  const document: SchematicDocument = (await exportedProject(page))
    .documents[0];
  return document.nets.flatMap((net) => net.terminals);
}

const CTRL = 2; // CDP Input modifier bitmask for Control
const META = 4; // CDP Input modifier bitmask (Cmd; macOS turns Ctrl+left into a right press)
const SHIFT = 8; // CDP Input modifier bitmask for Shift

/**
 * Playwright's high-level mouse API cannot attach keyboard modifiers to
 * pointer events, so a modified drag goes through the raw CDP input
 * pipeline. Cmd stands in for Ctrl because macOS converts Ctrl+left-press
 * into a right-button press before the page sees it.
 */
type Point = { x: number; y: number };

async function modifierDrag(
  page: Page,
  from: Point,
  to: Point,
  modifiers: number,
): Promise<void> {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: from.x,
    y: from.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    modifiers,
  });
  const steps = 8;
  for (let step = 1; step <= steps; step += 1) {
    await cdp.send("Input.dispatchMouseEvent", {
      type: "mouseMoved",
      x: from.x + ((to.x - from.x) * step) / steps,
      y: from.y + ((to.y - from.y) * step) / steps,
      button: "left",
      buttons: 1,
      modifiers,
    });
  }
  await cdp.send("Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: to.x,
    y: to.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    modifiers,
  });
  await cdp.detach();
}

/** Ctrl/Cmd variant, the gesture shipped in #413. */
const ctrlDrag = (page: Page, from: Point, to: Point) =>
  modifierDrag(page, from, to, META);

/** Shift variant, asked for so the drag matches Shift+M. */
const shiftDrag = (page: Page, from: Point, to: Point) =>
  modifierDrag(page, from, to, SHIFT);

/**
 * Build two resistors joined by one wire, with nothing selected. Returns the
 * instance ids and the wire's geometry before anything moves.
 */
async function wiredPair(page: Page): Promise<{
  ids: string[];
  wireBefore: (string | null)[];
}> {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 300, y: 180 });
  await placeComponentAt(page, "resistor", { x: 300, y: 400 });
  const ids = await instanceIds(page);

  await page.keyboard.press("w");
  await wirePins(page, `${ids[0]}-2`, `${ids[1]}-1`);
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  await deselect(page);
  return { ids, wireBefore: await routePoints(page) };
}

/** Click bare canvas, so a drag targets exactly the pointed-at part. */
async function deselect(page: Page): Promise<void> {
  await page.getByTestId("schematic-canvas").click({
    position: { x: 620, y: 420 },
  });
}

test("Ctrl+drag moves only the part, and a still Ctrl+click toggles selection", async ({
  page,
}) => {
  const { ids, wireBefore } = await wiredPair(page);
  const top = page.getByTestId(`hit-${ids[0]}`);
  const bottom = page.getByTestId(`hit-${ids[1]}`);

  // A ctrl press-release without movement is the toggle-selection click.
  const still = (await bottom.boundingBox())!;
  await ctrlDrag(page, centre(still), centre(still));
  await expect(bottom).toHaveClass(/selected/);
  expect(Math.abs((await bottom.boundingBox())!.x - still.x)).toBeLessThan(2);
  await deselect(page);

  const before = (await top.boundingBox())!;
  const from = centre(before);
  await ctrlDrag(page, from, { x: from.x + 180, y: from.y });

  // The part moved; the now-open wire kept its exact authored geometry.
  expect((await top.boundingBox())!.x).toBeGreaterThan(before.x + 100);
  expect(await routePoints(page)).toEqual(wireBefore);
  await expectStatus(page, "without its wires");
});

// Issue #485: Virtuoso's Shift+M. The same detachment Ctrl+drag performs,
// reached through the verb-first path: with nothing selected it arms for the
// next click, and on a selection it carries every selected part off its wires.
test("Shift+M arms for the next click and carries a whole selection off its wires", async ({
  page,
}) => {
  const { ids, wireBefore } = await wiredPair(page);
  const top = page.getByTestId(`hit-${ids[0]}`);
  const bottom = page.getByTestId(`hit-${ids[1]}`);

  await page.keyboard.press("Shift+M");
  await expectStatus(page, "Move without wires: click");
  const armed = (await top.boundingBox())!;
  await page.mouse.click(centre(armed).x, centre(armed).y);
  await page.mouse.move(armed.x + 200, centre(armed).y);
  await page.mouse.click(armed.x + 200, centre(armed).y);
  expect((await top.boundingBox())!.x).toBeGreaterThan(armed.x + 100);
  expect(await routePoints(page)).toEqual(wireBefore);
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => Math.round((await top.boundingBox())!.x))
    .toBe(Math.round(armed.x));

  // The keyboard verb earns its place beside Ctrl+drag: the drag detaches only
  // the part under the pointer, while Shift+M carries the whole selection.
  await top.click();
  await bottom.click({ modifiers: ["Shift"] });
  const topBefore = (await top.boundingBox())!;
  const bottomBefore = (await bottom.boundingBox())!;
  await page.keyboard.press("Shift+M");
  await expectStatus(page, "without wires");
  const target = { x: topBefore.x + 200, y: centre(topBefore).y };
  await page.mouse.move(target.x, target.y);
  await page.mouse.click(target.x, target.y);

  // Both parts moved by the same delta, and the wire between them did not.
  const topAfter = (await top.boundingBox())!;
  const bottomAfter = (await bottom.boundingBox())!;
  expect(topAfter.x).toBeGreaterThan(topBefore.x + 100);
  expect(Math.round(bottomAfter.x - bottomBefore.x)).toBe(
    Math.round(topAfter.x - topBefore.x),
  );
  expect(await routePoints(page)).toEqual(wireBefore);
  // Both selected parts are electrically open, not just visually adrift.
  const terminals = await exportedTerminals(page);
  for (const id of ids)
    expect(terminals).not.toContainEqual(
      expect.objectContaining({ instanceId: id }),
    );
});

// Virtuoso's pairing for the two modified drags: Ctrl/Cmd moves a part off its
// wires, and Shift duplicates. A stationary Shift+click must keep meaning
// "add to selection".
test("Shift+drag drops a copy, and a Shift+click adds to the selection even as the hand drifts", async ({
  page,
}) => {
  const { ids, wireBefore } = await wiredPair(page);
  const top = page.getByTestId(`hit-${ids[0]}`);
  const bottom = page.getByTestId(`hit-${ids[1]}`);

  await top.click();
  const still = (await bottom.boundingBox())!;
  // A click drifts a few pixels; it still adds the part instead of copying
  // it (2026-10-18: 4 px of drift copied the selection).
  const press = centre(still);
  await shiftDrag(page, press, { x: press.x + 6, y: press.y + 3 });
  await expect(top).toHaveClass(/selected/);
  await expect(bottom).toHaveClass(/selected/);
  expect(await instanceIds(page)).toHaveLength(2);
  expect(Math.abs((await bottom.boundingBox())!.x - still.x)).toBeLessThan(2);
  await deselect(page);

  const before = (await top.boundingBox())!;
  const from = centre(before);
  await shiftDrag(page, from, { x: from.x + 180, y: from.y });

  // A third part now exists, and the two originals never moved.
  const after = await instanceIds(page);
  expect(after).toHaveLength(3);
  expect(after).toEqual(expect.arrayContaining(ids));
  expect(Math.abs((await top.boundingBox())!.x - before.x)).toBeLessThan(2);
  // Duplicating never disturbs the wiring the originals already had.
  expect(await routePoints(page)).toEqual(wireBefore);
  const terminals = await exportedTerminals(page);
  for (const id of ids)
    expect(terminals).toContainEqual(
      expect.objectContaining({ instanceId: id }),
    );
});

test("Ctrl/Cmd+drag on a marquee-selected region moves parts and internal wires together while leaving boundary wires behind", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 220, y: 220 });
  await placeComponentAt(page, "capacitor", { x: 340, y: 220 });
  await placeComponentAt(page, "resistor", { x: 520, y: 220 });
  const [r1Id, c1Id, r3Id] = await instanceIds(page);

  await page.keyboard.press("w");
  await wirePins(page, `${r1Id}-2`, `${c1Id}-2`);
  await page.keyboard.press("w");
  await wirePins(page, `${c1Id}-1`, `${r3Id}-1`);
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(2);

  const r1 = page.getByTestId(`hit-${r1Id}`);
  const c1 = page.getByTestId(`hit-${c1Id}`);
  const r3 = page.getByTestId(`hit-${r3Id}`);
  const r1Before = (await r1.boundingBox())!;
  const c1Before = (await c1.boundingBox())!;
  const r3Before = (await r3.boundingBox())!;

  const marqueeSelectRegion = async () => {
    const left = Math.min(r1Before.x, c1Before.x) - 35;
    const top = Math.min(r1Before.y, c1Before.y) - 35;
    const right =
      Math.max(r1Before.x + r1Before.width, c1Before.x + c1Before.width) + 25;
    const bottom =
      Math.max(r1Before.y + r1Before.height, c1Before.y + c1Before.height) + 45;
    await page.mouse.move(left, top);
    await page.mouse.down();
    await page.mouse.move(right, bottom, { steps: 10 });
    await page.mouse.up();
    await expect(r1).toHaveClass(/selected/);
    await expect(c1).toHaveClass(/selected/);
  };

  await marqueeSelectRegion();
  const docBefore: SchematicDocument = (await exportedProject(page))
    .documents[0];
  const internalWire = docBefore.routes.find((route) => {
    const lastTo = route.legs.at(-1)?.to;
    return (
      route.start.kind === "terminal" &&
      (route.start.instanceId === r1Id || route.start.instanceId === c1Id) &&
      lastTo?.kind === "endpoint" &&
      lastTo.endpoint.kind === "terminal" &&
      lastTo.endpoint.instanceId !== r3Id
    );
  })!;
  const boundaryWire = docBefore.routes.find(
    (route) => route.id !== internalWire.id,
  )!;
  const boundaryPointsBefore = await page
    .locator(`[data-canvas-hit-id="${boundaryWire.id}"]`)
    .getAttribute("points");

  // Stationary Ctrl+click on the selected internal wire toggles it without moving anything.
  const internalWireBox = (await page
    .locator(`[data-canvas-hit-id="${internalWire.id}"]`)
    .boundingBox())!;
  const wireMid = centre(internalWireBox);
  await modifierDrag(page, wireMid, wireMid, CTRL);
  await expect(page.getByRole("menu")).toHaveCount(0);
  expect(Math.abs((await r1.boundingBox())!.y - r1Before.y)).toBeLessThan(2);

  // Re-select the region and Control+drag from the internal wire: the whole
  // region (R1, C1, internal wire) moves intact, no context menu opens, and
  // the boundary wire stays at its authored coordinates on an open stub.
  await marqueeSelectRegion();
  await modifierDrag(page, wireMid, { x: wireMid.x, y: wireMid.y + 130 }, CTRL);
  await expect(page.getByRole("menu")).toHaveCount(0);

  const r1After = (await r1.boundingBox())!;
  const c1After = (await c1.boundingBox())!;
  const r3After = (await r3.boundingBox())!;
  const deltaY = r1After.y - r1Before.y;
  expect(deltaY).toBeGreaterThan(80);
  expect(Math.abs(c1After.y - c1Before.y - deltaY)).toBeLessThan(2);
  expect(Math.abs(r3After.y - r3Before.y)).toBeLessThan(2);
  // Boundary wire kept its exact authored geometry.
  expect(
    await page
      .locator(`[data-canvas-hit-id="${boundaryWire.id}"]`)
      .getAttribute("points"),
  ).toBe(boundaryPointsBefore);
  // Selection stays intact after region drop.
  await expect(r1).toHaveClass(/selected/);
  await expect(c1).toHaveClass(/selected/);

  // Electrically: R1 and C1 remain connected via internalWire, while R3 is
  // separated onto a stationary open stub.
  const docAfter: SchematicDocument = (await exportedProject(page))
    .documents[0];
  const r1Net = docAfter.nets.find((net) =>
    net.terminals.some((t) => t.instanceId === r1Id && t.pinName === "2"),
  )!;
  expect(r1Net.terminals).toContainEqual(
    expect.objectContaining({ instanceId: c1Id, pinName: "2" }),
  );
  const r3Net = docAfter.nets.find((net) =>
    net.terminals.some((t) => t.instanceId === r3Id && t.pinName === "1"),
  )!;
  expect(r3Net.terminals).not.toContainEqual(
    expect.objectContaining({ instanceId: c1Id }),
  );

  // One Undo restores the region and its boundary connection cleanly.
  await page.keyboard.press("ControlOrMeta+z");
  await expect
    .poll(async () => Math.round((await r1.boundingBox())!.y))
    .toBe(Math.round(r1Before.y));
});
