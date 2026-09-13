import { expect, test, type Page } from "@playwright/test";

import { createEmptyProject, type SchematicDocument } from "@icm/model";
import { builtInSymbols } from "@icm/symbols";

import { awaitEditorReady, clickDrawTool } from "./editor-fixtures";

async function importInstances(
  page: Page,
  instances: SchematicDocument["instances"],
) {
  const project = createEmptyProject("analog-hit-bounds", "Analog hit bounds");
  project.documents[0]!.instances = instances;
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "analog-hit-bounds.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId(`hit-${instances[0]!.id}`)).toBeVisible();
}

async function screenPoint(page: Page, x: number, y: number) {
  return page.getByTestId("schematic-canvas").evaluate(
    (element, point) => {
      const screen = new DOMPoint(point.x, point.y).matrixTransform(
        (element as SVGSVGElement).getScreenCTM()!,
      );
      return { x: screen.x, y: screen.y };
    },
    { x, y },
  );
}

test("Analog Block hit boxes closely enclose browser-rendered artwork", async ({
  page,
}) => {
  const blocks = builtInSymbols.filter(
    (symbol) =>
      /^(?:opamp|voltage-amplifier|comparator|differential-transconductance)(?:-|$)/u.test(
        symbol.id,
      ) || ["transconductance", "adc", "dac"].includes(symbol.id),
  );
  expect(blocks).toHaveLength(23);
  const instances: SchematicDocument["instances"] = blocks.map(
    (symbol, index) => ({
      id: `U${index + 1}`,
      symbolId: symbol.id,
      placement: {
        position: {
          x: 100 + (index % 6) * 140,
          y: 100 + Math.floor(index / 6) * 120,
        },
        rotation: 0,
        mirror: "none",
      },
    }),
  );
  instances.push(
    {
      id: "U24",
      symbolId: "opamp-differential",
      placement: { position: { x: 800, y: 460 }, rotation: 90, mirror: "none" },
    },
    {
      id: "U25",
      symbolId: "opamp-differential",
      placement: {
        position: { x: 100, y: 580 },
        rotation: 0,
        mirror: "horizontal",
      },
    },
  );
  await importInstances(page, instances);

  // Read SVG geometry independently of the editor's bounds calculation. The
  // outer group includes the renderer's placement transform and upright text.
  const measurements = await page.getByTestId("schematic-canvas").evaluate(
    (canvas, ids) =>
      ids.map((id) => {
        const artwork = canvas
          .querySelector<SVGGraphicsElement>(
            `[data-layer="symbols"] [data-object-id="${id}"]`,
          )!
          .getBBox();
        const hit = canvas
          .querySelector<SVGGraphicsElement>(`[data-testid="hit-${id}"]`)!
          .getBBox();
        return {
          id,
          margins: [
            artwork.x - hit.x,
            artwork.y - hit.y,
            hit.x + hit.width - artwork.x - artwork.width,
            hit.y + hit.height - artwork.y - artwork.height,
          ],
        };
      }),
    instances.map((instance) => instance.id),
  );
  for (const { id, margins } of measurements) {
    for (const margin of margins) {
      expect(
        margin,
        `${id}: artwork must be inside hit box`,
      ).toBeGreaterThanOrEqual(-0.01);
      // getBBox excludes stroke; the small margin contains the miter tips.
      expect(margin, `${id}: no source-crop whitespace`).toBeLessThanOrEqual(
        4.01,
      );
    }
  }
});

test("FD Amp blank space does not capture clicks or marquees; body and pins remain usable", async ({
  page,
}) => {
  await importInstances(page, [
    {
      id: "U1",
      symbolId: "opamp-differential",
      placement: { position: { x: 200, y: 200 }, rotation: 0, mirror: "none" },
    },
  ]);
  // A one-symbol import auto-fits tightly. Leave room for the whole drag so
  // this checks object movement rather than edge-triggered canvas scrolling.
  for (let step = 0; step < 3; step += 1)
    await page.getByRole("button", { name: "Zoom out" }).click();
  const hit = page.getByTestId("hit-U1");
  const drag = async (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => {
    const from = await screenPoint(page, fromX, fromY);
    const to = await screenPoint(page, toX, toY);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  const blank = await screenPoint(page, 232, 200);
  await page.mouse.click(blank.x, blank.y);
  await expect(hit).not.toHaveClass(/selected/);

  // Right-to-left crossing of the old viewBox's blank strip selects nothing.
  await drag(242, 170, 230, 230);
  await expect(hit).not.toHaveClass(/selected/);
  // A left-to-right window enclosing the actual body and pins is sufficient.
  await drag(155, 170, 225, 230);
  await expect(hit).toHaveClass(/selected/);

  await drag(190, 200, 290, 260);
  await expect(hit).toHaveAttribute("x", "256");
  await expect(hit).toHaveAttribute("y", "231");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(hit).toHaveAttribute("x", "156");
  await expect(hit).toHaveAttribute("y", "171");

  await page.keyboard.press("Escape");
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-U1-IN+").click();
  const end = await screenPoint(page, 100, 190);
  await page.mouse.dblclick(end.x, end.y);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(1);
});

/**
 * A deliberate click on visible wire must select the wire even where the
 * symbol's blank hit rectangle overlaps it; the symbol body itself stays
 * selectable.
 */
test("clicking wire beside a symbol body selects the wire, not the box", async ({
  page,
}) => {
  await importInstances(page, [
    {
      id: "R1",
      symbolId: "resistor",
      placement: { position: { x: 300, y: 200 }, rotation: 0, mirror: "none" },
    },
  ]);
  // Cross the lower stem, away from endpoint hit circles. The previous fixture
  // picked at the bottom edge of the old viewBox, which also hit the pin.
  await clickDrawTool(page, "wire");
  const start = await screenPoint(page, 260, 210);
  const end = await screenPoint(page, 340, 210);
  await page.mouse.click(start.x, start.y);
  await page.mouse.dblclick(end.x, end.y);
  await page.keyboard.press("Escape");

  const overlap = await screenPoint(page, 307, 210);
  const candidates = await page.evaluate(
    ({ x, y }) =>
      document
        .elementsFromPoint(x, y)
        .map((element) => element.getAttribute("data-canvas-hit-kind")),
    overlap,
  );
  expect(candidates).toEqual(expect.arrayContaining(["route", "instance"]));
  await page.mouse.click(overlap.x, overlap.y);
  await expect(page.getByTestId("status")).toContainText("Selected route");

  // The body away from the wire still selects the symbol.
  await page.keyboard.press("Escape");
  const body = await screenPoint(page, 300, 198);
  await page.mouse.click(body.x, body.y);
  await expect(page.getByTestId("hit-R1")).toHaveClass(/selected/);
});
