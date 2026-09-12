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
test("native multi-unit results preserve signs and link only one record", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await page.evaluate(async () => {
    const reactPath = "/node_modules/.vite/deps/react.js";
    const domPath = "/node_modules/.vite/deps/react-dom_client.js";
    const resultPath = "/src/features/simulation/simulation-output-results.tsx";
    const { createElement } = (await import(reactPath)).default;
    const { createRoot } = (await import(domPath)).default;
    const { SimulationOutputResults } = await import(resultPath);
    const host = document.createElement("div");
    host.id = "native-result-regression";
    host.style.cssText =
      "position:fixed;inset:0;overflow:auto;background:white;z-index:99999;padding:20px";
    document.body.append(host);
    const outputs = [
      {
        id: "gain",
        label: "gain_db",
        unit: "dB",
        values: [0, -3, -56],
        semantics: {
          valueKind: "real",
          quantity: "decibel",
          origin: "expression",
        },
      },
      {
        id: "gain2",
        label: "gain_small",
        unit: "dB",
        values: [0, -1, -20],
        semantics: {
          valueKind: "real",
          quantity: "decibel",
          origin: "expression",
        },
      },
      {
        id: "phase",
        label: "phase_deg",
        unit: "deg",
        values: [0, -45, -90],
        semantics: {
          valueKind: "real",
          quantity: "notype",
          origin: "expression",
        },
      },
      {
        id: "unknown",
        label: "mystery",
        unit: "",
        values: [-1, -2, -3],
        imaginary: [0, 0, 0],
        semantics: { valueKind: "unknown", quantity: "notype", origin: "raw" },
      },
    ];
    createRoot(host).render(
      createElement(SimulationOutputResults, {
        resultKey: "browser-native-rc",
        outputs: [],
        data: {
          schemaVersion: 1,
          diagnostics: [],
          analyses: [0, 1].map((index) => ({
            analysis: "ac",
            plotName: "RC",
            rawPlotOrdinals: [index],
            domain: {
              name: "Frequency",
              unit: "Hz",
              values: [10, 1000, 1000000],
            },
            outputs,
          })),
        },
      }),
    );
  });
  const root = page.locator("#native-result-regression");
  const records = root.locator(".simulation-analysis-card");
  await expect(records).toHaveCount(2);
  const first = records.nth(0),
    second = records.nth(1);
  await expect(first.locator(".simulation-plot-layout")).toHaveCount(3);
  await expect(
    first.getByRole("button", { name: "Magnitude", exact: true }),
  ).toHaveCount(0);
  await expect(first.locator('svg[aria-label="AC Decibels"]')).toContainText(
    "dB",
  );
  await expect(first.locator('svg[aria-label="AC Decibels"]')).toContainText(
    "-",
  );
  await expect(first.locator('svg[aria-label="AC Phase"]')).toContainText(
    "deg",
  );
  await first.locator("summary").click();
  await first
    .getByLabel("Plot layout", { exact: true })
    .selectOption("separate");
  await expect(first.locator(".simulation-plot-layout")).toHaveCount(4);
  await expect(second.locator(".simulation-plot-layout")).toHaveCount(3);
  await first.getByLabel("mystery display unit").selectOption("deg");
  await expect(
    first.locator('svg[aria-label="AC mystery — Phase"]'),
  ).toContainText("deg");
  await first.getByLabel("Plot layout", { exact: true }).selectOption("units");
  const tools = first.getByLabel("Plot tools", { exact: true });
  await tools.first().focus();
  await first
    .getByRole("button", { name: "Control X axes", exact: true })
    .first()
    .click();
  await first
    .getByRole("button", { name: "Zoom in", exact: true })
    .first()
    .click();
  for (const button of await first
    .getByRole("button", { name: "Previous view", exact: true })
    .all())
    await expect(button).toBeEnabled();
  for (const button of await second
    .getByRole("button", { name: "Previous view", exact: true })
    .all())
    await expect(button).toBeDisabled();
  const interaction = first
    .getByLabel("Waveform: drag to zoom, click to measure, Shift-drag to pan")
    .first();
  await interaction.click({ position: { x: 200, y: 100 } });
  await expect(
    first.getByLabel("Marker measurements", { exact: true }),
  ).toHaveCount(3);
  await expect(
    second.getByLabel("Marker measurements", { exact: true }),
  ).toHaveCount(0);
  for (const table of await first
    .getByLabel("Marker measurements", { exact: true })
    .all())
    await expect(table).toContainText("A");
  // Capture the whole record, not the clipped portion of a fixed scroll host.
  await page.setViewportSize({ width: 1280, height: 2000 });
  await test.info().attach("native-multi-unit-results.png", {
    body: await first.screenshot({
      path: test.info().outputPath("native-results.png"),
    }),
    contentType: "image/png",
  });
});

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
