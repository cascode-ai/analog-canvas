// The editor around the drawing: formal export, the command surface and
// menus, panels, analytics, the Properties dock, Project Code and camera
// fitting. Recovery is recovery-dialog's and recovery-hardening's.

import { expect, test } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import {
  revealPropertiesShelf,
  clickDrawTool,
  downloadBytes,
  expectStatus,
  openMenu,
  openProjectFile,
  renameProject,
  openEditor,
  openProject,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";

test("formal SVG keeps wide rotated edge labels inside its figure, and the PNG is that figure", async ({
  page,
}) => {
  const project = createEmptyProject("export-ink", "Export ink");
  const schematic = project.documents[0]!;
  schematic.drafting = {
    objects: [
      {
        id: "edge-circle",
        kind: "circle",
        locked: false,
        zIndex: 0,
        anchor: { kind: "free", position: { x: 400, y: 0 } },
        center: { x: 0, y: 0 },
        radius: 20,
        lineStyle: "solid",
        styleOverride: { strokeScale: 4 },
      },
    ],
  };
  for (const [index, rotation] of ([0, 90, 180, 270] as const).entries()) {
    schematic.annotations.push({
      id: `edge-${index}`,
      kind: "instance-label",
      locked: false,
      content: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [
              {
                kind: "span",
                style: "italic",
                children: [{ kind: "text", value: "WWWWMMMM" }],
              },
            ],
          },
        ],
      },
      anchor: {
        kind: "free",
        position: { x: (index % 2) * 200, y: Math.floor(index / 2) * 200 },
      },
      alignment: "start",
      rotation,
    });
  }
  await openProject(page, project, "export-ink.icproj.json");
  await expect(
    page
      .locator('[data-layer="annotations"] [data-object-id="edge-0"]')
      .first(),
  ).toBeAttached();
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  const result = await page.evaluate(async (svg) => {
    const frame = document.createElement("iframe");
    document.body.append(frame);
    try {
      const doc = frame.contentDocument!;
      // The faces the PNG is drawn in and the canvas shows, so a system
      // without the schematic fonts installed checks the same text (#1436).
      const faces = doc.createElement("style");
      faces.textContent = [...document.querySelectorAll("style")]
        .map((style) => style.textContent ?? "")
        .filter((css) => css.includes('font-family:"Metropolis"'))
        .join("");
      doc.head.append(faces);
      doc.body.innerHTML = svg;
      doc.querySelector("svg")!.getBBox();
      await doc.fonts.ready;
      const root = doc.querySelector("svg")!;
      const view = root.viewBox.baseVal;
      const inverse = root.getCTM()!.inverse();
      const overflows: string[] = [];
      for (const text of root.querySelectorAll("text")) {
        const box = text.getBBox();
        const transform = inverse.multiply(text.getCTM()!);
        for (const x of [box.x, box.x + box.width])
          for (const y of [box.y, box.y + box.height]) {
            const p = new DOMPoint(x, y).matrixTransform(transform);
            if (
              p.x < view.x ||
              p.y < view.y ||
              p.x > view.x + view.width ||
              p.y > view.y + view.height
            )
              overflows.push(text.textContent ?? "");
          }
      }
      return {
        faceCss: faces.textContent.length,
        overflows,
        viewWidth: view.width,
        textCount: root.querySelectorAll("text").length,
      };
    } finally {
      frame.remove();
    }
  }, svg);
  expect(result.textCount).toBe(4);
  expect(result.faceCss).toBeGreaterThan(0);
  expect(result.overflows).toEqual([]);
  // The PNG is that same figure at three times its size (exporters' "derives
  // SVG, PNG, and PDF from one formal scene"; its faces are browser-raster's).
  const png = await downloadBytes(page, "File", "Export PNG");
  expect(png.readUInt32BE(16)).toBe(Math.round(result.viewWidth * 3));
  await expect(page.locator('iframe[aria-hidden="true"]')).toHaveCount(0);
});

test("right-drag frames a region and fits the camera to it transiently", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 200 });

  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  const before = await canvas.getAttribute("viewBox");
  const status = page.getByTestId("status");

  await page.mouse.move(box.x + 220, box.y + 160);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + 420, box.y + 320, { steps: 4 });
  await expect(page.getByTestId("zoom-box")).toBeVisible();
  await page.mouse.up({ button: "right" });

  await expect(page.getByTestId("zoom-box")).toHaveCount(0);
  await expect(page.getByTestId("canvas-context-menu")).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute("viewBox", before!);
  await expect(status).toHaveText("Zoomed to framed region");
  // Framing is a camera gesture: the document revision must not move.
  await expect(page.getByTestId("revision")).toHaveText("1");

  // A right click that never framed must not change the camera either.
  const framed = await canvas.getAttribute("viewBox");
  await page.mouse.move(box.x + 300, box.y + 240);
  await page.mouse.down({ button: "right" });
  await page.mouse.up({ button: "right" });
  await expect(canvas).toHaveAttribute("viewBox", framed!);
  await expect(page.getByTestId("canvas-context-menu")).toBeVisible();

  // Alt+left-drag frames the same region for environments whose system
  // software hooks the right button before the browser sees the drag.
  await page.keyboard.down("Alt");
  await page.mouse.move(box.x + 200, box.y + 140);
  await page.mouse.down();
  // Dismiss the non-modal menu without consuming this framing gesture.
  await expect(page.getByTestId("canvas-context-menu")).toHaveCount(0);
  await page.mouse.move(box.x + 460, box.y + 340, { steps: 4 });
  await expect(page.getByTestId("zoom-box")).toBeVisible();
  await page.mouse.up();
  await page.keyboard.up("Alt");

  await expect(page.getByTestId("zoom-box")).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute("viewBox", framed!);
  await expect(status).toHaveText("Zoomed to framed region");
  await expect(page.getByTestId("revision")).toHaveText("1");
});

// Applying edited code in one undoable step is project-source-format's and
// project-code's ("commits authored code once…").
test("shows the complete Project Code and protects an invalid or stale draft", async ({
  page,
}) => {
  await page.goto("/editor");
  const original = createEmptyProject("project-code-e2e", "Project Code E2E");
  await openProjectFile(page, original, "project-code-e2e.icproj.json");
  await page.getByTestId("project-code-toggle").click();
  const projectCode = page.getByRole("textbox", { name: "Project code" });
  const apply = page.getByRole("button", { name: "Apply", exact: true });
  const reload = page.getByRole("button", { name: "Reload", exact: true });
  await expect(projectCode).toBeVisible();
  await expect(
    page
      .getByRole("region", { name: "Project Code", exact: true })
      .getByRole("heading"),
  ).toHaveCount(0);
  const projectEditor = page.locator(
    '.project-source-editor[data-language="json"]',
  );
  await expect(projectEditor.locator(".cm-lineNumbers")).toBeVisible();
  await expect(
    projectEditor.locator(".cm-gutterElement").filter({ hasText: /^1$/u }),
  ).toBeVisible();
  expect(
    await projectEditor.locator(".cm-content").evaluate((content) => {
      const colors = [getComputedStyle(content).color];
      for (const token of content.querySelectorAll("span"))
        colors.push(getComputedStyle(token).color);
      return new Set(colors).size;
    }),
  ).toBeGreaterThan(1);

  await projectCode.fill("{");
  await expect(apply).toBeDisabled();
  await expect(page.getByRole("alert")).toBeVisible();
  await reload.click();

  const staleDraft = structuredClone(original);
  staleDraft.name = "Draft Project";
  await projectCode.fill(JSON.stringify(staleDraft, null, 2));
  await renameProject(page, "Canvas changed");
  await expect(page.getByRole("alert")).toContainText("live Project changed");
  await expect(apply).toBeDisabled();
  await reload.click();
  await expect(projectCode).toContainText('"name": "Canvas changed"');
});

test("keeps panel tooltips visible and exposes panel keyboard shortcuts", async ({
  page,
}) => {
  await openEditor(page);
  const gallery = page.getByTestId("examples-toggle");
  await expect(gallery).not.toHaveAttribute("title");
  await expect(gallery).toHaveAttribute("aria-keyshortcuts", "G");
  await gallery.hover();
  const tooltip = page.getByRole("tooltip");
  await expect(tooltip).toContainText("Insert a circuit from the Gallery");
  await expect(tooltip).toContainText("(G)");
  const tooltipBounds = await tooltip.boundingBox();
  expect(tooltipBounds).not.toBeNull();
  expect(tooltipBounds!.x).toBeGreaterThanOrEqual(8);
  expect(tooltipBounds!.x + tooltipBounds!.width).toBeLessThanOrEqual(
    await page.evaluate(() => window.innerWidth - 8),
  );

  // B and N toggle their panels the same way (editor-shortcuts maps all three).
  const initialPressed = await gallery.getAttribute("aria-pressed");
  await page.keyboard.press("g");
  await expect(gallery).toHaveAttribute(
    "aria-pressed",
    initialPressed === "true" ? "false" : "true",
  );
  await page.keyboard.press("g");
  await expect(gallery).toHaveAttribute("aria-pressed", initialPressed!);
});

test("keeps insertion, selection and inspection from resizing the canvas, and typing from triggering shortcuts", async ({
  page,
}) => {
  await page.goto("/editor");
  await revealPropertiesShelf(page);
  const canvas = page.getByTestId("schematic-canvas");
  const width = (await canvas.boundingBox())!.width;

  // Selecting a placed component leaves the explicitly collapsed inspector
  // collapsed; it must not change the canvas width.
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  expect((await canvas.boundingBox())!.width).toBe(width);

  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await expect(dialog).toBeVisible();
  expect((await canvas.boundingBox())!.width).toBe(width);
  // Typing in the search field never reaches the canvas: R does not rotate.
  const search = dialog.getByLabel("Component search");
  await search.fill("r");
  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await search.fill("pmos");
  await dialog.getByTestId("insert-component-pmos").click();
  await canvas.click({ position: { x: 420, y: 260 } });

  await expect(
    page.getByRole("complementary", { name: "Properties" }),
  ).toBeVisible();
  await revealPropertiesShelf(page);
  await page.getByTestId("selection-shelf").click();
  // Opening the dock changes its CSS width through a short transition. Poll
  // the resulting canvas geometry rather than sampling before that transition
  // has started.
  await expect
    .poll(async () => (await canvas.boundingBox())?.width ?? 0)
    .toBeLessThan(width);
  await expect(page.getByTestId("selection-shelf")).toContainText("M1");
});

// The header's menu groups and its retired tools are App.test's; this is
// the hover colour, one-open-menu focus and the served PWA manifest.
test("keeps the command surface compact, its menus dismissable, and publishes PWA metadata", async ({
  page,
}) => {
  await page.goto("/editor");
  // Publish rests in soft blue and turns solid blue under the pointer
  // (#1612); the app-wide button hover once turned it grey instead.
  const publish = page
    .locator(".app-chrome-actions")
    .getByTestId("publish-gallery-button");
  // Read the settled colour: a running transition still reports its start.
  const fill = () =>
    publish.evaluate((element) => {
      for (const animation of element.getAnimations()) animation.finish();
      return getComputedStyle(element).backgroundColor;
    });
  expect(await fill()).toBe("rgba(35, 131, 226, 0.1)");
  await publish.hover();
  await expect.poll(fill).toBe("rgb(35, 131, 226)");

  // Header menus, one open at a time; a blank canvas click or Escape
  // dismisses them without navigating away.
  await expect(page.getByTestId("copy-netlist")).toBeHidden();
  const netlist = await openMenu(page, "Netlist");
  await expect(netlist.getByTestId("copy-netlist")).toBeVisible();
  const file = await openMenu(page, "File");
  await expect(file.getByTestId("check-and-save")).toBeVisible();
  await expect(page.getByTestId("copy-netlist")).toBeHidden();
  const menu = page.getByTestId("project-menu");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 400, y: 300 } });
  await expect(menu).not.toHaveAttribute("open", "");
  await openMenu(page, "File");
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
  await expect(page.getByTestId("draw-toolbar")).toBeVisible();

  expect(await page.locator('link[rel="manifest"]').getAttribute("href")).toBe(
    "/manifest.webmanifest",
  );
  expect(
    await (await page.request.get("/manifest.webmanifest")).json(),
  ).toMatchObject({
    name: "Analog Canvas",
    display: "standalone",
    theme_color: "#2383e2",
    icons: [
      { src: "./icon-192.png?v=nmos-4", sizes: "192x192", purpose: "any" },
      { src: "./icon-512.png?v=nmos-4", sizes: "512x512", purpose: "any" },
    ],
  });
});

test("shows first-party visitor analytics without tracking the dashboard itself", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
  // An administrator: the page asks the session before the admin count.
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "admin-1",
          displayName: "Admin",
          provider: "google",
          isAdmin: true,
        },
      },
    }),
  );
  await page.route("**/api/auth/admin/stats", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ registeredAccounts: 42 }),
    });
  });
  let dashboardTracked = false;
  await page.route("**/api/track", async (route) => {
    dashboardTracked = true;
    await route.fulfill({ status: 204 });
  });
  await page.route("**/api/analytics", async (route) => {
    const countries = [
      "CN",
      "US",
      "GB",
      "DE",
      "FR",
      "JP",
      "SG",
      "CA",
      "AU",
      "IN",
      "NZ",
    ].map((code, index) => ({ code, pv: 12 - index, uv: 11 - index }));
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        generatedAt: "2026-08-12T00:00:00.000Z",
        totals: { pv: 12, uv: 7 },
        today: { date: "2026-08-12", pv: 3, uv: 2 },
        days: [
          { date: "2026-05-15", pv: 1, uv: 1 },
          { date: "2026-08-12", pv: 3, uv: 2 },
        ],
        countries,
        points: [{ lat: 40, lng: 116, count: 8 }],
        paths: [{ path: "/", pv: 12, uv: 7 }],
        sources: [{ source: "direct-or-unknown", pv: 12, uv: 7 }],
        breakdownStartedAt: "2026-08-12T00:00:00.000Z",
        breakdownTotals: {
          countries: { pv: 12, uv: 7 },
          sources: { pv: 12, uv: 7 },
          pages: { pv: 12, uv: 7 },
        },
      }),
    });
  });

  await page.goto("/analytics");
  await expect(page.getByRole("heading", { name: "Analytics" })).toBeVisible();
  await expect(page.getByText("Registered accounts")).toBeVisible();
  await expect(page.getByText("42", { exact: true })).toBeVisible();
  await expect(page).toHaveTitle("Analytics — Analog Canvas");
  await expect(
    page.getByRole("link", { name: "Back to editor" }),
  ).toHaveAttribute("href", "/");
  await expect(page.getByRole("textbox", { name: "From" })).toHaveValue(
    "2026-05-15",
  );
  await expect(
    page.getByRole("textbox", { name: "To", exact: true }),
  ).toHaveValue("2026-08-12");
  await expect(
    page.getByRole("button", { name: "Last 90 days" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "ISO 3166 Code" }),
  ).toBeVisible();
  await expect(page.getByText("China")).toBeVisible();
  await expect(page.getByText("New Zealand")).toHaveCount(0);
  await page.getByRole("button", { name: "Show all 11" }).click();
  await expect(page.getByText("New Zealand")).toBeVisible();

  const themeSwitch = page.getByRole("button", {
    name: "Switch to light theme",
  });
  await themeSwitch.click();
  await expect(page.locator("html")).toHaveClass(/light/);
  await expect(
    page.getByRole("button", { name: "Switch to dark theme" }),
  ).toBeVisible();
  expect(dashboardTracked).toBe(false);
});

// The settings code, its sixteen bounded choices, the serialized shape and
// Defaults are document-settings-code's; this is the docked surface.
test("docked Properties JSON is the only global configuration surface", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 320, y: 220 });
  const label = page.locator('[data-kind="instance-label"]').first();
  await expect(label).toHaveAttribute("font-size", "15.116");

  // Properties is the visible, non-modal home for current-Cell Port tools and
  // the single copyable Properties JSON surface.
  const propertiesButton = page.getByTestId("draw-tool-document-style");
  await expect(propertiesButton).toHaveText("Properties");
  await clickDrawTool(page, "document-style");
  const settings = page.getByLabel("Document settings");
  await expect(settings).toBeVisible();
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(settings.getByLabel("Editable Properties code")).toBeVisible();

  // The subscript preview draws a real lowered suffix, not Unicode scripts.
  await settings
    .getByRole("button", {
      name: "Show Subscript after first letter previews",
    })
    .click();
  const subscriptOption = page
    .getByRole("listbox", { name: "Subscript after first letter previews" })
    .getByRole("option", { name: /Subscript after the first letter/u });
  const subscriptFirst = subscriptOption.locator(
    ".cm-property-label-preview-first",
  );
  const subscriptSuffix = subscriptOption.locator(
    ".cm-property-label-preview-suffix[data-subscript]",
  );
  await expect(subscriptSuffix).toHaveText("in");
  const firstBox = (await subscriptFirst.boundingBox())!;
  const suffixBox = (await subscriptSuffix.boundingBox())!;
  expect(suffixBox.height).toBeGreaterThan(0);
  expect(suffixBox.y).toBeGreaterThan(firstBox.y + 6);
  await expect(subscriptOption).not.toContainText("ᵢₙ");
  await page.keyboard.press("Escape");

  // A preview choice is applied to the live drawing, and Defaults undoes it.
  await settings
    .getByRole("button", { name: "Show Font size previews" })
    .click();
  await page
    .getByRole("listbox", { name: "Font size previews" })
    .getByRole("option", { name: /^1\.5×/u })
    .click();
  await expect(label).toHaveAttribute("font-size", "22.674");
  await expectStatus(page, "Updated Properties code");
  await settings.getByRole("button", { name: "Defaults", exact: true }).click();
  await expect(label).toHaveAttribute("font-size", "15.116");

  // Object Properties replace global document settings instead of stacking
  // a second code editor below them.
  await page.keyboard.press("q");
  await expect(settings).toHaveCount(0);
  await expect(page.getByLabel("Editable Canvas property code")).toBeVisible();

  // A project code panel owns the same right-side workspace and closes the
  // global settings surface rather than restoring it under the Netlist.
  await clickDrawTool(page, "document-style");
  await expect(settings).toBeVisible();
  await page.getByTestId("netlist-panel-toggle").click();
  await expect(settings).toHaveCount(0);
  await expect(propertiesButton).toHaveAttribute("aria-pressed", "false");
  await expect(
    page.getByRole("complementary", { name: "Properties" }),
  ).toHaveCount(0);
});

test("Fit View keeps the drawing clear of the Properties dock", async ({
  page,
}) => {
  // Below 860px the Properties dock stops being a column and floats over the
  // canvas — the half-screen case where fitting to the element hid work.
  await page.setViewportSize({ width: 800, height: 800 });
  await page.goto("/editor");
  const canvas = page.getByTestId("schematic-canvas");

  await placeComponent(page, "resistor", { x: 120, y: 160 });
  await placeComponent(page, "capacitor", { x: 320, y: 260 });
  await placeComponent(page, "resistor", { x: 520, y: 360 });
  await page.keyboard.press("Escape");

  // Open Properties so it floats over the canvas at full width.
  await canvas.click({ position: { x: 120, y: 160 } });
  await openSelectionShelf(page);
  const dock = page.locator(".selection-dock");
  // The dock animates open over 160ms; measure the settled width.
  await expect
    .poll(async () => (await dock.boundingBox())?.width ?? 0)
    .toBeGreaterThan(120);
  const dockBox = (await dock.boundingBox())!;

  await page.keyboard.press("Escape");
  await page.keyboard.press("f");

  // Every symbol has to land left of the dock: the canvas runs underneath it,
  // so fitting to the element alone put part of the drawing out of sight.
  const rights = await page
    .locator('[data-layer="symbols"] [data-object-id]')
    .evaluateAll((elements) =>
      elements.map((element) => element.getBoundingClientRect().right),
    );
  expect(rights).toHaveLength(3);
  for (const right of rights) expect(right).toBeLessThanOrEqual(dockBox.x);
});
