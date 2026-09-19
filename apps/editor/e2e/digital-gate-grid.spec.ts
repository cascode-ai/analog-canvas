import { expect, test, type Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";

import {
  revealPropertiesShelf,
  awaitEditorReady,
  clickCommand,
  clickDrawTool,
  downloadBytes,
  editComponentPropertyCode,
} from "./editor-fixtures.js";

const gateIds = [
  "xnor-gate",
  "xor-gate",
  "or-gate",
  "nor-gate",
  "inverter",
  "buffer",
  "and-gate",
  "nand-gate",
];

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

test("digital gates align from their left outline and keep wired terminals through edits and export", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 820 });
  const project = createEmptyProject("digital-grid", "Digital grid");
  project.documents[0]!.instances = gateIds.map((symbolId, index) => ({
    id: `U${index + 1}`,
    symbolId,
    placement: {
      position: { x: 200, y: 80 + index * 60 },
      rotation: 0,
      mirror: "none",
    },
  }));
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "digital-grid.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened digital-grid.icproj.json",
  );

  const checkArtwork = async () => {
    const measurements = await page
      .getByTestId("schematic-canvas")
      .evaluate((canvas) => {
        const inverse = (canvas as SVGSVGElement).getScreenCTM()!.inverse();
        return [
          ...canvas.querySelectorAll<SVGGElement>(
            '[data-layer="symbols"] [data-object-id]',
          ),
        ].map((group) => {
          const paths = [...group.querySelectorAll<SVGPathElement>("path")];
          const left = Math.min(
            ...paths.map(
              (path) =>
                new DOMPoint(path.getBBox().x, 0).matrixTransform(
                  inverse.multiply(path.getScreenCTM()!),
                ).x,
            ),
          );
          const box = group.getBBox();
          const hit = canvas
            .querySelector<SVGGraphicsElement>(
              `[data-testid="hit-${group.dataset.objectId}"]`,
            )!
            .getBBox();
          return {
            left,
            margins: [
              box.x - hit.x,
              box.y - hit.y,
              hit.x + hit.width - box.x - box.width,
              hit.y + hit.height - box.y - box.height,
            ],
          };
        });
      });
    expect(measurements).toHaveLength(8);
    for (const { left, margins } of measurements) {
      expect(left).toBeCloseTo(180, 5);
      for (const margin of margins) {
        expect(margin).toBeGreaterThanOrEqual(-0.01);
        // Control-polygon bounds add at most a small fraction beyond the
        // painted path plus the editor's four-unit stroke padding.
        expect(margin).toBeLessThan(4.2);
      }
    }
  };
  await checkArtwork();

  // The old source viewBox used to capture clicks in this empty left strip.
  const blank = await screenPoint(page, 160, 320);
  await page.mouse.click(blank.x, blank.y);
  await expect(page.getByTestId("hit-U5")).not.toHaveClass(/selected/);

  for (let index = 0; index < gateIds.length; index++) {
    await clickDrawTool(page, "wire");
    await page.getByTestId(`terminal-U${index + 1}-Y`).click();
    const end = await screenPoint(page, 330, 80 + index * 60);
    await page.mouse.dblclick(end.x, end.y);
    await page.keyboard.press("Escape");
  }
  await clickDrawTool(page, "wire");
  await page.getByTestId("terminal-U8-A").click();
  const inputEnd = await screenPoint(page, 110, 490);
  await page.mouse.dblclick(inputEnd.x, inputEnd.y);
  await page.keyboard.press("Escape");
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(9);

  const wired = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ).documents[0];
  const routeIds = [
    ...gateIds.map((_, i) => [`U${i + 1}`, "Y"]),
    ["U8", "A"],
  ].map(
    ([instanceId, pinName]) =>
      wired.routes.find(
        (route: { start: { instanceId?: string; pinName?: string } }) =>
          route.start.instanceId === instanceId &&
          route.start.pinName === pinName,
      ).id as string,
  );
  const exportStarts = async () => {
    const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
      "utf8",
    );
    return page.evaluate(
      ({ source, routeIds }) => {
        const root = new DOMParser().parseFromString(source, "image/svg+xml");
        return routeIds.map((id) =>
          root
            .querySelector(`polyline[data-object-id="${id}"]`)!
            .getAttribute("points")!
            .trim()
            .split(/[ ,]+/)
            .slice(0, 2)
            .map(Number),
        );
      },
      { source: svg, routeIds },
    );
  };
  const initialStarts = await exportStarts();
  expect(initialStarts).toEqual([
    [240, 80],
    [230, 140],
    [220, 200],
    [230, 260],
    [220, 320],
    [210, 380],
    [220, 440],
    [230, 500],
    [170, 490],
  ]);

  // The moving NAND inputs and output must remain named-pin connections,
  // including when placement rotates and mirrors the new asymmetric body.
  await page.getByTestId("hit-U8").click();
  await revealPropertiesShelf(page);
  await page.getByTestId("selection-shelf").click();
  await editComponentPropertyCode(page, (code) => {
    const placement = code;
    placement.coordinate = [240, 500];
    placement.rotation = 90;
    placement.mirror = "horizontal";
  });
  const movedStarts = await exportStarts();
  expect(movedStarts.slice(0, 7)).toEqual(initialStarts.slice(0, 7));
  expect(movedStarts.slice(7)).not.toEqual(initialStarts.slice(7));
  // Compare to the actual terminal handles after transformation, so export
  // cannot silently retain the obsolete output/input column.
  const terminalPoints = await page
    .getByTestId("schematic-canvas")
    .evaluate((canvas) => {
      const inverse = (canvas as SVGSVGElement).getScreenCTM()!.inverse();
      return ["Y", "A"].map((name) => {
        const terminal = canvas.querySelector<SVGGraphicsElement>(
          `[data-testid="terminal-U8-${name}"]`,
        )!;
        const box = terminal.getBoundingClientRect();
        const point = new DOMPoint(
          box.x + box.width / 2,
          box.y + box.height / 2,
        ).matrixTransform(inverse);
        return [Math.round(point.x), Math.round(point.y)];
      });
    });
  expect(movedStarts.slice(7)).toEqual(terminalPoints);
  await clickCommand(page, "Edit", "Undo");
  expect(await exportStarts()).toEqual(initialStarts);
  await clickCommand(page, "Edit", "Redo");

  const saved = await downloadBytes(page, "File", "Export Project File…");
  const document = JSON.parse(saved.toString("utf8")).documents[0];
  expect(
    document.nets.flatMap((net: { terminals: unknown[] }) => net.terminals),
  ).toEqual(
    expect.arrayContaining([
      { instanceId: "U8", pinName: "A" },
      { instanceId: "U8", pinName: "Y" },
    ]),
  );
  await page.getByTestId("project-file").setInputFiles({
    name: "digital-reopen.icproj.json",
    mimeType: "application/json",
    buffer: saved,
  });
  await expect(page.getByTestId("status")).toContainText(
    "Opened digital-reopen.icproj.json",
  );
  expect(await exportStarts()).toEqual(movedStarts);
  await expect(page.locator('[data-canvas-hit-kind="route"]')).toHaveCount(9);
});
