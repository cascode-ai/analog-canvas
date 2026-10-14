import { expect, test, type Page } from "@playwright/test";

import { createEmptyProject, type SchematicDocument } from "@icm/model";
import { builtInSymbols } from "@icm/symbols";

import {
  clickDrawTool,
  downloadBytes,
  expectStatus,
  openProject,
} from "./editor-fixtures";
import { addStraightWire, onScreen, placedInstance } from "./canvas-fixtures";

async function importInstances(
  page: Page,
  instances: SchematicDocument["instances"],
  configureDocument?: (document: SchematicDocument) => void,
) {
  const project = createEmptyProject("analog-hit-bounds", "Analog hit bounds");
  project.documents[0]!.instances = instances;
  configureDocument?.(project.documents[0]!);
  await openProject(page, project, "analog-hit-bounds.icproj.json");
  await expect(page.getByTestId(`hit-${instances[0]!.id}`)).toBeVisible();
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
  expect(blocks).toHaveLength(35);
  const instances: SchematicDocument["instances"] = blocks.map(
    (symbol, index) =>
      placedInstance(
        `U${index + 1}`,
        symbol.id,
        100 + (index % 6) * 140,
        100 + Math.floor(index / 6) * 120,
      ),
  );
  // A rotated and a mirrored copy, numbered after the catalogue above.
  instances.push(
    {
      id: `U${blocks.length + 1}`,
      symbolId: "opamp-differential",
      placement: { position: { x: 800, y: 460 }, rotation: 90, mirror: "none" },
    },
    {
      id: `U${blocks.length + 2}`,
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
        const artworkElement = canvas.querySelector<SVGGraphicsElement>(
          `[data-layer="symbols"] [data-object-id="${id}"]`,
        )!;
        const hitElement = canvas.querySelector<SVGGraphicsElement>(
          `[data-testid="hit-${id}"]`,
        )!;
        const artwork = artworkElement.getBoundingClientRect();
        const hit = hitElement.getBoundingClientRect();
        const matrix = artworkElement.getScreenCTM()!;
        const scale = Math.hypot(matrix.a, matrix.b);
        return {
          id,
          margins: [
            artwork.x - hit.x,
            artwork.y - hit.y,
            hit.x + hit.width - artwork.x - artwork.width,
            hit.y + hit.height - artwork.y - artwork.height,
          ].map((margin) => margin / scale),
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

test("FD Amp blank space does not capture clicks, body and pins remain usable, and a wire beside a symbol body beats its box", async ({
  page,
}) => {
  await importInstances(
    page,
    [
      placedInstance("U1", "opamp-differential", 200, 200),
      placedInstance("R1", "resistor", 60, 320),
    ],
    // A deliberate crossing, independent of the router's symbol avoidance.
    (document) =>
      addStraightWire(
        document,
        "crossing-route",
        { id: "cross-a", netId: "crossing-net", position: { x: 20, y: 330 } },
        { id: "cross-b", netId: "crossing-net", position: { x: 100, y: 330 } },
      ),
  );
  // A one-symbol import auto-fits tightly. Leave room for the whole drag so
  // this checks object movement rather than edge-triggered canvas scrolling.
  for (let step = 0; step < 3; step += 1)
    await page.getByRole("button", { name: "Zoom out" }).click();
  const hit = page.getByTestId("hit-U1");
  const canvas = page.getByTestId("schematic-canvas");
  const drag = async (
    fromX: number,
    fromY: number,
    toX: number,
    toY: number,
  ) => {
    const [from, to] = await onScreen(canvas, [
      { x: fromX, y: fromY },
      { x: toX, y: toY },
    ]);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  // A deliberate click on visible wire selects the wire even where the
  // symbol's blank hit rectangle overlaps it; the body stays selectable.
  const [overlap] = await onScreen(canvas, [{ x: 67, y: 330 }]);
  expect(
    await page.evaluate(
      ({ x, y }) =>
        document
          .elementsFromPoint(x, y)
          .map((element) => element.getAttribute("data-canvas-hit-kind")),
      overlap,
    ),
  ).toEqual(expect.arrayContaining(["route", "instance"]));
  await page.mouse.click(overlap.x, overlap.y);
  await expectStatus(page, /Selected wire on \S+/);
  await page.keyboard.press("Escape");
  const [body] = await onScreen(canvas, [{ x: 60, y: 318 }]);
  await page.mouse.click(body.x, body.y);
  await expect(page.getByTestId("hit-R1")).toHaveClass(/selected/);

  // This point is inside the old rectangular hit box but well above the
  // triangle edge and output leads.
  const [blank] = await onScreen(canvas, [{ x: 215, y: 175 }]);
  await page.mouse.click(blank.x, blank.y);
  await expect(hit).not.toHaveClass(/selected/);

  // Right-to-left crossing of the old viewBox's blank strip selects nothing.
  await drag(242, 170, 236, 230);
  await expect(hit).not.toHaveClass(/selected/);
  // A left-to-right window enclosing the actual body and pins is sufficient.
  await drag(155, 165, 235, 235);
  await expect(hit).toHaveClass(/selected/);

  await drag(190, 200, 290, 260);
  await expect(hit).toHaveAttribute("transform", /^translate\(300 260\)/u);
  await page.keyboard.press("ControlOrMeta+z");
  await expect(hit).toHaveAttribute("transform", /^translate\(200 200\)/u);

  await page.keyboard.press("Escape");
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-U1-IN+").click();
  const [end] = await onScreen(canvas, [{ x: 100, y: 190 }]);
  await page.mouse.dblclick(end.x, end.y);
  await page.keyboard.press("Escape");
  // The crossing wire, and the new wire from IN+.
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(2);
});

test("enlarged Analog Block triangles leave clear space around internal letters in canvas and SVG", async ({
  page,
}) => {
  await importInstances(
    page,
    [
      "opamp-lettered",
      "opamp-differential-lettered",
      "opamp-differential-crossed-lettered-inputs-swapped",
      "voltage-amplifier-lettered",
    ].map((symbolId, index) =>
      placedInstance(
        `U${index + 1}`,
        symbolId,
        150 + (index % 2) * 200,
        150 + Math.floor(index / 2) * 160,
      ),
    ),
  );
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  // Use actual font bounds in both surfaces: symbol-space stroke checks alone
  // cannot tell whether the browser's letter fits between the polarity rows.
  const surfaces = await page.evaluate((source) => {
    const exported = document.createElement("div");
    exported.innerHTML = source;
    exported.style.cssText =
      "position:fixed;left:0;top:0;width:800px;opacity:0;pointer-events:none";
    document.body.append(exported);
    const measure = (root: Element) =>
      [
        ...root.querySelectorAll<SVGGElement>(
          "[data-object-id][data-symbol-id]",
        ),
      ].map((group) => {
        const text = group.querySelector<SVGTextElement>(
          '[data-role="formula-text"]',
        )!;
        const letter = text.getBBox();
        const marks = [
          ...group.querySelectorAll<SVGLineElement>(
            'line[stroke-linecap="round"]',
          ),
        ];
        return {
          id: group.getAttribute("data-object-id"),
          gaps: marks.map((mark) => {
            const box = mark.getBBox();
            const gap = Math.hypot(
              Math.max(
                0,
                box.x - (letter.x + letter.width),
                letter.x - (box.x + box.width),
              ),
              Math.max(
                0,
                box.y - (letter.y + letter.height),
                letter.y - (box.y + box.height),
              ),
            );
            return gap - Number(mark.getAttribute("stroke-width")) / 2;
          }),
        };
      });
    const result = [
      measure(document.querySelector('[data-layer="symbols"]')!),
      measure(exported),
    ];
    exported.remove();
    return result;
  }, svg);
  for (const surface of surfaces) {
    expect(surface).toHaveLength(4);
    for (const { id, gaps } of surface)
      for (const gap of gaps)
        // Font bounding boxes vary by platform. Require real clearance,
        // not an arbitrary one-unit margin that rejects non-overlapping glyphs.
        expect(gap, `${id} letter/polarity clearance`).toBeGreaterThan(0);
  }
});
