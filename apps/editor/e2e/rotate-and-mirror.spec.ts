// Turning and mirroring parts and marquee selections.

import { parseSavedProject } from "./editor-fixtures";
import type { SchematicDocument } from "@icm/model";
import { expect, test } from "@playwright/test";
import {
  clickDrawTool,
  downloadBytes,
  editComponentPropertyCode,
  setComponentCodeField,
  expectComponentCodeField,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";

test("Ctrl+R mirrors a selected component instead of refreshing", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "nmos", { x: 340, y: 220 });
  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("Control+r");
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(saved.documents[0].instances[0].placement).toMatchObject({
    rotation: 0,
    mirror: "vertical",
  });
});

test("component property code turns a connected part by 45 degrees", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 340, y: 220 });
  await placeComponent(page, "nmos", { x: 560, y: 220 });
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-R1-2").click();
  await page.getByTestId("terminal-M1-G").click();
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-R1").click();
  await openSelectionShelf(page);
  await editComponentPropertyCode(page, (code) => {
    code.rotation = 45;
  });

  await expectComponentCodeField(page, "rotation", 45);
  await expect(page.getByTestId("revision")).toHaveText("4");
  await expect(page.getByTestId("status")).toHaveText(
    "Applied Canvas property code to R1",
  );
  await expect(page.locator('[data-layer="routes"] polyline')).toHaveCount(1);
  const saved = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as { documents: SchematicDocument[] };
  expect(saved.documents[0]!.instances[0]!.placement?.rotation).toBe(45);
  const persistedBends = saved.documents[0]!.routes[0]!.legs.flatMap((leg) =>
    leg.to.kind === "bend" ? [leg.to.position] : [],
  );
  expect(
    persistedBends.every(
      (point) =>
        Number.isInteger(point.x) &&
        Number.isInteger(point.y) &&
        point.x % saved.documents[0]!.presentation.grid === 0 &&
        point.y % saved.documents[0]!.presentation.grid === 0,
    ),
  ).toBe(true);
});

test("turns a marquee selection as one body, not three parts in place", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await placeComponent(page, "resistor", { x: 220, y: 240 });
  await placeComponent(page, "capacitor", { x: 340, y: 240 });
  await placeComponent(page, "resistor", { x: 460, y: 240 });

  const centres = async () =>
    page
      .locator('[data-layer="symbols"] [data-object-id]')
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const box = (element as SVGGraphicsElement).getBBox();
            return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
          })
          .sort((left, right) => left.x - right.x || left.y - right.y),
      );

  const before = await centres();
  expect(before).toHaveLength(3);
  // The three sit in a row, so the row's width dwarfs its height.
  const spreadX = before[2]!.x - before[0]!.x;
  expect(spreadX).toBeGreaterThan(100);

  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 160, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 540, bounds.y + 310, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText("Selected");

  await page.keyboard.press("r");

  // One 90-degree turn stands the row up: the arrangement itself rotates rather
  // than each symbol spinning where it stands.
  const after = await centres();
  expect(after).toHaveLength(3);
  const afterSpreadX = after[2]!.x - after[0]!.x;
  const afterSpreadY =
    Math.max(...after.map((point) => point.y)) -
    Math.min(...after.map((point) => point.y));
  expect(afterSpreadX).toBeLessThan(20);
  expect(afterSpreadY).toBeGreaterThan(100);
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

test("flips a marquee selection as one body, not three parts in place", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await placeComponent(page, "resistor", { x: 220, y: 240 });
  await placeComponent(page, "capacitor", { x: 340, y: 240 });
  await placeComponent(page, "diode", { x: 460, y: 240 });

  const order = async () =>
    page
      .locator('[data-layer="symbols"] [data-object-id]')
      .evaluateAll((elements) =>
        elements
          .map((element) => {
            const box = (element as SVGGraphicsElement).getBBox();
            return {
              id: element.getAttribute("data-object-id") ?? "",
              x: box.x + box.width / 2,
            };
          })
          .sort((left, right) => left.x - right.x)
          .map((item) => item.id),
      );

  const before = await order();
  expect(before).toHaveLength(3);

  const bounds = (await canvas.boundingBox())!;
  await page.mouse.move(bounds.x + 160, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 540, bounds.y + 310, { steps: 12 });
  await page.mouse.up();
  await expect(page.getByTestId("status")).toContainText("Selected");

  await page.keyboard.press("Shift+R");
  // Flipping left to right reverses the row. Flipping each part about its own
  // centre would have left the order exactly as it was.
  await expect(page.getByTestId("status")).toContainText("as one group");
  expect(await order()).toEqual([...before].reverse());
});
