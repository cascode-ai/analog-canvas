// The editor around the drawing: formal export, the palette, recovery, the
// command surface and menus, panels, the Properties dock, Project Code and
// camera fitting.

import { expect, test } from "@playwright/test";
import { resolve } from "node:path";
import { createEmptyProject } from "@icm/model";
import {
  revealPropertiesShelf,
  awaitEditorReady,
  clickCommand,
  clickDrawTool,
  clickNetlistWorkflowCommand,
  downloadBytes,
  readDocumentStyleCode,
  openMenu,
  readRecoveryRecords,
  recoveryProjectTexts,
  renameProject,
} from "./editor-fixtures.js";
import {
  placeComponent,
  openSelectionShelf,
} from "./manual-editor-fixtures.js";

test("formal SVG and PNG contain wide rotated edge labels without clipping", async ({
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
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "export-ink.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  await expect(
    page
      .locator('[data-layer="annotations"] [data-object-id="edge-0"]')
      .first(),
  ).toBeAttached();
  const svg = (await downloadBytes(page, "File", "Export SVG")).toString(
    "utf8",
  );
  const png = await downloadBytes(page, "File", "Export PNG");
  const result = await page.evaluate(
    async ({ svg, png }) => {
      const frame = document.createElement("iframe");
      document.body.append(frame);
      try {
        const doc = frame.contentDocument!;
        // The faces the PNG is drawn in and the canvas shows, so a system
        // without DejaVu Sans installed checks the same text (#1436).
        const faces = doc.createElement("style");
        faces.textContent = [...document.querySelectorAll("style")]
          .map((style) => style.textContent ?? "")
          .filter((css) => css.includes('font-family:"DejaVu Sans"'))
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
        const image = new Image();
        image.src = png;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = image.width;
        canvas.height = image.height;
        const ctx = canvas.getContext("2d")!;
        ctx.drawImage(image, 0, 0);
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let borderInk = 0,
          ink = 0;
        for (let y = 0; y < canvas.height; y++)
          for (let x = 0; x < canvas.width; x++) {
            const offset = (y * canvas.width + x) * 4;
            if (pixels[offset]! < 128 && pixels[offset + 3]! > 128) {
              ink++;
              if (
                x < 2 ||
                y < 2 ||
                x >= canvas.width - 2 ||
                y >= canvas.height - 2
              )
                borderInk++;
            }
          }
        return {
          faceCss: faces.textContent.length,
          overflows,
          borderInk,
          ink,
          width: image.width,
          expectedWidth: Math.round(view.width * 3),
          textCount: root.querySelectorAll("text").length,
        };
      } finally {
        frame.remove();
      }
    },
    { svg, png: `data:image/png;base64,${png.toString("base64")}` },
  );
  expect(result.textCount).toBe(4);
  expect(result.faceCss).toBeGreaterThan(0);
  expect(result.overflows).toEqual([]);
  expect(result.ink).toBeGreaterThan(1000);
  expect(result.borderInk).toBe(0);
  expect(result.width).toBe(result.expectedWidth);
  await expect(page.locator('iframe[aria-hidden="true"]')).toHaveCount(0);
});

test("shows faithful symbol previews for the reviewed Razavi palette", async ({
  page,
}) => {
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.keyboard.press("i");
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  const search = dialog.getByLabel("Component search");
  // Browser coverage owns tile-to-artwork wiring. Catalogue completeness and
  // every symbol's geometry are covered by the symbol contract and goldens.
  for (const symbolId of ["pmos", "resistor", "comparator"]) {
    await search.fill(symbolId);
    await expect(
      dialog
        .getByTestId(`insert-component-${symbolId}`)
        .locator("svg.insert-symbol-artwork"),
    ).toBeVisible();
  }
  await search.fill("pmos");
  const tileArtwork = dialog
    .getByTestId("insert-component-pmos")
    .locator("svg.insert-symbol-artwork");
  await expect(tileArtwork.locator("circle")).toHaveCount(0);
  await expect(tileArtwork.locator("polygon")).toHaveCount(3);
  await expect(dialog.getByTestId("insert-component-nmos3")).toHaveCount(0);
  await expect(dialog.getByTestId("insert-component-pmos3")).toHaveCount(0);
  await page.keyboard.press("Escape");
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

  await page.mouse.move(box.x + 220, box.y + 160);
  await page.mouse.down({ button: "right" });
  await page.mouse.move(box.x + 420, box.y + 320, { steps: 4 });
  await expect(page.getByTestId("zoom-box")).toBeVisible();
  await page.mouse.up({ button: "right" });

  await expect(page.getByTestId("zoom-box")).toHaveCount(0);
  await expect(page.getByTestId("canvas-context-menu")).toHaveCount(0);
  await expect(canvas).not.toHaveAttribute("viewBox", before!);
  await expect(page.getByTestId("status")).toHaveText(
    "Zoomed to framed region",
  );
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
  await expect(page.getByTestId("status")).toHaveText(
    "Zoomed to framed region",
  );
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("edits the complete Project Code with one undo boundary and protects a stale draft", async ({
  page,
}) => {
  await page.goto("/editor");
  const original = createEmptyProject("project-code-e2e", "Project Code E2E");
  await page.getByTestId("project-file").setInputFiles({
    name: "project-code-e2e.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(original)),
  });
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

  const edited = structuredClone(original);
  edited.name = "Edited Project";
  edited.documents[0]!.name = "Edited Main";
  await projectCode.fill(JSON.stringify(edited, null, 2));
  await projectCode.press("ControlOrMeta+Enter");
  await expect(page.getByTestId("project-name")).toHaveText("Edited Project");
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Edited Main",
  );
  await expect(page.getByTestId("status")).toContainText(
    "Applied complete Project Code",
  );

  await page.getByTestId("draw-tool-undo").click();
  await expect(page.getByTestId("project-name")).toHaveText(original.name);
  await expect(page.getByTestId("active-document-name")).toHaveText(
    original.documents[0]!.name,
  );

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
  await page.goto("/editor");
  await awaitEditorReady(page);
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

  const shortcuts = [
    ["g", "examples-toggle"],
    ["b", "library-toggle"],
    ["n", "netlist-panel-toggle"],
  ] as const;
  for (const [key, testId] of shortcuts) {
    const toggle = page.getByTestId(testId);
    const initialPressed = await toggle.getAttribute("aria-pressed");
    await page.keyboard.press(key);
    await expect(toggle).toHaveAttribute(
      "aria-pressed",
      initialPressed === "true" ? "false" : "true",
    );
    await page.keyboard.press(key);
    await expect(toggle).toHaveAttribute("aria-pressed", initialPressed!);
  }
});

test("uses automatic recovery and guards shortcuts while typing", async ({
  page,
}) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  await page.reload();
  // Refresh restores this window's workspace without a second manual restore.
  await awaitEditorReady(page);
  await expect(page.getByTestId("revision")).toHaveText("1");

  await page.keyboard.press("i");
  const search = page.getByLabel("Component search");
  await search.fill("r");
  await page.keyboard.press("r");
  await expect(page.getByTestId("revision")).toHaveText("1");
});

test("keeps component insertion and inspection from resizing the canvas", async ({
  page,
}) => {
  await page.goto("/editor");
  await revealPropertiesShelf(page);
  const canvas = page.getByTestId("schematic-canvas");
  const beforePlaceCanvas = await canvas.boundingBox();
  if (!beforePlaceCanvas) throw new Error("Canvas is not measurable");

  await page.keyboard.press("i");
  await expect(
    page.getByRole("dialog", { name: "Insert Component" }),
  ).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBe(beforePlaceCanvas.width);
  const dialog = page.getByRole("dialog", { name: "Insert Component" });
  await dialog.getByLabel("Component search").fill("pmos");
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
    .toBeLessThan(beforePlaceCanvas.width);

  await expect(page.getByTestId("selection-shelf")).toContainText("M1");
});

test("retains recovery across export but honors explicit discard on replacement", async ({
  page,
}) => {
  await page.goto("/editor");
  for (const x of [280, 360, 440]) {
    await placeComponent(page, "resistor", { x, y: 220 });
  }
  await expect(page.getByTestId("revision")).toHaveText("3");

  // Saving downloads the formal Project but never clears the browser
  // recovery copies; waiting past the debounce proves they survive.
  await downloadBytes(page, "File", "Export Project File…");
  await page.waitForTimeout(500);
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 3');

  // A fresh edit invalidates the export's safe stamp, so the replacement
  // below prompts again.
  await placeComponent(page, "resistor", { x: 520, y: 220 });
  await expect(page.getByTestId("revision")).toHaveText("4");
  // Let the debounced recovery write for revision 4 settle before replacing;
  // a replacement inside the window intentionally drops only the pending
  // write (stale-write protection), never the stored one.
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 4');
  await page
    .getByTestId("project-file")
    .setInputFiles(
      resolve(
        process.cwd(),
        "fixtures/projects/manual-basics/project.icproj.json",
      ),
    );
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Manual Editor Demo",
  );
  // Discard is not a hidden undo stack: it removes the outgoing working copy,
  // while the incoming Project seeds its own bounded recovery session.
  await expect
    .poll(async () => {
      const texts = await recoveryProjectTexts(page);
      return (
        !texts.includes('"revision": 2') &&
        texts.includes('"name": "Phase 1 Manual Editor"')
      );
    })
    .toBe(true);
});

test("discard recovery clears the recovery slot", async ({ page }) => {
  await page.goto("/editor");
  await placeComponent(page, "resistor", { x: 360, y: 220 });
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');

  await page.reload();
  await clickCommand(page, "File", "Recover Unsaved Work…");
  await page
    .getByRole("dialog", { name: "Recover recent work" })
    .getByRole("button", { name: "Delete" })
    .click();
  await expect
    .poll(async () => (await readRecoveryRecords(page)).length)
    .toBe(0);
});

test("keeps the production command surface compact and publishes PWA metadata", async ({
  page,
}) => {
  await page.goto("/editor");
  // The right action group holds simulation, Agent, and Publish; File, Edit,
  // and Circuit remain in the left brand group.
  const toolbar = page.locator(".app-chrome-actions");
  await expect(toolbar.getByTestId("open-analog-simulation")).toBeVisible();
  await expect(toolbar.getByTestId("open-agent")).toBeVisible();
  await expect(toolbar.getByTestId("publish-gallery-button")).toBeVisible();
  // Publish keeps its fill under the pointer; the app-wide button hover once
  // turned it grey under the white label.
  const publish = toolbar.getByTestId("publish-gallery-button");
  // Read the settled colour: a running transition still reports its start.
  const fill = () =>
    publish.evaluate((element) => {
      for (const animation of element.getAnimations()) animation.finish();
      return getComputedStyle(element).backgroundColor;
    });
  const resting = await fill();
  await publish.hover();
  expect(await fill()).toBe(resting);
  await expect(page.getByTestId("copy-netlist")).toBeHidden();
  await expect(page.getByTestId("check-and-save")).toBeHidden();
  // Three header menus, one open at a time: File, Edit, and Circuit
  // (Hierarchy and Netlist).
  const netlist = await openMenu(page, "Netlist");
  await expect(netlist.getByTestId("copy-netlist")).toBeVisible();
  const file = await openMenu(page, "File");
  await expect(file.getByTestId("check-and-save")).toBeVisible();
  await expect(page.getByTestId("copy-netlist")).toBeHidden();
  for (const group of ["Edit", "Hierarchy"])
    await expect(await openMenu(page, group)).toBeVisible();
  await expect(page.getByTestId("check-and-save")).toBeHidden();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("circuit-menu")).not.toHaveAttribute("open");
  await clickNetlistWorkflowCommand(page, "open-analog-simulation");
  await expect(
    page.getByRole("region", { name: "Analog simulation" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Exit Simulation" }).click();
  await page
    .getByRole("dialog", { name: "Exit Simulation?" })
    .getByRole("button", { name: "Exit Simulation", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Exit Simulation?" }),
  ).toHaveCount(0);
  // Drawing tools live in the always-visible toolbar, not behind a menu.
  await expect(toolbar.locator("summary", { hasText: "Draw" })).toHaveCount(0);
  await expect(page.getByTestId("draw-toolbar")).toBeVisible();
  await expect(toolbar.locator("summary", { hasText: "More" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "View" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "Style" })).toHaveCount(0);
  await expect(toolbar.locator("summary", { hasText: "Export" })).toHaveCount(
    0,
  );
  await clickDrawTool(page, "wire");
  await expect(page.getByTestId("active-tool")).toHaveText("wire");
  for (const obsolete of [
    "Select",
    "Junction",
    "Crossing",
    "Stretch",
    "Detach",
    "Guide",
  ]) {
    await expect(
      toolbar.getByRole("button", { name: obsolete, exact: true }),
    ).toHaveCount(0);
  }

  const manifest = await page
    .locator('link[rel="manifest"]')
    .getAttribute("href");
  expect(manifest).toBe("/manifest.webmanifest");
  const manifestPayload = await (
    await page.request.get("/manifest.webmanifest")
  ).json();
  expect(manifestPayload).toMatchObject({
    name: "Analog Canvas",
    display: "standalone",
    theme_color: "#2383e2",
    icons: [
      {
        src: "./icon-192.png?v=nmos-4",
        sizes: "192x192",
        purpose: "any",
      },
      {
        src: "./icon-512.png?v=nmos-4",
        sizes: "512x512",
        purpose: "any",
      },
    ],
  });
});

test("shows first-party visitor analytics without tracking the dashboard itself", async ({
  page,
}) => {
  await page.addInitScript(() => localStorage.setItem("theme", "dark"));
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

test("splits the analytics into Analog Canvas and Arena", async ({ page }) => {
  const day = (date: string, canvas: number[], arena: number[]) => ({
    date,
    products: {
      canvas: { pv: canvas[0], uv: canvas[1] },
      arena: { pv: arena[0], uv: arena[1] },
      both: 1,
    },
  });
  // One visitor of both products counts once in the day's total and in both.
  const days = [
    { date: "2026-08-10", pv: 4, uv: 3, products: null },
    { ...day("2026-08-11", [3, 2], [2, 2]), pv: 5, uv: 3 },
    { ...day("2026-08-12", [4, 3], [2, 2]), pv: 6, uv: 4 },
  ];
  const none = { pv: 0, uv: 0 };
  await page.route("**/api/analytics", (route) =>
    route.fulfill({
      json: {
        generatedAt: "2026-08-12T12:00:00.000Z",
        totals: { pv: 15, uv: 6 },
        today: days[2],
        days,
        countries: [],
        points: [],
        paths: [],
        sources: [],
        breakdownStartedAt: "2026-05-01T00:00:00.000Z",
        productsStartedAt: "2026-08-11T08:30:00.000Z",
        breakdownTotals: { countries: none, sources: none, pages: none },
      },
    }),
  );

  await page.goto("/analytics");

  // Today: Arena has 2 of the 4 visitors and 2 of the 6 views.
  const products = page.getByRole("region", { name: "Products" });
  const arena = products.getByRole("row", { name: /^Arena/ });
  await expect(arena).toContainText("50.0%");
  await expect(arena).toContainText("33.3%");
  const canvas = products.getByRole("row", { name: /^Analog Canvas/ });
  await expect(canvas).toContainText("75.0%");
  await expect(canvas).toContainText("66.7%");
  // One of today's 4 visitors used both; a visitor of both has no views of
  // its own.
  const both = products.getByRole("row", { name: /^Both/ });
  await expect(both).toContainText("25.0%");
  await expect(both.getByRole("cell").nth(2)).toHaveText("—");

  const note = page.getByText(
    "Split by product from 2026-08-11; earlier days have no split.",
  );
  await expect(note).toHaveCount(0);
  await page
    .getByRole("combobox", { name: "Product" })
    .selectOption({ label: "Arena" });
  const chart = page.getByRole("img", {
    name: "Daily page views and unique visitors, Arena",
  });
  await expect(
    chart.locator("title", { hasText: "2026-08-12: 2 views, 2 visitors" }),
  ).not.toHaveCount(0);
  await expect(
    chart.locator("title", { hasText: "2026-08-10: not split by product" }),
  ).not.toHaveCount(0);
  await expect(note).toBeVisible();

  await page
    .getByRole("combobox", { name: "Product" })
    .selectOption({ label: "Both products" });
  const bothChart = page.getByRole("img", {
    name: "Daily unique visitors of both products",
  });
  await expect(
    bothChart.locator("title", { hasText: "2026-08-11: 1 visitors" }),
  ).not.toHaveCount(0);
  // Visitors of both have no page views of their own.
  await expect(bothChart.locator("title", { hasText: "views" })).toHaveCount(0);
});

test("dismisses a command menu on outside click or Escape", async ({
  page,
}) => {
  await page.goto("/editor");
  // The File commands are a group in the header's one menu.
  const menu = page.getByTestId("project-menu");
  await openMenu(page, "File");
  await expect(menu).toHaveAttribute("open", "");

  // A blank canvas click dismisses the menu without navigating away.
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 400, y: 300 } });
  await expect(menu).not.toHaveAttribute("open", "");

  await openMenu(page, "File");
  await page.keyboard.press("Escape");
  await expect(menu).not.toHaveAttribute("open", "");
});

test("selecting an object does not change canvas width", async ({ page }) => {
  await page.goto("/editor");
  await revealPropertiesShelf(page);
  const canvas = page.getByTestId("schematic-canvas");
  const widthBefore = (await canvas.boundingBox())!.width;

  // Selecting a placed component leaves the explicitly collapsed inspector
  // collapsed; it must not change the canvas width.
  await placeComponent(page, "resistor", { x: 280, y: 180 });
  await expect(page.getByTestId("hit-R1")).toBeVisible();

  const widthAfter = (await canvas.boundingBox())!.width;
  expect(widthAfter).toBe(widthBefore);
});

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
  await expect(propertiesButton).toHaveAttribute(
    "title",
    "Properties: Ports, canvas, and selected objects",
  );
  await clickDrawTool(page, "document-style");
  const settings = page.getByLabel("Document settings");
  await expect(settings).toBeVisible();
  await expect(
    settings.getByRole("button", {
      name: "Format all Port labels in this Cell",
    }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Port label formatting" }),
  ).toHaveCount(0);
  await expect(page.getByTestId("hit-R1")).toBeVisible();
  await expect(settings.getByLabel("Editable Properties code")).toBeVisible();
  await expect(settings.locator("select.cm-netlist-target-select")).toHaveCount(
    0,
  );
  await expect(
    settings.getByRole("button", { name: "Show Font size previews" }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", {
      name: "Show NMOS body / substrate previews",
    }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", {
      name: "Show PMOS previews",
    }),
  ).toBeVisible();
  await expect(
    settings.getByRole("button", { name: /^Show .+ previews$/u }),
  ).toHaveCount(16);
  await settings
    .getByRole("button", {
      name: "Show Subscript after first letter previews",
    })
    .click();
  const subscriptPreview = page.getByRole("listbox", {
    name: "Subscript after first letter previews",
  });
  await expect(subscriptPreview).toBeVisible();
  const subscriptOption = subscriptPreview.getByRole("option", {
    name: /Subscript after the first letter/u,
  });
  const subscriptFirst = subscriptOption.locator(
    ".cm-property-label-preview-first",
  );
  const subscriptSuffix = subscriptOption.locator(
    ".cm-property-label-preview-suffix[data-subscript]",
  );
  await expect(subscriptSuffix).toHaveText("in");
  const firstBox = await subscriptFirst.boundingBox();
  const suffixBox = await subscriptSuffix.boundingBox();
  expect(firstBox).not.toBeNull();
  expect(suffixBox).not.toBeNull();
  expect(suffixBox!.height).toBeGreaterThan(0);
  expect(suffixBox!.y).toBeGreaterThan(firstBox!.y + 6);
  await expect(subscriptOption).not.toContainText("ᵢₙ");
  await page.keyboard.press("Escape");
  await settings
    .getByRole("button", { name: "Show NMOS body / substrate previews" })
    .click();
  const bulkPreview = page.getByRole("listbox", {
    name: "NMOS body / substrate previews",
  });
  await expect(bulkPreview).toContainText("VSSNMOS→VSS");
  await page.keyboard.press("Escape");
  // The one note: the NMOS body default is also the PDK substrate (#1530).
  await expect(settings.locator(".cm-property-unit")).toHaveText([
    "// and substrate",
  ]);
  await settings
    .getByRole("button", { name: "Show Font size previews" })
    .click();
  await page
    .getByRole("listbox", { name: "Font size previews" })
    .getByRole("option", { name: /^1\.5×/u })
    .click();
  await expect(label).toHaveAttribute("font-size", "22.674");
  await expect(page.getByTestId("status")).toContainText(
    "Updated Properties code",
  );

  const styleSource = await readDocumentStyleCode(page);
  const style = JSON.parse(styleSource);
  expect(style.bulkDefaults).toEqual({ nmos: "VSS", pmos: "VDD" });
  expect(style.labels).toEqual({
    first_letter_italic: true,
    subscript_after_first: false,
    subscript_case: "preserve",
    subscript_italic: false,
    underscore_subscript: true,
  });
  expect(style.canvas).toEqual({
    showGrid: true,
    annotationGrid: 5,
    drawAngle: "free",
    scrollBehavior: "auto",
  });
  await settings
    .getByLabel("Editable Properties code", { exact: true })
    .press("Enter");
  expect(await readDocumentStyleCode(page)).toBe(styleSource);

  await settings.getByRole("button", { name: "Defaults", exact: true }).click();
  await expect(label).toHaveAttribute("font-size", "15.116");
  expect(
    JSON.parse(await readDocumentStyleCode(page)).appearance.fontScale,
  ).toBe(1);

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
