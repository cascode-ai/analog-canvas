// Turning and mirroring parts, marquee selections and the labels a part
// carries.

import {
  expectStatus,
  placeText,
  setComponentCodeField,
} from "./editor-fixtures";
import type { SchematicDocument } from "@icm/model";
import { expect, test } from "@playwright/test";
import {
  exportedDocument,
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";
import { closeSelectionShelf, awaitCanvasSettled } from "./canvas-fixtures.js";

test("Ctrl+R mirrors a selected component instead of refreshing", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 340, y: 220 });
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("Control+r");
  const saved = await exportedDocument(page);
  expect(saved.instances[0].placement).toMatchObject({
    rotation: 0,
    mirror: "vertical",
  });
});

test("turns and flips a marquee selection with its labels and a note as one body, not each part in place", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await placeComponent(page, "resistor", { x: 220, y: 240 });
  await placeComponent(page, "capacitor", { x: 340, y: 240 });
  await placeComponent(page, "diode", { x: 460, y: 240 });
  // A free note under the row joins the drawing.
  await placeText(page, { x: 300, y: 290 });
  await page.getByRole("textbox", { name: "Canvas text editor" }).fill("NOTE");
  await page.getByRole("button", { name: "Apply text changes" }).click();
  await page.getByTestId(/^drafting-hit-note-/).click();
  await openSelectionShelf(page);
  await setComponentCodeField(page, "appearance.alignment", "start");
  await closeSelectionShelf(page);

  const centres = async () =>
    page
      .locator('[data-layer="symbols"] [data-object-id]')
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const box = (element as SVGGraphicsElement).getBBox();
            return {
              id: element.getAttribute("data-object-id") ?? "",
              x: box.x + box.width / 2,
              y: box.y + box.height / 2,
            };
          })
          .sort((left, right) => left.x - right.x || left.y - right.y),
      );
  const spread = (points: { x: number; y: number }[]) => ({
    x:
      Math.max(...points.map((point) => point.x)) -
      Math.min(...points.map((point) => point.x)),
    y:
      Math.max(...points.map((point) => point.y)) -
      Math.min(...points.map((point) => point.y)),
  });

  const before = await centres();
  expect(before).toHaveLength(3);
  // The three sit in a row, so the row's width dwarfs its height.
  expect(spread(before).x).toBeGreaterThan(100);

  // A window around the parts and the note, measured once the panels have
  // stopped animating the canvas.
  await awaitCanvasSettled(canvas);
  const boxes = await page
    .locator(
      '[data-canvas-hit-kind="instance"], [data-canvas-hit-kind="drafting"]',
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().toJSON()),
    );
  const left = Math.min(...boxes.map((box) => box.left)) - 30;
  const top = Math.min(...boxes.map((box) => box.top)) - 30;
  await page.mouse.move(left, top);
  await page.mouse.down();
  await page.mouse.move(
    Math.max(...boxes.map((box) => box.right)) + 30,
    Math.max(...boxes.map((box) => box.bottom)) + 30,
    { steps: 12 },
  );
  await page.mouse.up();
  await expectStatus(page, "Selected");

  // Flipping left to right reverses the row. Flipping each part about its own
  // centre would have left the order exactly as it was.
  const initial: SchematicDocument = await exportedDocument(page);
  await page.keyboard.press("Shift+R");
  await expectStatus(page, "as one group");
  expect((await centres()).map((item) => item.id)).toEqual(
    before.map((item) => item.id).reverse(),
  );
  // Parts, their labels and the note all reflect about one group axis: each
  // position and its mirror image sum to the same twice-the-axis. A label
  // mirrored twice, or about its own part, would break the sum.
  const mirrored: SchematicDocument = await exportedDocument(page);
  const xs = (document: SchematicDocument) => [
    ...document.instances.map((instance) => instance.placement!.position.x),
    ...document.annotations.map((annotation) =>
      annotation.anchor.kind === "object"
        ? annotation.anchor.fallbackPosition!.x
        : Number.NaN,
    ),
    ...document.drafting!.objects.map((object) =>
      object.anchor.kind === "free" ? object.anchor.position.x : Number.NaN,
    ),
  ];
  const sums = xs(initial).map((x, index) => x + xs(mirrored)[index]!);
  expect(sums.length).toBeGreaterThan(4);
  expect(new Set(sums).size).toBe(1);
  const note = mirrored.drafting!.objects[0]!;
  expect(note.kind === "text" && note.alignment).toBe("end");
  // A second flip puts everything back exactly.
  await page.keyboard.press("Shift+R");
  const restored: SchematicDocument = await exportedDocument(page);
  expect(restored.instances).toEqual(initial.instances);
  expect(restored.annotations).toEqual(initial.annotations);
  expect(restored.drafting).toEqual(initial.drafting);

  // One 90-degree turn stands the row up: the arrangement itself rotates rather
  // than each symbol spinning where it stands.
  await page.keyboard.press("r");
  const turned = spread(await centres());
  expect(turned.x).toBeLessThan(20);
  expect(turned.y).toBeGreaterThan(100);
});

test("swaps a comparator's + and - without turning the body over", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  await placeComponent(page, "comparator", { x: 400, y: 300 });
  await canvas.click({ position: { x: 400, y: 300 } });
  await openSelectionShelf(page);

  const body = page.locator('[data-layer="symbols"] [data-object-id]').first();
  const readBody = () =>
    body.evaluate((element) => ({
      transform: element.getAttribute("transform") ?? "",
      paths: Array.from(element.querySelectorAll("path")).map(
        (path) => path.getAttribute("d") ?? "",
      ),
      // The + is the only vertical stroke among the polarity marks.
      plusMarkY: Array.from(element.querySelectorAll("line"))
        .filter((line) => line.getAttribute("x1") === line.getAttribute("x2"))
        .map(
          (line) =>
            (Number(line.getAttribute("y1")) +
              Number(line.getAttribute("y2"))) /
            2,
        ),
    }));

  const before = await readBody();
  expect(before.plusMarkY).toHaveLength(1);
  expect(before.plusMarkY[0]!).toBeGreaterThan(0);

  await setComponentCodeField(page, "appearance.inputsSwapped", true);
  await expect
    .poll(async () => (await readBody()).plusMarkY)
    .toEqual([-before.plusMarkY[0]!]);

  const after = await readBody();
  // The + crossed to the other input.
  expect(after.plusMarkY[0]!).toBe(-before.plusMarkY[0]!);
  // Everything that is not a polarity mark held still. A reflection would
  // have turned the triangle and the transfer-characteristic glyph over with
  // the marks, and hung a scale() on the body.
  expect(after.paths).toEqual(before.paths);
  expect(after.transform).toBe(before.transform);
  expect(after.transform).not.toContain("scale");
});

test("Properties mirror buttons carry the MOS name and value with the part, and undo restores them", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 340, y: 220 });
  const initial = await exportedDocument(page);
  const labels = (document: SchematicDocument) =>
    document.annotations.filter(
      (annotation) =>
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === "M1",
    );
  expect(labels(initial).length).toBeGreaterThan(0);
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toBeVisible();
  const editor = page.getByTestId("component-property-code-editor");

  await editor.getByRole("button", { name: "Mirror top to bottom" }).click();
  const flipped = await exportedDocument(page);
  expect(flipped.instances[0].placement.mirror).toBe("vertical");
  expect(labels(flipped)).not.toEqual(labels(initial));
  await editor.getByRole("button", { name: "Mirror top to bottom" }).click();
  expect((await exportedDocument(page)).annotations).toEqual(
    initial.annotations,
  );

  await editor.getByRole("button", { name: "Mirror left to right" }).click();
  const mirrored = await exportedDocument(page);
  expect(mirrored.instances[0].placement.mirror).toBe("horizontal");
  expect(labels(mirrored).map((label: { id: string }) => label.id)).toEqual(
    labels(initial).map((label) => label.id),
  );
  expect(labels(mirrored)).not.toEqual(labels(initial));
  await page.keyboard.press("Escape");
  await page.keyboard.press("ControlOrMeta+z");
  expect((await exportedDocument(page)).annotations).toEqual(
    initial.annotations,
  );
});

test("rotating resistor and capacitor with reference and value labels preserves relative placement through 360°", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 260, y: 260 });
  await placeComponent(page, "capacitor", { x: 420, y: 260 });

  const readPartBoxes = async (instanceId: string) =>
    page.evaluate((id) => {
      const symbol = document.querySelector(
        `[data-layer="symbols"] [data-object-id="${id}"]`,
      ) as SVGGraphicsElement | null;
      const labels = Array.from(
        document.querySelectorAll(
          '[data-layer="annotations"] [data-object-id]',
        ),
      )
        .filter((el) => {
          const objId = el.getAttribute("data-object-id") ?? "";
          return (
            objId.endsWith(`-${id}`) || objId === `label-${id.toLowerCase()}`
          );
        })
        .map((el) => {
          const b = (el as SVGGraphicsElement).getBBox();
          return {
            id: el.getAttribute("data-object-id") ?? "",
            x: b.x,
            y: b.y,
            width: b.width,
            height: b.height,
          };
        });
      const sb = symbol!.getBBox();
      return {
        symbol: { x: sb.x, y: sb.y, width: sb.width, height: sb.height },
        labels,
      };
    }, instanceId);

  const overlaps = (
    a: { x: number; y: number; width: number; height: number },
    b: { x: number; y: number; width: number; height: number },
  ) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

  // Turn on value labels for both R1 (right-seated) and C1 (mirrored left-seated).
  for (const id of ["R1", "C1"]) {
    await page.getByTestId(`hit-${id}`).click();
    await openSelectionShelf(page);
    await setComponentCodeField(page, "display.value", true);
    await closeSelectionShelf(page);
  }
  await page.getByTestId("hit-C1").click();
  await page.keyboard.press("Shift+R");

  for (const id of ["R1", "C1"]) {
    await page.getByTestId(`hit-${id}`).click();
    const initial: SchematicDocument = await exportedDocument(page);
    const initialLabels = initial.annotations.filter(
      (a) => a.anchor.kind === "object" && a.anchor.objectId === id,
    );
    expect(initialLabels.length).toBeGreaterThanOrEqual(2);

    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press("r");
      const { symbol, labels } = await readPartBoxes(id);
      const refBox = labels.find((l) => l.id.includes("label"))!;
      const valBox = labels.find((l) => l.id.includes("value"))!;
      expect(refBox, `${id} step ${step + 1}`).toBeDefined();
      expect(valBox, `${id} step ${step + 1}`).toBeDefined();
      // Name stays above value and neither overlaps the body or each other.
      expect(refBox.y + refBox.height).toBeLessThanOrEqual(valBox.y + 1);
      expect(overlaps(refBox, valBox)).toBe(false);
      expect(overlaps(refBox, symbol)).toBe(false);
      expect(overlaps(valBox, symbol)).toBe(false);
    }

    const restored: SchematicDocument = await exportedDocument(page);
    const restoredLabels = restored.annotations.filter(
      (a) => a.anchor.kind === "object" && a.anchor.objectId === id,
    );
    expect(restoredLabels).toEqual(initialLabels);
  }
});
