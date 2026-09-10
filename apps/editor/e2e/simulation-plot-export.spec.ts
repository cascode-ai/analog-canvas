import { test, expect } from "@playwright/test";
import { createRequire } from "node:module";
import { unzipSync } from "fflate";

const loadModule = createRequire(import.meta.url);
const { PNG } = loadModule("pngjs") as {
  PNG: {
    sync: {
      read(input: Buffer): {
        readonly width: number;
        readonly height: number;
        readonly data: Uint8Array;
      };
    };
  };
};
test("plot PNG export retains every curve when the source charts rerender", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  const bytes = await page.evaluate(async () => {
    const plotModule = "/src/features/simulation/ac-response-plot.ts";
    const exportModule = "/src/features/simulation/simulation-plot-export.ts";
    const { acResponseSvg } = await import(plotModule);
    const { buildVisibleSimulationPlotDownload } = await import(exportModule);
    const root = document.createElement("div");
    document.body.append(root);
    const points = [1, 10, 100, 1000, 10000].map((frequency, index) => ({
      frequency,
      real: 1,
      imaginary: 0,
      magnitude: [0, 1, 0.2, 0.8, 0][index],
      magnitudeDb: [0, 20, 4, 16, 0][index],
      phaseDeg: [0, -90, -20, -70, 0][index],
    }));
    root.innerHTML = ["db20", "phase"]
      .map((kind) =>
        acResponseSvg(
          [{ label: "v(out)", unit: "V", points }],
          { width: 600, height: 340 },
          { kind },
        ),
      )
      .join("");
    try {
      const pending = buildVisibleSimulationPlotDownload(root, "png");
      // Busy-state/plot updates replace innerHTML while the first image decodes.
      // The second chart must not read styles from its now-detached SVG.
      root.replaceChildren();
      return Array.from((await pending).bytes as Uint8Array);
    } finally {
      root.remove();
    }
  });
  const entries = unzipSync(Uint8Array.from(bytes));
  expect(Object.keys(entries)).toHaveLength(2);
  for (const [name, bytes] of Object.entries(entries)) {
    await test
      .info()
      .attach(name, { body: Buffer.from(bytes), contentType: "image/png" });
    const png = PNG.sync.read(Buffer.from(bytes));
    let blue = 0;
    let dark = 0;
    for (let index = 0; index < png.data.length; index += 4) {
      const r = png.data[index]!;
      const g = png.data[index + 1]!;
      const b = png.data[index + 2]!;
      if (b > 140 && r < 60 && g > 60 && g < 140) blue++;
      if (r < 32 && g < 32 && b < 32) dark++;
    }
    expect(blue, `${name}: curve remains visible`).toBeGreaterThan(500);
    expect(
      dark / (png.width * png.height),
      `${name}: no filled black region`,
    ).toBeLessThan(0.03);
  }
});
