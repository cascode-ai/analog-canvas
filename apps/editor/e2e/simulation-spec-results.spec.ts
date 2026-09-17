import { test, expect } from "@playwright/test";

test("Specs retain captured judgments and source navigation at narrow and maximized widths", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("schematic-canvas")).toBeVisible();
  await page.evaluate(async () => {
    const harnessPath = "/e2e/helpers/simulation-output-harness.tsx";
    const { mountSimulationOutputHarness } = await import(harnessPath);
    const host = document.createElement("div");
    host.id = "spec-regression";
    host.style.cssText =
      "position:fixed;inset:0 auto 0 0;width:380px;overflow:auto;background:white;z-index:99999";
    document.body.append(host);
    mountSimulationOutputHarness(host, {
      hasRun: true,
      stale: true,
      onSource: (source: { path: string; line: number }) => {
        document.body.dataset.specSource = `${source.path}:${source.line}`;
      },
      report: {
        schemaVersion: 1,
        runId: "captured",
        preparedId: "p",
        inputDigest: "digest",
        results: ["pass", "failed", "not-evaluated", "unconstrained"].map(
          (judgment, i) => ({
            id: String(i),
            name: ["peak", "delay", "missing", "bias"][i],
            ...(i === 3
              ? {
                  label: {
                    runs: [
                      {
                        kind: "math",
                        latex: "Z_{\\mathrm{in}}",
                        display: "inline",
                      },
                    ],
                  },
                }
              : {}),
            occurrence: 1,
            source: { path: "run.cir", line: i + 2, text: "captured source" },
            value: i === 2 ? null : i === 3 ? 36.2705e6 : i + 0.5,
            unit: i === 3 ? "Ohm" : "V",
            expected:
              i === 3 ? null : { kind: "limit", operator: "<=", value: 1 },
            judgment,
            reason: [
              "satisfied",
              "outside-spec",
              "measurement-missing",
              "no-spec",
            ][i],
            detail: i === 2 ? "Measurement was not recorded" : "",
            logLine: null,
          }),
        ),
      },
    });
  });
  const table = page.getByRole("table");
  await expect(
    table.getByRole("img", { name: "Z_{\\mathrm{in}}" }),
  ).toBeVisible();
  await expect(table).toContainText("36.2705 MΩ");
  await expect(table).toContainText("Measured only");
  await expect(table.locator(".simulation-spec-number").first()).toHaveCSS(
    "text-align",
    "right",
  );
  await expect(table.getByRole("columnheader")).toHaveText([
    "Spec",
    "Sim result",
    "Expected",
    "Judgment",
  ]);
  await expect(
    table.getByRole("row").filter({ hasText: "peak" }),
  ).toContainText("Pass");
  await expect(
    table.getByRole("row").filter({ hasText: "delay" }),
  ).toContainText("Failed");
  await expect(
    table.getByRole("row").filter({ hasText: "missing" }),
  ).toContainText("Not evaluated");
  await expect(
    page.getByText("Previous run · input has changed"),
  ).toBeVisible();
  await page.getByRole("button", { name: "peak", exact: true }).click();
  await expect(page.locator("body")).toHaveAttribute(
    "data-spec-source",
    "run.cir:2",
  );
  for (const width of [380, 1100]) {
    await page.locator("#spec-regression").evaluate((element, width) => {
      (element as HTMLElement).style.width = `${width}px`;
    }, width);
    expect(
      await page
        .locator("#spec-regression")
        .evaluate((element) => element.scrollWidth <= element.clientWidth),
    ).toBe(true);
    const layout = await table.evaluate((element) => {
      const cells = [
        ...element.querySelectorAll("tbody tr:first-child > *"),
      ].map((cell) => cell.getBoundingClientRect());
      return cells.every(
        (cell, index) => !index || cell.left >= cells[index - 1]!.right - 1,
      );
    });
    expect(layout).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`spec-results-${width}.png`),
    });
  }
  await page.screenshot({ path: test.info().outputPath("spec-results.png") });
});
