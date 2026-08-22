import { expect, test } from "@playwright/test";

import {
  chooseComponent,
  clickCommand,
  downloadBytes,
  emulateDownloadOnlyBrowser,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

test("blocks destructive browser refresh shortcuts and uses the stronger grid", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.locator(".canvas-grid-dot").first()).toHaveCSS(
    "fill",
    "rgb(196, 199, 201)",
  );
  await page.evaluate(() => {
    document.body.dataset.refreshGuard = "alive";
  });

  await page.keyboard.press("Control+r");
  await expect(page.getByTestId("status")).toHaveText(
    "Refresh blocked to protect the current circuit",
  );
  await expect(page.locator("body")).toHaveAttribute(
    "data-refresh-guard",
    "alive",
  );

  await page.getByRole("button", { name: "Hide background dots" }).click();
  await expect(page.getByTestId("canvas-grid-dots")).toHaveCount(0);
  await page.getByRole("button", { name: "Show background dots" }).click();
  await expect(page.getByTestId("canvas-grid-dots")).toBeVisible();

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").focus();
  await page.keyboard.press("F5");
  await expect(dialog).toBeVisible();
  await expect(page.locator("body")).toHaveAttribute(
    "data-refresh-guard",
    "alive",
  );
});

test("mirrors component and copy placement previews before their commits", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 320, box.y + 220);
  const componentPreview = page.getByTestId("component-placement-preview");
  await page.keyboard.press("Shift+R");
  await expect(componentPreview).toHaveAttribute("transform", /scale\(-1 1\)/u);
  await canvas.click({ position: { x: 320, y: 220 } });
  await page.keyboard.press("Escape");

  const placedSymbol = canvas.locator('[data-object-id="R1"] > g').first();
  await expect(placedSymbol).toHaveAttribute("transform", /scale\(-1 1\)/u);

  await page.getByTestId("hit-R1").click();
  await page.keyboard.press("c");
  await page.mouse.move(box.x + 520, box.y + 220);
  const copyPreview = page
    .getByTestId("copy-placement-preview")
    .locator("[data-object-id] > g")
    .first();
  await page.keyboard.press("Control+r");
  await expect(copyPreview).toHaveAttribute("transform", /rotate\(180\)/u);
  await canvas.click({ position: { x: 520, y: 220 } });
  await expect(
    canvas.locator('[data-object-id="R2"] > g').first(),
  ).toHaveAttribute("transform", /rotate\(180\)/u);
  await page.keyboard.press("Escape");
});

test("writes a manual netlist reference into the placed Instance", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByTestId("insert-component-resistor").click();
  await dialog.getByLabel("Reference name").fill("R7");
  await dialog.getByRole("button", { name: "Apply" }).click();
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 220 } });
  await page.keyboard.press("Escape");

  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"reference": "R7"');
});

test("returns a component to the Placement Tray and places the retained Instance again", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 320, y: 220 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("selection-shelf").click();

  await page
    .getByRole("button", { name: "Return component to Placement Tray" })
    .click();
  await expect(
    page.getByRole("region", { name: "Placement Tray" }),
  ).toContainText("1 retained");
  await expect(page.getByTestId("unplaced-R1")).toContainText("R1 · resistor");
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toHaveCount(0);

  await page
    .getByRole("button", { name: "Place R1 · resistor from tray" })
    .click();
  await canvas.hover({ position: { x: 480, y: 260 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 480, y: 260 } });

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(
    page.getByTestId("annotation-hit-instance-label-R1"),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Placement Tray" }),
  ).toContainText("0 retained");
  await expect(page.getByTestId("revision")).toHaveText("3");

  await page.getByTestId("hit-R1").click();
  await page
    .getByRole("button", { name: "Return component to Placement Tray" })
    .click();
  await page
    .getByRole("region", { name: "Placement Tray" })
    .getByRole("button", { name: "Place all" })
    .click();

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("5");
});

test("refreshes explicitly only after flushing and automatically restoring recovery", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");

  const navigated = page.waitForEvent("framenavigated");
  await clickCommand(page, "File", "Refresh app");
  await navigated;

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("status")).toHaveText(
    "Restored recovery revision 1",
  );
  await expect
    .poll(() =>
      page.evaluate(() =>
        sessionStorage.getItem("icm.restore-after-refresh.v1"),
      ),
    )
    .toBeNull();
});

test("inserts from the master-detail dialog with keyboard and live placement preview", async ({
  page,
}) => {
  await page.goto("/editor");
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const search = dialog.getByLabel("Component search");
  await expect(search).toBeFocused();
  await search.fill("not-a-real-component");
  await expect(dialog.getByRole("button", { name: "Apply" })).toBeDisabled();
  await search.fill("mos");
  const before = await search.getAttribute("aria-activedescendant");
  await page.keyboard.press("ArrowDown");
  expect(await search.getAttribute("aria-activedescendant")).not.toBe(before);

  await search.fill("resistor");
  await page.keyboard.press("Enter");
  await expect(dialog).toHaveCount(0);

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 360, box.y + 230);
  const preview = page.getByTestId("component-placement-preview");
  await expect(preview).toBeVisible();
  await expect(preview).toHaveAttribute("transform", /rotate\(0\)/u);

  await page.keyboard.press("r");
  await expect(preview).toHaveAttribute("transform", /rotate\(90\)/u);
  await page.keyboard.press("Escape");
  await expect(preview).toHaveCount(0);
  await expect(page.getByTestId("revision")).toHaveText("0");

  await chooseComponent(page, "resistor");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("canvas-empty-state")).toHaveCount(0);
  await page.getByTestId("selection-shelf").click();
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "R1 · resistor",
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.recent-components.v1")),
    )
    .toContain("resistor");

  await page.keyboard.press("i");
  const reopened = page.getByRole("dialog", { name: "Insert Component" });
  await expect(reopened.locator(".insert-component-options")).toBeVisible();
  const passives = reopened
    .locator(".insert-option-group")
    .filter({ hasText: "Passives" });
  await expect(passives.locator("button").first()).toHaveAttribute(
    "data-testid",
    "insert-component-resistor",
  );
});

test("places a named vertical Power Rail from I", async ({ page }) => {
  await emulateDownloadOnlyBrowser(page);
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("vdd");
  await dialog.getByTestId("insert-component-vdd").click();
  await expect(dialog.locator("svg.insert-symbol-artwork")).toBeVisible();
  await expect(dialog.getByLabel("Placement options")).toHaveCount(0);
  await dialog.getByLabel("Power rail Net name").fill("AVDD");
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.hover({ position: { x: 260, y: 140 } });
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 260, y: 140 } });
  await canvas.click({ position: { x: 260, y: 380 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);
  await expect(page.getByTestId("instance-count")).toHaveText("0");
  const railPoints = await page
    .getByTestId("route-hit-route-vdd1-rail")
    .evaluate((element) =>
      Array.from((element as SVGPolylineElement).points).map((point) => ({
        x: point.x,
        y: point.y,
      })),
    );
  expect(new Set(railPoints.map((point) => point.x)).size).toBe(1);
  expect(railPoints.at(-1)!.y).not.toBe(railPoints[0]!.y);

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ) as {
    documents: Array<{
      nets: Array<{ id: string; name?: string; scope: string }>;
      routes: Array<{ netId: string; presentation?: string }>;
      annotations: Array<{
        kind: string;
        netId: string;
        binding?: { kind: string; netId?: string };
      }>;
    }>;
  };
  const document = saved.documents[0]!;
  const avdd = document.nets.find((net) => net.name === "AVDD");
  expect(avdd).toMatchObject({ scope: "local" });
  expect(document.routes).toContainEqual(
    expect.objectContaining({ netId: avdd!.id, presentation: "power-rail" }),
  );
  expect(document.annotations).toContainEqual(
    expect.objectContaining({
      kind: "power-label",
      netId: avdd!.id,
      binding: { kind: "net-name", netId: avdd!.id },
    }),
  );
});

test("places the VDD power-port device as the default VDD entry", async ({
  page,
}) => {
  await emulateDownloadOnlyBrowser(page);
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("vdd");
  const vddEntries = await dialog
    .locator(
      '[data-testid="insert-component-vdd-port"], [data-testid="insert-component-vdd"]',
    )
    .evaluateAll((elements) =>
      elements.map((element) => element.getAttribute("data-testid")),
    );
  // Both VDD entries stay reachable from one search; the rail now reads
  // "Power Rail", so it sorts first by name.
  expect(vddEntries).toEqual([
    "insert-component-vdd",
    "insert-component-vdd-port",
  ]);
  await dialog.getByTestId("insert-component-vdd-port").click();
  await expect(dialog.locator("svg.insert-symbol-artwork")).toBeVisible();
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 300, y: 160 } });
  await canvas.click({ position: { x: 480, y: 260 } });
  await page.keyboard.press("Escape");

  await expect(page.getByTestId("hit-VDD1")).toBeVisible();
  await expect(page.getByTestId("hit-VDD2")).toBeVisible();
  await expect(canvas.locator('[data-symbol-id="vdd-port"]')).toHaveCount(2);
  await expect(canvas.getByText("VDD", { exact: true })).toHaveCount(2);
  await expect(page.getByTestId("instance-count")).toHaveText("2");

  const saved = JSON.parse(
    (await downloadBytes(page, "File", "Save Project")).toString("utf8"),
  ) as {
    documents: Array<{
      instances: Array<{ id: string; symbolId: string }>;
      nets: Array<{
        id: string;
        name?: string;
        scope: string;
        powerDomain?: string;
        terminals: Array<{ instanceId: string; pinName: string }>;
      }>;
      annotations: Array<{ id: string; kind: string; netId: string }>;
    }>;
  };
  const document = saved.documents[0]!;
  expect(document.instances.map((instance) => instance.symbolId)).toEqual([
    "vdd-port",
    "vdd-port",
  ]);
  const vddNets = document.nets.filter((net) => net.powerDomain === "vdd");
  expect(vddNets).toHaveLength(1);
  expect(vddNets[0]).toMatchObject({ name: "VDD", scope: "local" });
  expect(vddNets[0]!.terminals).toEqual([
    { instanceId: "VDD1", pinName: "P" },
    { instanceId: "VDD2", pinName: "P" },
  ]);
  expect(
    document.annotations
      .filter((annotation) => annotation.kind === "power-label")
      .map((annotation) => annotation.id),
  ).toEqual(["power-label-vdd1", "power-label-vdd2"]);
});

test("reopens I and starts Copy from retained selection without stacking modes", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  // Closing the dialog is a state update, so a keystroke sent in the same tick
  // still lands in its search field. Wait for it to leave before typing.
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toHaveCount(0);
  await page.keyboard.press("c");
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 560, y: 330 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
});

test("Escape closes the Insert dialog even when focus is outside it", async ({
  page,
}) => {
  await page.goto("/editor");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });

  await page.keyboard.press("i");
  await expect(dialog).toBeVisible();
  // The dialog claims focus a frame after it opens, so an Escape pressed in
  // that gap is delivered elsewhere. Reproduce that deterministically by
  // moving focus out, then dismiss: the dialog must not stay stuck open.
  await page.evaluate(() => {
    (
      document.querySelector(
        '[data-testid="draw-tool-wire"]',
      ) as HTMLElement | null
    )?.focus();
  });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);

  await page.keyboard.press("i");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("Copy shows its ghost under the cursor without waiting for a move", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("hit-R1").click();

  // The pointer is over the canvas and stays there: the ghost has to appear
  // from the remembered position rather than from the next pointer move.
  await canvas.hover({ position: { x: 500, y: 300 } });
  await page.keyboard.press("c");
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
});

test("publishes placement cancellation synchronously before rapid Copy", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");
  const symbols = ["nmos", "pmos", "resistor"] as const;

  await page.evaluate(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "c" }));
  });
  await expect(
    page.getByRole("heading", { name: "Analog Canvas" }),
  ).toBeVisible();

  for (const [index, symbolId] of symbols.entries()) {
    await chooseComponent(page, symbolId);
    await canvas.click({ position: { x: 320 + index * 150, y: 240 } });

    // A fast physical Esc -> C sequence can arrive before React publishes a
    // render between the two native events. The command state must still see
    // the reducer transition synchronously, especially after MOS bulk-default
    // reconciliation makes the committed scene more expensive to derive.
    await page.evaluate(() => {
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
      document.body.dispatchEvent(
        new KeyboardEvent("keydown", { key: "c", bubbles: true }),
      );
    });

    await canvas.hover({ position: { x: 400 + index * 130, y: 380 } });
    await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("copy-placement-preview")).toHaveCount(0);
  }
});

test("copies a MOS whose bulk belongs to a shared supply Net", async ({
  page,
}) => {
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 280, y: 220 } });
  await page.keyboard.press("Escape");
  await chooseComponent(page, "nmos");
  await canvas.click({ position: { x: 460, y: 220 } });
  await page.keyboard.press("Escape");

  await page.getByTestId("hit-M1").click();
  await page.keyboard.press("c");
  await canvas.hover({ position: { x: 620, y: 340 } });
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 620, y: 340 } });
  await expect(page.getByTestId("hit-M3")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Analog Canvas" }),
  ).toBeVisible();
});

test("carries a manual Value through placement and Q property editing", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByLabel("Component value").fill("10k");
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(page.getByLabel("Component geometry")).toContainText("XYRotate");
  await expect(page.locator(".selection-overview")).toHaveCount(0);
  await expect(page.getByTestId("selection-shelf")).toContainText(
    "R1 · resistor",
  );
  await expect(page.getByLabel("Component display toggles")).toContainText(
    "ReferenceValue",
  );
  await expect(page.getByText("Placement", { exact: true })).toBeVisible();
  const propertyValue = page.getByLabel("Component value");
  // Opening focuses the shelf header, never the first field: Q stays a pure
  // toggle and editing starts only when the user clicks an input.
  await expect(page.getByTestId("selection-shelf")).toBeFocused();
  await expect(propertyValue).not.toBeFocused();
  await expect(propertyValue).toHaveValue("10k");
  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );
  await page.keyboard.press("q");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect(propertyValue).not.toBeFocused();
  await expect(propertyValue).toHaveValue("10k");
  await propertyValue.click();
  await expect(propertyValue).toBeFocused();
  await propertyValue.fill("12k");
  await expect(propertyValue).toHaveValue("12k");
  await expect(page.getByTestId("revision")).toHaveText("2");
  await expect(
    page.getByRole("button", { name: "Apply component properties" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Discard changes" }).click();
  await expect(page.getByTestId("revision")).toHaveText("3");
  await expect(propertyValue).toHaveValue("10k");
  await expect(
    page.getByRole("button", { name: "Discard changes" }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Component identity")).toContainText(
    "Schematic labelNetlist referenceSymbolresistorDevice classresistor",
  );
  const netlistReference = page.getByLabel("Component netlist reference");
  await expect(netlistReference).toHaveValue("R1");
  await netlistReference.fill("R7");
  await netlistReference.press("Tab");
  await expect(page.getByTestId("revision")).toHaveText("4");
  await expect(netlistReference).toHaveValue("R7");
  const schematicLabel = page.getByLabel("Component schematic label");
  await expect(schematicLabel).toHaveValue("R1");
  await schematicLabel.fill("Input resistor");
  await schematicLabel.press("Tab");
  await expect(page.getByTestId("revision")).toHaveText("5");
  await page
    .locator("summary")
    .filter({ hasText: "Advanced parameters" })
    .click();
  await page.getByRole("button", { name: "Add parameter" }).click();
  await page.getByLabel("Additional parameter name 1").fill("tc");
  await page.getByLabel("Additional parameter value 1").fill("0.1");
  await page.getByRole("button", { name: "Apply parameters" }).click();
  await expect(page.getByTestId("revision")).toHaveText("6");
  await expect(page.getByLabel("Additional parameter name 1")).toHaveValue(
    "tc",
  );
  await expect(page.getByLabel("Additional parameter value 1")).toHaveValue(
    "0.1",
  );
});

test("keeps the workspace inside the viewport and exposes low-interference zoom controls", async ({
  page,
}) => {
  await page.goto("/editor");

  expect(
    await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      vertical:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false });

  const zoom = page.getByRole("status", { name: "Current zoom" });
  await expect(zoom).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in" }).click();
  await expect(zoom).not.toHaveText("100%");
  await page.getByRole("button", { name: "Fit view" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  const canvasBefore = await canvas.boundingBox();
  await page.getByTestId("selection-shelf").click();
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThan(canvasBefore?.width ?? 0);
});

test("keeps preview fixed while picking from the always-open catalog", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 720 });
  await page.goto("/editor");
  await page.keyboard.press("i");

  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const artwork = dialog.locator(".insert-symbol-artwork");
  const cancel = dialog.getByRole("button", { name: "Cancel" });
  const apply = dialog.getByRole("button", { name: "Apply" });

  const measure = () =>
    dialog.evaluate((element) => {
      const bounds = (target: Element) => {
        const rect = target.getBoundingClientRect();
        return {
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      const preview = element.querySelector(".insert-component-preview")!;
      const artwork = element.querySelector(".insert-symbol-artwork")!;
      const footer = element.querySelector(".insert-dialog-actions")!;
      return {
        dialog: bounds(element),
        preview: bounds(preview),
        artwork: bounds(artwork),
        footer: bounds(footer),
      };
    });

  const before = await measure();
  await expect(cancel).toBeVisible();
  await expect(apply).toBeVisible();
  expect(before.footer.bottom).toBeLessThanOrEqual(before.dialog.bottom);
  const options = dialog.locator(".insert-component-options");
  await expect(options).toBeVisible();
  expect(
    await options.evaluate((element) => getComputedStyle(element).overflowY),
  ).toBe("auto");

  // The catalog is permanently open: no collapse control exists, and picking
  // an item keeps the list in place for the next pick.
  await expect(
    dialog.getByRole("button", { name: "Collapse component list" }),
  ).toHaveCount(0);
  await dialog.getByTestId("insert-component-inductor").click();
  await expect(options).toBeVisible();
  await expect(dialog.getByTestId("insert-component-resistor")).toBeVisible();
  const after = await measure();
  expect(after.dialog.height).toBeCloseTo(before.dialog.height, 0);
  expect(after.preview.width).toBeCloseTo(before.preview.width, 0);
  expect(after.preview.height).toBeCloseTo(before.preview.height, 0);
  expect(after.artwork.width).toBeCloseTo(before.artwork.width, 0);
  expect(after.artwork.height).toBeCloseTo(before.artwork.height, 0);
  expect(after.footer.top).toBeCloseTo(before.footer.top, 0);
  expect(after.footer.bottom).toBeLessThanOrEqual(after.dialog.bottom);
});

test("places MOS parameters and orientation without a hidden-label suppressor", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.keyboard.press("i");

  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("nmos");
  await expect(
    dialog.getByLabel("Component w", { exact: true }),
  ).toHaveAttribute("placeholder", "1u");
  await dialog.getByLabel("Component w", { exact: true }).fill("2u");
  await dialog.getByLabel("Component l", { exact: true }).fill("180n");
  await dialog.getByLabel("Component m", { exact: true }).fill("4");
  await dialog.getByLabel("Initial rotation").selectOption("90");
  const dialogArtwork = dialog.locator(".insert-symbol-artwork");
  await expect(dialogArtwork).toHaveAttribute("data-rotation", "90");
  await expect(dialogArtwork.locator("g")).toHaveAttribute(
    "transform",
    "rotate(90)",
  );
  await dialog.getByLabel("Component preview").focus();
  await page.keyboard.press("r");
  await expect(dialog.getByLabel("Initial rotation")).toHaveValue("180");
  await expect(dialogArtwork).toHaveAttribute("data-rotation", "180");
  await dialog.getByLabel("Initial rotation").selectOption("90");
  await dialog
    .getByRole("checkbox", { name: "Reference", exact: true })
    .uncheck();
  await expect(dialog.locator(".insert-parameter-name").first()).toHaveText(
    "W / m(Total channel width)",
  );
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 360, box.y + 230);
  await expect(page.getByTestId("component-placement-preview")).toHaveAttribute(
    "transform",
    /rotate\(90\)/u,
  );
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  await expect(
    page.locator('[data-object-id="instance-label-M1"]'),
  ).toHaveCount(0);
  await page.keyboard.press("q");
  await expect(page.getByLabel("Component w", { exact: true })).toHaveValue(
    "2u",
  );
  await expect(page.getByLabel("Component l", { exact: true })).toHaveValue(
    "180n",
  );
  await expect(page.getByLabel("Component m", { exact: true })).toHaveValue(
    "4",
  );
  await expect(page.getByLabel("Component rotation")).toHaveValue("90");
});

test("keeps component placement active across independent canvas commits", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByRole("button", { name: "Apply" }).click();

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await canvas.dispatchEvent("click", {
    bubbles: true,
    detail: 0,
    clientX: box.x + 360,
    clientY: box.y + 230,
  });

  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("component-input-plane")).toBeVisible();
  await canvas.click({ position: { x: 520, y: 230 } });
  await expect(page.getByTestId("hit-R2")).toBeVisible();
  await expect(page.getByTestId("revision")).toHaveText("2");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("component-input-plane")).toHaveCount(0);
});

test("shows the complete foldable categorized Library, quick-places a device, and restores state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/editor");
  const panel = page.getByTestId("shapes-library-panel");
  const canvas = page.getByTestId("schematic-canvas");
  const libraryChips = panel.locator('[data-testid^="shapes-chip-"]');
  const categories = panel.locator('[data-testid^="shapes-category-"]');

  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(libraryChips).toHaveCount(34);
  await expect(categories).toHaveCount(7);
  const transistorCategory = page.getByTestId("shapes-category-transistors");
  const transistorChips = transistorCategory.locator(
    '[data-testid^="shapes-chip-"]',
  );
  await expect(transistorChips).toHaveCount(4);
  const transistorGrid = transistorCategory.locator(".shapes-grid");
  // Tiles keep a fixed square size; a wider panel fits more of them per row
  // instead of stretching each tile.
  const tileBox = await transistorChips.first().boundingBox();
  if (!tileBox) throw new Error("Library tile is not measurable");
  expect(Math.round(tileBox.width)).toBe(Math.round(tileBox.height));
  const gridBox = await transistorGrid.boundingBox();
  if (!gridBox) throw new Error("Library grid is not measurable");
  const columns = (
    await transistorGrid.evaluate(
      (element) => getComputedStyle(element).gridTemplateColumns,
    )
  ).split(" ").length;
  expect(columns).toBe(Math.floor((gridBox.width + 4) / (tileBox.width + 4)));
  expect(
    await transistorChips.evaluateAll(
      (elements) =>
        new Set(
          elements.map((element) =>
            Math.round(element.getBoundingClientRect().top),
          ),
        ).size,
    ),
  ).toBe(Math.ceil(4 / columns));
  expect(
    await transistorGrid.evaluate((element) => {
      const gridBounds = element.getBoundingClientRect();
      return [...element.children].every((child) => {
        const tileBounds = child.getBoundingClientRect();
        return (
          tileBounds.left >= gridBounds.left - 0.5 &&
          tileBounds.right <= gridBounds.right + 0.5
        );
      });
    }),
  ).toBe(true);
  const artworkGeometry = await libraryChips.evaluateAll((tiles) =>
    tiles.map((tile) => {
      const tileBounds = tile.getBoundingClientRect();
      const artwork = tile.querySelector<SVGElement>(".shapes-chip-art");
      if (!artwork) throw new Error("Library artwork is missing");
      const artworkBounds = artwork.getBoundingClientRect();
      const label = tile.querySelector<HTMLElement>("span");
      if (!label) throw new Error("Library label is missing");
      const labelBounds = label.getBoundingClientRect();
      return {
        centerDeltaX:
          artworkBounds.left +
          artworkBounds.width / 2 -
          (tileBounds.left + tileBounds.width / 2),
        groupCenterDeltaY:
          (Math.min(artworkBounds.top, labelBounds.top) +
            Math.max(artworkBounds.bottom, labelBounds.bottom)) /
            2 -
          (tileBounds.top + tileBounds.height / 2),
        height: artworkBounds.height,
        labelFits:
          label.scrollWidth <= label.clientWidth + 1 &&
          label.scrollHeight <= label.clientHeight + 1,
        labelCenterDeltaX:
          labelBounds.left +
          labelBounds.width / 2 -
          (tileBounds.left + tileBounds.width / 2),
        labelHeight: labelBounds.height,
        separatedFromLabel: artworkBounds.bottom <= labelBounds.top + 0.5,
        tileHeight: tileBounds.height,
        withinTile:
          artworkBounds.left >= tileBounds.left - 0.5 &&
          artworkBounds.right <= tileBounds.right + 0.5 &&
          artworkBounds.top >= tileBounds.top - 0.5 &&
          artworkBounds.bottom <= tileBounds.bottom + 0.5,
        width: artworkBounds.width,
      };
    }),
  );
  expect(artworkGeometry.every((artwork) => artwork.withinTile)).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.width - 40) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.height - 32) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every((artwork) => Math.abs(artwork.centerDeltaX) <= 0.5),
  ).toBe(true);
  expect(
    artworkGeometry.every(
      (artwork) => Math.abs(artwork.groupCenterDeltaY) <= 0.5,
    ),
  ).toBe(true);
  expect(
    artworkGeometry.every(
      (artwork) => Math.abs(artwork.labelCenterDeltaX) <= 0.5,
    ),
  ).toBe(true);
  expect(
    artworkGeometry.every(
      (artwork) => Math.abs(artwork.tileHeight - 56) <= 0.5,
    ),
  ).toBe(true);
  expect(artworkGeometry.every((artwork) => artwork.labelFits)).toBe(true);
  expect(artworkGeometry.every((artwork) => artwork.labelHeight <= 12.5)).toBe(
    true,
  );
  expect(artworkGeometry.every((artwork) => artwork.separatedFromLabel)).toBe(
    true,
  );
  await expect(libraryChips.locator("span")).toHaveCount(34);
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  const analogCategory = page.getByTestId("shapes-category-analog-blocks");
  await expect(analogCategory).toHaveJSProperty("open", true);
  await expect(
    page
      .getByTestId("shapes-category-power-and-ports")
      .locator('[data-testid^="shapes-chip-"]'),
  ).toHaveCount(6);
  await expect(
    panel.getByRole("button", { name: "Place Independent Voltage Source" }),
  ).toBeAttached();
  await expect(
    panel.getByRole("button", { name: "Place Variable Resistor" }),
  ).toBeAttached();

  await page.getByTestId("shapes-chip-resistor").click();
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 280, box.y + 220);
  await expect(page.getByTestId("component-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 280, y: 220 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  // The Library has no Recent fold; the placed device stays reachable from
  // its own category chip.
  await expect(page.getByTestId("shapes-fold-recent")).toHaveCount(0);
  const resistorChip = page.getByTestId("shapes-chip-resistor");
  await expect(resistorChip).toHaveAttribute("aria-label", "Place Resistor");
  await expect(resistorChip.locator("span")).toHaveText("Res");
  await expect(transistorCategory).toHaveJSProperty("open", false);
  await expect(page.getByTestId("shapes-chip-nmos")).not.toBeVisible();
  await expect(analogCategory).toHaveJSProperty("open", true);
  await transistorCategory.locator("summary").click();
  await expect(transistorCategory).toHaveJSProperty("open", true);
  await expect(page.getByTestId("shapes-chip-nmos")).toBeVisible();

  await page.keyboard.press("q");
  await expect(page.getByLabel("Component value")).toHaveValue("");
  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.library-panel-open.v1")),
    )
    .toBe("false");

  await page.reload();
  await expect(page.getByTestId("shapes-library-panel")).toHaveAttribute(
    "data-open",
    "false",
  );
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem("icm.recent-components.v1")),
    )
    .toContain("resistor");
});

test("opens named full-width Project examples from the toolbar", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await page.goto("/editor");

  const libraryToggle = page.getByTestId("library-toggle");
  const examplesToggle = page.getByTestId("examples-toggle");
  const libraryTabBox = await libraryToggle.boundingBox();
  const examplesToggleBox = await examplesToggle.boundingBox();
  if (!libraryTabBox || !examplesToggleBox) {
    throw new Error("Library and Examples controls are not measurable");
  }
  // The panel toggles lead the horizontal drawing toolbar instead of standing
  // in a vertical rail, so they share a row and Examples comes first.
  expect(examplesToggleBox.y).toBe(libraryTabBox.y);
  expect(examplesToggleBox.x).toBeLessThan(libraryTabBox.x);
  expect(examplesToggleBox.x).toBeLessThanOrEqual(24);

  await examplesToggle.click();
  const panel = page.getByTestId("examples-panel");
  const exampleList = panel.locator(".shapes-example-list");
  const examples = exampleList.locator(".shapes-example-card");
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(examples).toHaveCount(4);
  expect(
    await exampleList.evaluate(
      (element) =>
        getComputedStyle(element).gridTemplateColumns.split(" ").length,
    ),
  ).toBe(1);
  await expect(
    panel.getByTestId("shapes-example-common-source-amplifier"),
  ).toContainText("Common-Source Amplifier");
  await expect(
    panel.getByTestId("shapes-example-two-stage-op-amp"),
  ).toContainText("Two-Stage Op Amp");
  await expect(
    panel.getByTestId("shapes-example-current-mirror-loaded-differential-pair"),
  ).toContainText("Current-Mirror-Loaded Differential Pair");
  await expect(
    panel.getByTestId("shapes-example-fully-differential-two-stage-op-amp"),
  ).toContainText("Fully Differential Two-Stage Op Amp");

  await examplesToggle.click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(examplesToggle).toHaveAttribute("aria-expanded", "false");

  await examplesToggle.click();
  await expect(panel).toHaveAttribute("data-open", "true");

  // An example joins the drawing on the placement cursor; it never replaces
  // the canvas, so work already on it survives.
  await chooseComponent(page, "resistor");
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 200, y: 150 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  const placedInstances = page.locator('[data-testid^="hit-"]');
  await expect(placedInstances).toHaveCount(1);

  await panel.getByTestId("shapes-example-common-source-amplifier").click();
  await expect(page.getByTestId("status")).toContainText(
    "Place Common-Source Amplifier on the canvas",
  );
  await canvas.click({ position: { x: 520, y: 320 } });
  await expect(page.getByTestId("status")).toContainText(
    "Copied 12 components",
  );
  await page.keyboard.press("Escape");
  // The example joined the drawing: the resistor that was already there stays.
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  const afterFirstExample = await placedInstances.count();
  expect(afterFirstExample).toBeGreaterThan(1);

  await panel.getByTestId("shapes-example-two-stage-op-amp").click();
  await expect(page.getByTestId("status")).toContainText(
    "Place Two-Stage Op Amp on the canvas",
  );
  await canvas.click({ position: { x: 640, y: 180 } });
  await expect(page.getByTestId("status")).toContainText("Copied 7 components");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  expect(await placedInstances.count()).toBeGreaterThan(afterFirstExample);
});

test("keeps a usable canvas while toggling Library at the narrow breakpoint", async ({
  page,
}) => {
  await page.setViewportSize({ width: 720, height: 720 });
  await page.goto("/editor");

  const chrome = page.locator(".app-chrome-main");
  const analytics = page.getByRole("link", { name: "Open visitor analytics" });
  const help = page.getByRole("button", { name: "Help" });
  await expect(analytics).toBeVisible();
  await expect(help).toBeVisible();
  const chromeBox = await chrome.boundingBox();
  const analyticsBox = await analytics.boundingBox();
  const helpBox = await help.boundingBox();
  if (!chromeBox || !analyticsBox || !helpBox) {
    throw new Error("Top navigation is not measurable");
  }
  expect(helpBox.x).toBeGreaterThan(analyticsBox.x);
  expect(helpBox.x + helpBox.width).toBeLessThanOrEqual(
    chromeBox.x + chromeBox.width,
  );

  const panel = page.getByTestId("shapes-library-panel");
  const canvas = page.getByTestId("schematic-canvas");
  await expect(panel).toHaveAttribute("data-open", "false");
  const closedWidth = (await canvas.boundingBox())?.width ?? 0;
  expect(closedWidth).toBeGreaterThan(600);

  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "true");
  await expect(panel.getByText("All", { exact: true })).toBeVisible();
  // The narrow layout keeps the dragged width authoritative rather than
  // pinning the panel to one cramped column, so several chips fit per row
  // while the panel still cannot take more than its share of the window.
  expect(
    await panel
      .locator(".shapes-grid")
      .first()
      .evaluate(
        (element) =>
          getComputedStyle(element).gridTemplateColumns.split(" ").length,
      ),
  ).toBeGreaterThanOrEqual(1);
  const panelWidth = (await panel.boundingBox())?.width ?? 0;
  expect(panelWidth).toBeLessThanOrEqual(720 * 0.6);
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThan(closedWidth);
  const openWidth = (await canvas.boundingBox())?.width ?? 0;
  expect(openWidth).toBeGreaterThan(450);

  await page.getByTestId("selection-shelf").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeCloseTo(closedWidth, 0);
  expect(
    await page.evaluate(() => ({
      horizontal:
        document.documentElement.scrollWidth >
        document.documentElement.clientWidth,
      vertical:
        document.documentElement.scrollHeight >
        document.documentElement.clientHeight,
    })),
  ).toEqual({ horizontal: false, vertical: false });
});

test("double-clicking a placed device opens Properties for editing", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("resistor");
  await dialog.getByLabel("Component value").fill("4.7k");
  await dialog.getByRole("button", { name: "Apply" }).click();
  const canvas = page.getByTestId("schematic-canvas");
  await canvas.click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "false",
  );

  await page.getByTestId("hit-R1").dblclick();
  await expect(page.getByTestId("selection-shelf")).toHaveAttribute(
    "aria-expanded",
    "true",
  );
  const propertyValue = page.getByLabel("Component value");
  await expect(propertyValue).toBeVisible();
  await expect(propertyValue).toHaveValue("4.7k");
  await expect(propertyValue).toBeFocused();
});

test("Library rail folds the sidebar; Insert opens the catalog", async ({
  page,
}) => {
  await page.goto("/editor");
  const panel = page.getByTestId("shapes-library-panel");
  await expect(panel).toHaveAttribute("data-open", "true");

  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "false");
  await page.getByTestId("library-toggle").click();
  await expect(panel).toHaveAttribute("data-open", "true");

  await page.getByTestId("shapes-insert").click();
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toHaveCount(0);

  // No title banner competes with the footer button or the shortcut.
  await expect(panel.getByRole("button", { name: /Quick place/ })).toHaveCount(
    0,
  );
  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
});

test("double-clicking a catalog item applies it immediately", async ({
  page,
}) => {
  await page.goto("/editor");
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByTestId("insert-component-resistor").dblclick();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("status")).toContainText(
    "Place Resistor on the canvas",
  );
  await page.keyboard.press("Escape");
});
