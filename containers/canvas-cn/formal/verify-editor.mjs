// Inspect the built domestic page in an isolated browser, never a user's session.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { chromium, expect } from "@playwright/test";
import { preview } from "vite";

const root = fileURLToPath(new URL("../../../apps/editor/", import.meta.url));
const modelLibrary = JSON.parse(
  await readFile(
    new URL(
      "../../../netlists/vacask-sky130/model-symbols-sections.json",
      import.meta.url,
    ),
  ),
);
const server = await preview({
  root,
  logLevel: "silent",
  preview: { host: "127.0.0.1", port: 4197, strictPort: true },
});
let browser;
let page;
try {
  browser = await chromium.launch({
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH }
      : { channel: process.env.CI ? undefined : "chrome" }),
  });
  page = await browser.newPage();
  const origin = new URL(server.resolvedUrls.local[0]).origin;
  let managedRun = false;
  let directRun = false;
  await page.route("**/*", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname === "/api/auth/me")
      return route.fulfill({ json: { user: null } });
    if (url.pathname === "/api/simulate") {
      const input = request.postDataJSON();
      if (input.operation !== "capabilities") {
        directRun = true;
        return route.fulfill({
          status: 503,
          json: { error: "wrong-transport" },
        });
      }
      return route.fulfill({
        json: {
          configured: true,
          rawfileCollection: "native-multi-ascii",
          maxOutputBytes: 1048576,
          inputs: ["source"],
          analyses: ["op", "ac", "tran", "dc", "noise"],
          parsedAnalyses: ["op", "ac", "tran", "dc", "noise"],
          profiles: [
            {
              id: "vacask-sky130-candidate",
              corners: ["tt"],
              dependencies: [modelLibrary.dependency],
            },
          ],
          maxTimeoutMs: 120000,
          maxInputBytes: 1048576,
          maxInputFiles: 256,
          cancel: true,
        },
      });
    }
    if (
      url.pathname === "/api/simulation/runs" &&
      request.method() === "POST"
    ) {
      managedRun = true;
      return route.fulfill({ status: 401, json: { error: "unauthorized" } });
    }
    if (url.pathname.startsWith("/api/"))
      return route.fulfill({ status: 404, json: { error: "isolated-check" } });
    return route.continue();
  });
  await page.goto(origin + "/editor?example=five-transistor-ota-sky130");
  await expect(page.getByTestId("open-analog-simulation")).toBeVisible({
    timeout: 20000,
  });
  await expect(page.getByTestId("open-agent")).toBeVisible();
  await page.getByTestId("open-analog-simulation").click();
  await expect(
    page.getByRole("button", { name: "Run", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run", exact: true }).click();
  await expect
    .poll(() => managedRun || directRun, { timeout: 20000 })
    .toBe(true);
  assert(
    managedRun && !directRun,
    "Hosted UI must submit through managed simulation",
  );
  console.log(
    "Built domestic editor: Simulation and Agent visible; Run uses managed admission (isolated refusal, no real job).",
  );
} catch (error) {
  if (page)
    console.error(
      (
        await page
          .getByRole("region", { name: "Analog simulation" })
          .textContent()
          .catch(() => "Simulation panel unavailable")
      ).slice(0, 4000),
    );
  throw error;
} finally {
  await browser?.close();
  await server.httpServer.close();
}
