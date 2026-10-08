import { expect, test, type Page } from "@playwright/test";
import { createEmptyProject, createRoutePath } from "@icm/model";

import {
  chooseComponent,
  closeProjectTools,
  downloadBytes,
  parseSavedProject,
} from "./editor-fixtures";

async function placeComponent(
  page: Page,
  symbolId: string,
  position: { x: number; y: number },
): Promise<void> {
  await chooseComponent(page, symbolId);
  await page.getByTestId("schematic-canvas").click({ position });
  await page.keyboard.press("Escape");
}

for (const zoomOutSteps of [0, 4, 8]) {
  test(`mixed drag reaches adjacent grid landings without self-contact at zoom level ${zoomOutSteps}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const project = createEmptyProject("mixed-move", "Mixed move");
    const doc = project.documents[0]!;
    doc.instances.push({
      id: "R",
      symbolId: "resistor",
      placement: { position: { x: 400, y: 400 }, rotation: 0, mirror: "none" },
    });
    doc.nets.push({ id: "loose", terminals: [] });
    doc.junctions.push(
      { id: "a", netId: "loose", position: { x: 410, y: 380 } },
      { id: "b", netId: "loose", position: { x: 510, y: 380 } },
    );
    doc.routes.push(
      createRoutePath({
        id: "wire",
        netId: "loose",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
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
    doc.drafting = {
      objects: [
        {
          id: "note",
          kind: "text",
          content: { runs: [{ kind: "text", value: "note" }] },
          anchor: { kind: "free", position: { x: 453, y: 440 } },
          alignment: "start",
          rotation: 0,
          locked: false,
          zIndex: 0,
        },
      ],
    };
    await page.goto("/editor");
    await page.getByTestId("project-file").setInputFiles({
      name: "mixed.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    const hit = page.getByTestId("hit-R");
    await expect(hit).toBeVisible();
    await closeProjectTools(page);
    for (let i = 0; i < zoomOutSteps; i++)
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.focus();
    await page.keyboard.press("Control+a");
    await expect(page.getByTestId("drafting-hit-note")).toHaveClass(/selected/);
    const before = (await hit.boundingBox())!;
    const frame = await canvas.evaluate((element) => {
      const matrix = (element as SVGSVGElement).getScreenCTM()!;
      return { scale: matrix.a };
    });
    const start = {
      x: before.x + before.width / 2,
      y: before.y + before.height / 2,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const dx of [40, 50, 60]) {
      await page.mouse.move(start.x + dx * frame.scale, start.y);
      await expect
        .poll(async () =>
          Math.round(((await hit.boundingBox())!.x - before.x) / frame.scale),
        )
        .toBe(dx);
    }
    await page.mouse.up();
    await expect
      .poll(async () =>
        Math.round(((await hit.boundingBox())!.x - before.x) / frame.scale),
      )
      .toBe(60);
    const saved = parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(
        "utf8",
      ),
    ) as typeof project;
    const moved = saved.documents[0]!;
    expect(moved.instances[0]!.placement!.position).toEqual({ x: 460, y: 400 });
    expect(moved.nets.flatMap((net) => net.terminals)).toEqual([]);
    expect(moved.junctions.find((j) => j.id === "a")!.position).toEqual({
      x: 470,
      y: 380,
    });
    await canvas.focus();
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () =>
        Math.round(((await hit.boundingBox())!.x - before.x) / frame.scale),
      )
      .toBe(0);
  });
}

for (const zoomOutSteps of [0, 8]) {
  test(`retained mixed-drag contact connects on drop at zoom level ${zoomOutSteps}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    const project = createEmptyProject("contact-move", "Contact move");
    const doc = project.documents[0]!;
    doc.instances.push(
      {
        id: "R",
        symbolId: "resistor",
        placement: {
          position: { x: 400, y: 400 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "target",
        symbolId: "resistor",
        placement: {
          position: { x: 460, y: 460 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    doc.nets.push({ id: "signal", terminals: [] });
    doc.annotations.push({
      id: "label",
      kind: "net-label",
      netId: "signal",
      binding: { kind: "net-name", netId: "signal" },
      anchor: { kind: "free", position: { x: 353, y: 357 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    doc.drafting = {
      objects: [
        {
          id: "note",
          kind: "text",
          content: { runs: [{ kind: "text", value: "note" }] },
          anchor: { kind: "free", position: { x: 353, y: 440 } },
          alignment: "start",
          rotation: 0,
          locked: false,
          zIndex: 0,
        },
      ],
    };
    await page.goto("/editor");
    await page.getByTestId("project-file").setInputFiles({
      name: "contact.icproj.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(project)),
    });
    await expect(page.getByTestId("hit-R")).toBeVisible();
    await closeProjectTools(page);
    // Tiny fixtures auto-fit at several hundred percent. Establish an actual
    // normal view before testing it and the reduced view below.
    const zoom = page.getByRole("status", { name: "Current zoom" });
    while (Number.parseInt(await zoom.innerText(), 10) > 100)
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    for (let i = 0; i < zoomOutSteps; i++)
      await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    const canvas = page.getByTestId("schematic-canvas");
    await canvas.focus();
    await page.keyboard.press("Control+a");
    await page.getByTestId("hit-target").click({ modifiers: ["Shift"] });
    await expect(page.getByTestId("hit-target")).not.toHaveClass(/selected/);
    const hit = page.getByTestId("hit-R");
    await expect(hit).toHaveClass(/selected/);
    await expect(page.getByTestId("drafting-hit-note")).toHaveClass(/selected/);
    const before = (await hit.boundingBox())!;
    const artwork = page.locator('[data-layer="symbols"] [data-object-id="R"]');
    const beforeArtwork = (await artwork.boundingBox())!;
    const scale = await canvas.evaluate(
      (element) => (element as SVGSVGElement).getScreenCTM()!.a,
    );
    const start = {
      x: before.x + before.width / 2,
      y: before.y + before.height / 2,
    };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    for (const nudge of [0, 4]) {
      await page.mouse.move(
        start.x + (60 + nudge) * scale,
        start.y + (100 + nudge) * scale,
      );
      await expect
        .poll(async () => ({
          x: Math.round(
            ((await artwork.boundingBox())!.x - beforeArtwork.x) / scale,
          ),
          y: Math.round(
            ((await artwork.boundingBox())!.y - beforeArtwork.y) / scale,
          ),
        }))
        .toEqual({ x: 60, y: 100 });
    }
    await page.mouse.up();
    const saved = parseSavedProject(
      (await downloadBytes(page, "File", "Export Project File…")).toString(
        "utf8",
      ),
    ) as typeof project;
    const moved = saved.documents[0]!;
    expect(
      moved.instances.find((i) => i.id === "R")!.placement!.position,
    ).toEqual({ x: 460, y: 500 });
    expect(
      moved.instances.find((i) => i.id === "target")!.placement!.position,
    ).toEqual({ x: 460, y: 460 });
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
    await canvas.focus();
    await page.keyboard.press("Control+z");
    await expect
      .poll(async () =>
        Math.round(((await hit.boundingBox())!.x - before.x) / scale),
      )
      .toBe(0);
  });
}

test("selection traces the device and marks carried wires as would-move", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  await placeComponent(page, "resistor", { x: 300, y: 380 });
  const instances = page.locator('[data-canvas-hit-kind="instance"]');
  await expect(instances).toHaveCount(2);

  // Wire the bottom pin of the first to the top pin of the second
  // (resistor pin "2" faces +y, pin "1" faces -y).
  const ids = await instances.evaluateAll((elements) =>
    elements.map((element) => element.getAttribute("data-canvas-hit-id")),
  );
  await page.keyboard.press("w");
  await page.getByTestId(`terminal-${ids[0]}-2`).click();
  await page.getByTestId(`terminal-${ids[1]}-1`).click();
  await page.keyboard.press("Escape");
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
});

test("an instance label is not tinted a second time beside its device", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 300, y: 220 });
  const instance = page.locator('[data-canvas-hit-kind="instance"]').first();
  const label = page.locator('[data-canvas-hit-kind="annotation"]').first();
  await instance.click();

  // The label rides along with the device it names, and the halo already says
  // so. A would-move box on the label repeated that next to a device wearing
  // no box at all.
  await expect(label).toHaveClass(/hit-target annotation-text-hit$/);

  // Selecting the label in its own right is a different thing to say, and it
  // still marks itself: answering a deliberate click with nothing would be
  // worse than the tint this test removes.
  await label.click({ modifiers: ["Shift"], force: true });
  await expect(label).toHaveClass(/selected/);
});
