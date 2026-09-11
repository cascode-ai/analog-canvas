import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  await page.route("**/code-component-check", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body><script type="module">
        import RefreshRuntime from "/@react-refresh";
        RefreshRuntime.injectIntoGlobalHook(window);
        window.$RefreshReg$ = () => {};
        window.$RefreshSig$ = () => (type) => type;
        window.__vite_plugin_react_preamble_installed__ = true;
        const { mountSimulationCodeHarness } = await import("/e2e/helpers/simulation-code-harness.tsx");
        mountSimulationCodeHarness();
      </script></body></html>`,
    }),
  );
  await page.goto("/code-component-check");
  await expect(
    page.getByRole("textbox", { name: "Simulation source editor" }),
  ).toBeVisible();
});

test("Files opens sideways, configuration is advanced, and results maximize/restore without a new fixed panel", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const before = await editor.boundingBox();
  await expect(page.getByRole("tab", { name: "Configuration" })).toHaveCount(0);
  await page.getByRole("button", { name: "Files", exact: true }).click();
  await expect(
    page.getByRole("complementary", { name: "Simulation files" }),
  ).toBeVisible();
  const after = await editor.boundingBox();
  expect(after!.y).toBe(before!.y);
  expect(after!.x - before!.x).toBeGreaterThan(100);
  await page.getByRole("button", { name: "More code actions" }).click();
  await page.getByRole("button", { name: "Advanced configuration" }).click();
  await expect(
    page.getByRole("tab", { name: "Configuration" }),
  ).toHaveAttribute("aria-selected", "true");
  await expect(editor).toContainText('"version"');
  await page.getByRole("tab", { name: "Results", exact: true }).click();
  await page.getByRole("button", { name: "Maximize results" }).click();
  await expect(editor).not.toBeVisible();
  await expect(
    page.getByText("Component results", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Restore results" }).click();
  await expect(editor).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Simulation files" }),
  ).toBeVisible();
});

test("edits, saves and undoes exact source bytes while keeping a save boundary and readonly generated text", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const original = JSON.parse(
    (await page.getByTestId("draft-source").textContent())!,
  );
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("* edited");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original),
  );
  await page.keyboard.press("Control+y");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.keyboard.press("Control+s");
  await expect(page.getByTestId("saved-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("draft-source")).toHaveText(
    JSON.stringify(original + "* edited"),
  );
  await page.getByRole("tab", { name: /circuit.spice/ }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
});

test("invalid text stays editable and saveable and known command errors are inline diagnostics", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  await editor.fill("* test\n.control\ntran\n.endc\n.end\n");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(1);
  await page.getByRole("button", { name: "Save source" }).click();
  await expect(page.getByTestId("saved-source")).toContainText("tran");
  await editor.fill("* test\n.control\ntran 1n 10u\n.endc\n.end\n");
  await expect(page.locator(".cm-lintRange-error")).toHaveCount(0);
});

test("file switching preserves caret, selection, scroll and local Undo history", async ({
  page,
}) => {
  const editor = page.getByRole("textbox", {
    name: "Simulation source editor",
  });
  const long =
    "* file navigation\n" +
    Array.from({ length: 90 }, (_, i) => `* line ${i}\n`).join("");
  await editor.fill(long);
  const beforeEdit = (await page.getByTestId("draft-source").textContent())!;
  await page.keyboard.press("Control+End");
  await page.keyboard.insertText("* preserve this selection");
  await page.keyboard.press("Control+Shift+ArrowLeft");
  const position = await page.getByTestId("source-cursor").textContent();
  const selection = await page.evaluate(() =>
    window.getSelection()?.toString(),
  );
  const scroller = page.locator(".cm-scroller");
  const scroll = await scroller.evaluate((el) => el.scrollTop);
  expect(scroll).toBeGreaterThan(100);
  await page.getByRole("button", { name: "More code actions" }).click();
  await page.getByRole("button", { name: "Advanced configuration" }).click();
  await editor.fill('{"version":1,"different":true}');
  await page.getByRole("tab", { name: "run.cir" }).click();
  await editor.focus();
  await expect
    .poll(() => scroller.evaluate((el) => el.scrollTop))
    .toBeCloseTo(scroll, 0);
  expect(await page.getByTestId("source-cursor").textContent()).toBe(position);
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(
    selection,
  );
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("draft-source")).toHaveText(beforeEdit);
});
