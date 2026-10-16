import { expect, test } from "@playwright/test";
import { createEmptyProject, type SchematicDocument } from "@icm/model";

import {
  clickCommand,
  closeProjectTools,
  expectStatus,
  exportedProject,
  openProject,
  placeComponentAt,
} from "./editor-fixtures";
import {
  addStraightWire,
  centre,
  instanceIds,
  onScreen,
  placedInstance,
  wirePins,
} from "./canvas-fixtures";

const positionOf = (document: SchematicDocument, id: string) =>
  document.instances.find((instance) => instance.id === id)!.placement!
    .position;

/** A free-standing drafting text reading "note", anchored at `position`. */
function freeNote(position: {
  x: number;
  y: number;
}): NonNullable<SchematicDocument["drafting"]>["objects"][number] {
  return {
    id: "note",
    kind: "text",
    content: { runs: [{ kind: "text", value: "note" }] },
    anchor: { kind: "free", position },
    alignment: "start",
    rotation: 0,
    locked: false,
    zIndex: 0,
  };
}

test("M preserves Alt's no-contact preview at an unchanged placement click", async ({
  page,
}) => {
  const project = createEmptyProject("alt-move", "Alt move");
  const doc = project.documents[0]!;
  doc.instances.push(
    placedInstance("R", "resistor", 400, 400),
    placedInstance("target", "resistor", 440, 360),
  );
  await openProject(page, project);
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  await page.getByTestId("hit-R").click();
  await canvas.focus();
  await page.keyboard.press("m");
  await page.keyboard.down("Alt");
  const [landing] = await onScreen(canvas, [{ x: 440, y: 400 }]);
  await page.mouse.move(landing.x, landing.y);
  await page.mouse.click(landing.x, landing.y);
  await page.keyboard.up("Alt");
  const saved = (await exportedProject(page)) as typeof project;
  expect(positionOf(saved.documents[0]!, "R")).toEqual({ x: 440, y: 400 });
  // Coincident pins alone must not turn Alt's explicit no-contact move into a bond.
  expect(
    saved.documents[0]!.nets.some(
      (net) =>
        net.terminals.some((pin) => pin.instanceId === "R") &&
        net.terminals.some((pin) => pin.instanceId === "target"),
    ),
  ).toBe(false);
  await canvas.focus();
  await page.keyboard.press("Control+z");
  const restored = (await exportedProject(page)) as typeof project;
  expect(positionOf(restored.documents[0]!, "R")).toEqual({ x: 400, y: 400 });
});

test("a zoomed-out mixed drag reaches adjacent grid landings without self-contact and keeps a retained contact on drop", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const project = createEmptyProject("mixed-move", "Mixed move");
  const doc = project.documents[0]!;
  for (const [id, x, y] of [
    ["R", 400, 400],
    ["target", 460, 460],
  ] as const)
    doc.instances.push(placedInstance(id, "resistor", x, y));
  addStraightWire(
    doc,
    "wire",
    { id: "a", netId: "loose", position: { x: 410, y: 380 } },
    { id: "b", netId: "loose", position: { x: 510, y: 380 } },
  );
  doc.annotations.push({
    id: "label",
    kind: "net-label",
    netId: "loose",
    binding: { kind: "net-name", netId: "loose" },
    anchor: { kind: "free", position: { x: 453, y: 357 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  });
  doc.drafting = { objects: [freeNote({ x: 353, y: 440 })] };
  await openProject(page, project);
  const hit = page.getByTestId("hit-R");
  await expect(hit).toBeVisible();
  await closeProjectTools(page);
  // Tiny fixtures auto-fit at several hundred percent. From a normal view,
  // zoom well out, where one screen pixel spans several document units.
  const zoom = page.getByRole("status", { name: "Current zoom" });
  while (Number.parseInt(await zoom.innerText(), 10) > 100)
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  for (let i = 0; i < 8; i++)
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.getByTestId("hit-target").click({ modifiers: ["Shift"] });
  await expect(page.getByTestId("hit-target")).not.toHaveClass(/selected/);
  await expect(hit).toHaveClass(/selected/);
  await expect(page.getByTestId("drafting-hit-note")).toHaveClass(/selected/);
  const before = (await hit.boundingBox())!;
  // Measure the drawn symbol: a semantic preview leaves the hit plane behind.
  const artwork = page.locator('[data-layer="symbols"] [data-object-id="R"]');
  const beforeArtwork = (await artwork.boundingBox())!;
  const scale = await canvas.evaluate(
    (element) => (element as SVGSVGElement).getScreenCTM()!.a,
  );
  const travel = async () => ({
    x: Math.round(((await artwork.boundingBox())!.x - beforeArtwork.x) / scale),
    y: Math.round(((await artwork.boundingBox())!.y - beforeArtwork.y) / scale),
  });
  const start = centre(before);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (const dx of [40, 50, 60]) {
    if (dx === 50) {
      // A real stream of sub-pixel inputs must leave the previous grid cell;
      // cached input keys may not drift along with unevaluated pointer steps.
      for (let step = 1; step <= 20; step++)
        await page.mouse.move(start.x + (40 + step * 0.5) * scale, start.y);
    } else await page.mouse.move(start.x + dx * scale, start.y);
    await expect.poll(travel).toEqual({ x: dx, y: 0 });
  }
  // On down to the target's pin: a sub-grid nudge keeps the contact.
  for (const nudge of [0, 4]) {
    await page.mouse.move(
      start.x + (60 + nudge) * scale,
      start.y + (100 + nudge) * scale,
    );
    await expect.poll(travel).toEqual({ x: 60, y: 100 });
  }
  await page.mouse.up();
  const moved = ((await exportedProject(page)) as typeof project).documents[0]!;
  expect(positionOf(moved, "R")).toEqual({ x: 460, y: 500 });
  expect(positionOf(moved, "target")).toEqual({ x: 460, y: 460 });
  expect(
    moved.nets.some(
      (net) =>
        net.terminals.some(
          (pin) => pin.instanceId === "R" && pin.pinName === "1",
        ) &&
        net.terminals.some(
          (pin) => pin.instanceId === "target" && pin.pinName === "2",
        ),
    ),
  ).toBe(true);
  // The carried loose wire travelled with the part and touched nothing.
  const carried = moved.junctions.find((j) => j.id === "a")!;
  expect(carried.position).toEqual({ x: 470, y: 480 });
  expect(moved.nets.find((net) => net.id === carried.netId)!.terminals).toEqual(
    [],
  );
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await expect.poll(travel).toEqual({ x: 0, y: 0 });
});

test("a rectangle carries its unselected text during preview, and the text alone lands at an integer fine offset", async ({
  page,
}) => {
  const project = createEmptyProject("shape-text", "Shape text");
  const doc = project.documents[0]!;
  doc.drafting = {
    objects: [
      {
        id: "host",
        kind: "rectangle",
        center: { x: 400, y: 400 },
        anchor: { kind: "free", position: { x: 400, y: 400 } },
        width: 80,
        height: 40,
        rotation: 0,
        lineStyle: "solid",
        styleOverride: { fillColor: "#ffffff" },
        locked: false,
        zIndex: 0,
      },
      {
        id: "note",
        kind: "text",
        content: { runs: [{ kind: "text", value: "follows" }] },
        anchor: {
          kind: "object",
          objectId: "host",
          localOffset: { x: 13, y: 47 },
          fallbackPosition: { x: 413, y: 447 },
        },
        alignment: "start",
        rotation: 0,
        locked: false,
        zIndex: 0,
      },
    ],
  };
  await openProject(page, project);
  const host = page.getByTestId("drafting-hit-host");
  await expect(host).toBeVisible();
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  const note = page.getByTestId("drafting-hit-note");
  const before = (await host.boundingBox())!;
  const beforeNote = (await note.boundingBox())!;
  const scale = await canvas.evaluate(
    (element) => (element as SVGSVGElement).getScreenCTM()!.a,
  );
  // How far the text has moved across, in document units.
  const noteShift = async () =>
    Math.round(((await note.boundingBox())!.x - beforeNote.x) / scale);
  const start = centre(before);
  // Alt-drags by (dx, dy) document units until the text has moved 30 across.
  const altDragBy = async (from: typeof start, dx: number, dy: number) => {
    await page.keyboard.down("Alt");
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx * scale, from.y + dy * scale);
    await expect.poll(noteShift).toBe(30);
    await page.mouse.up();
    await page.keyboard.up("Alt");
  };
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementFromPoint(x, y)
          ?.closest("[data-canvas-hit-id]")
          ?.getAttribute("data-canvas-hit-id"),
      start,
    ),
  ).toBe("host");
  // Visual-only M uses the same closure/proposal as pointer movement. Its
  // cancellation releases preview state without changing the attachment.
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("m");
  const [destination] = await onScreen(canvas, [{ x: 430, y: 410 }]);
  await page.mouse.move(destination.x, destination.y);
  await expect.poll(noteShift).toBe(30);
  await page.keyboard.press("Escape");
  await expect.poll(noteShift).toBe(0);
  await host.click();
  await altDragBy(start, 30, 10);
  const saved = (await exportedProject(page)) as typeof project;
  expect(saved.documents[0]!.drafting!.objects[0]!).toMatchObject({
    kind: "rectangle",
    center: { x: 430, y: 410 },
  });
  expect(saved.documents[0]!.drafting!.objects[1]!.anchor).toEqual(
    doc.drafting.objects[1]!.anchor,
  );
  await canvas.focus();
  await page.keyboard.press("Control+z");
  await expect.poll(noteShift).toBe(0);

  // Alt-dragged on its own by a fractional distance, the text keeps an
  // integer fine offset from its stationary host.
  await canvas.focus();
  await page.keyboard.press("Control+d");
  await expect(host).not.toHaveClass(/selected/);
  await altDragBy(centre(beforeNote), 30.25, 10.25);
  const fine = (await exportedProject(page)) as typeof project;
  expect(fine.documents[0]!.drafting!.objects[1]!.anchor).toMatchObject({
    kind: "object",
    objectId: "host",
    localOffset: { x: 43, y: 57 },
  });
  expect(fine.documents[0]!.drafting!.objects[0]!).toMatchObject({
    center: { x: 400, y: 400 },
  });
});

test("M drop recomputes its mixed-selection landing after the camera pans under a stationary pointer", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  const project = createEmptyProject("camera-move", "Camera move");
  const document = project.documents[0]!;
  document.instances.push(placedInstance("R", "resistor", 400, 400));
  document.drafting = { objects: [freeNote({ x: 500, y: 440 })] };
  await openProject(page, project);
  await closeProjectTools(page);
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.focus();
  await page.keyboard.press("Control+a");
  await page.keyboard.press("m");
  const [pointer] = await onScreen(canvas, [{ x: 440, y: 400 }]);
  await page.mouse.move(pointer.x, pointer.y);
  await expect(canvas).toHaveClass(/semantic-move-preview/);
  const cameraBefore = await canvas.getAttribute("viewBox");
  // Horizontal trackpad pan changes the logical point under this same cursor.
  await page.mouse.wheel(120, 0);
  await expect
    .poll(() => canvas.getAttribute("viewBox"))
    .not.toBe(cameraBefore);
  const landing = await canvas.evaluate((element, pointer) => {
    const point = new DOMPoint(pointer.x, pointer.y).matrixTransform(
      (element as SVGSVGElement).getScreenCTM()!.inverse(),
    );
    return {
      x: Math.round(point.x / 10) * 10,
      y: Math.round(point.y / 10) * 10,
    };
  }, pointer);
  expect(landing).not.toEqual({ x: 440, y: 400 });
  await page.mouse.click(pointer.x, pointer.y);
  await expect(canvas).not.toHaveClass(/semantic-move-preview/);
  const saved = (await exportedProject(page)) as typeof project;
  expect(saved.documents[0]!.instances[0]!.placement!.position).toEqual(
    landing,
  );
  expect(saved.documents[0]!.drafting!.objects[0]!.anchor).toEqual({
    kind: "free",
    position: { x: 500 + landing.x - 400, y: 440 + landing.y - 400 },
  });
  await canvas.focus();
  await page.keyboard.press("Control+z");
  const restored = (await exportedProject(page)) as typeof project;
  expect(restored.documents[0]!.instances[0]!.placement!.position).toEqual({
    x: 400,
    y: 400,
  });
  expect(restored.documents[0]!.drafting!.objects[0]!.anchor).toEqual({
    kind: "free",
    position: { x: 500, y: 440 },
  });
});

test("selection traces the device, marks carried wires as would-move, and leaves its label untinted", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 300, y: 220 });
  await placeComponentAt(page, "resistor", { x: 300, y: 380 });
  const instances = page.locator('[data-canvas-hit-kind="instance"]');
  await expect(instances).toHaveCount(2);

  // Wire the bottom pin of the first to the top pin of the second
  // (resistor pin "2" faces +y, pin "1" faces -y).
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await wirePins(page, `${ids[0]}-2`, `${ids[1]}-1`);
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);

  await instances.nth(0).click();
  await expect(instances.nth(0)).toHaveClass(/hit-target selected/);
  // Nothing is drawn around the device: the hit rectangle carries the click,
  // never the mark. Selection shows as a halo tracing the symbol's own lines.
  const box = await instances.nth(0).evaluate((element) => {
    const style = getComputedStyle(element);
    return { fill: style.fill, stroke: style.stroke };
  });
  expect(box.fill).toBe("rgba(0, 0, 0, 0)");
  expect(box.stroke).toBe("rgba(0, 0, 0, 0)");

  const halo = page.getByTestId("selection-halo-selected");
  await expect(halo).toBeAttached();
  await expect(halo.locator(`[data-object-id="${ids[0]}"]`)).toBeAttached();
  await expect(halo.locator(`[data-object-id="${ids[1]}"]`)).toHaveCount(0);

  // The attached wire would travel with a drag, so it carries the
  // would-move tint while staying unselected.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveClass(
    /would-move|selected/,
  );

  // The label rides along with the device it names, and the halo already says
  // so: no would-move box repeats that beside a device wearing no box at all.
  const label = page.getByTestId(`annotation-hit-instance-label-${ids[0]}`);
  await expect(label).toHaveClass(/hit-target annotation-text-hit$/);
  // Selecting the label in its own right still marks it.
  await label.click({ modifiers: ["Shift"], force: true });
  await expect(label).toHaveClass(/selected/);
});

test("a Net highlight set from the Check Report can always be cleared", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 260, y: 200 });
  await placeComponentAt(page, "resistor", { x: 260, y: 420 });
  const ids = await instanceIds(page);

  // An unnamed wire between two pins exports with a generated name, which the
  // Check Report lists as a clickable GENERATED_NET_NAME finding.
  await page.keyboard.press("w");
  await wirePins(page, `${ids[0]}-2`, `${ids[1]}-1`);

  await clickCommand(page, "Netlist", "Review Netlist Issues…");
  const preflight = page.getByRole("dialog", { name: "Check Report" });
  await preflight
    .getByRole("button", { name: /GENERATED_NET_NAME/ })
    .first()
    .click();
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();

  // Close the report via its backdrop; the highlight persists on the canvas.
  await page
    .locator(".insert-dialog-backdrop")
    .click({ position: { x: 5, y: 5 } });
  await expect(preflight).toHaveCount(0);
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();

  // The finding navigation selected the net's route, so H toggles the
  // highlight off, back on, and off again.
  // Unhighlighted, the selected wire's Net still glows faintly; the
  // highlight replaces the glow while it shows (2026-10-14).
  const glow = page.getByTestId("connected-net-glow");
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
  await expect(page.getByTestId("status")).toHaveText(/Cleared Net highlight/);
  await expect(glow).toBeVisible();
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
  await expect(glow).toHaveCount(0);

  // Escape clears it too, selection or not.
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);

  // Even with the selection gone entirely, a lingering highlight stays
  // clearable from the keyboard.
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toBeVisible();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 60, y: 60 } });
  await page.keyboard.press("h");
  await expect(page.getByTestId("net-highlight-overlay")).toHaveCount(0);
});

test("a component dragged over a wire paints a red warning on the covered span", async ({
  page,
}) => {
  // Three resistors, the first two joined by one vertical wire; the third,
  // unwired, is the drag subject.
  await page.goto("/editor");
  await placeComponentAt(page, "resistor", { x: 200, y: 200 });
  await placeComponentAt(page, "resistor", { x: 200, y: 460 });
  await placeComponentAt(page, "resistor", { x: 500, y: 330 });
  const ids = await instanceIds(page);
  await page.keyboard.press("w");
  await wirePins(page, `${ids[0]}-2`, `${ids[1]}-1`);
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
  await expect(page.getByTestId("wire-under-symbol-overlay")).toHaveCount(0);
  const wire = (await page
    .locator('[data-canvas-hit-kind="route"]')
    .first()
    .boundingBox())!;

  // Turn the third resistor sideways first: its body then lies across the
  // vertical wire while both pins sit far off the conductor, so the drop
  // buries the wire without acquiring contacts. (A pin-exact drop is the
  // series-insertion gesture and no longer leaves a buried span.)
  const third = page.getByTestId(`hit-${ids[2]}`);
  await third.click();
  await page.keyboard.press("r");
  const from = (await third.boundingBox())!;
  const target = centre(wire);
  await page.mouse.move(centre(from).x, centre(from).y);
  await page.mouse.down();
  await page.mouse.move(target.x, target.y, { steps: 8 });
  await page.mouse.up();

  const overlay = page.getByTestId("wire-under-symbol-overlay");
  await expect(overlay).toBeAttached();
  const lines = overlay.locator(".wire-under-symbol-paint");
  await expect(lines).not.toHaveCount(0);
  expect(await lines.first().boundingBox()).not.toBeNull();

  // Clicking the warned span still selects a wire (the warning itself is
  // pointer-transparent; the route hit band lies underneath).
  const hitLine = overlay.locator(".wire-under-symbol-hit").first();
  const lineBox = (await hitLine.boundingBox())!;
  await page.mouse.click(centre(lineBox).x, centre(lineBox).y);
  await expectStatus(page, "Selected a wire buried under a symbol");
  await expect(
    page.locator('[data-canvas-hit-kind="route"].selected'),
  ).not.toHaveCount(0);
});
