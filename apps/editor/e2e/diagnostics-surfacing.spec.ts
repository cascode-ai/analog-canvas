import { expect, test } from "@playwright/test";
import { createEmptyProject, createRoutePath } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { onScreen, placedInstance } from "./canvas-fixtures.js";

import {
  clickNetlistWorkflowCommand,
  expectStatus,
  placeComponentAt,
  openEditor,
  openProject,
} from "./editor-fixtures";

/**
 * Findings must reach the person drawing: the statusbar carries a persistent
 * issues badge fed by an explicit check, and clicking it opens the
 * properties dock with the issues section expanded, where each finding
 * navigates to its object.
 */
test("Check and Save surfaces findings in the existing workbench and canvas", async ({
  page,
}) => {
  await openEditor(page);

  // A fresh document rests at a quiet, still-clickable entry point.
  const badge = page.getByTestId("statusbar-issues");
  await expect(badge).toHaveAttribute("data-severity", "none");
  await expect(badge).toHaveText("Not checked");

  // Unfinished drawing produces neither diagnostic counts nor markers.
  await placeComponentAt(page, "resistor", { x: 400, y: 240 });
  await expect(badge).toHaveText("Not checked");
  await expect(page.locator(".diagnostic-marker")).toHaveCount(0);
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(badge).toHaveAttribute("data-severity", "warning");
  await expect(badge).toContainText("warning");
  await expect(page.getByTestId("check-and-save")).toBeEnabled();
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );

  // The badge opens the dock with the issues section expanded.
  await badge.click();
  const issuesSection = page.locator(
    'section[aria-label="Project diagnostics"] details',
  );
  await expect(issuesSection).toHaveAttribute("open", "");
  const findings = page.getByTestId("project-diagnostics").locator("li button");
  await expect(findings.first()).toBeVisible();

  // Review mode places a warning ring on each finding's pin.
  const markers = page.locator(".diagnostic-marker");
  await expect(markers).toHaveCount(2);
  await expect(markers.first()).toHaveAttribute("data-severity", "warning");

  // A finding navigates: the status line reports the ERC jump.
  await findings.first().click();
  await expectStatus(page, "ERC");

  // A marker ring navigates the same way from the canvas side. The hit is
  // the ring band only — the centre stays click-through for the pin — so
  // aim for the top of the band (screen coordinates, ~15% down the box).
  const ringBox = (await page
    .locator(".diagnostic-marker-hit")
    .first()
    .boundingBox())!;
  await page.mouse.click(
    ringBox.x + ringBox.width / 2,
    ringBox.y + ringBox.height * 0.15,
  );
  await expectStatus(page, "ERC_UNCONNECTED_PIN");
});

test("signed-out Save does not suppress ERC or visual check results", async ({
  page,
}) => {
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await page.goto("/editor");
  // The overlapping pair supplies visual evidence; exact terminal contact
  // can legitimately resolve its ERC. A separate resistor stays unwired.
  for (const position of [
    { x: 400, y: 240 },
    { x: 400, y: 240 },
    { x: 620, y: 350 },
  ]) {
    await placeComponentAt(page, "resistor", position);
  }
  await expect(page.getByTestId("statusbar-issues")).toHaveText("Not checked");
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expectStatus(page, "Sign in to save");
  await expect(page.getByTestId("project-diagnostics")).toContainText(
    "ERC_UNCONNECTED_PIN",
  );
  // Signed-out Save now offers sign-in/download (#2161). Dismiss it as a
  // reader would before using the diagnostics behind the modal.
  await page
    .getByTestId("save-sign-in-dialog")
    .getByRole("button", { name: "Not now", exact: true })
    .click();
  await page.getByTestId("diagnostic-observations-toggle").click();
  await expect(page.getByTestId("project-diagnostics")).toContainText(
    "VISUAL_SYMBOL_OVERLAP",
  );
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
});

// Free-angle wires raise no diagnostic, and 45-degree ones are left alone
// (visual "accepts arbitrary wire angles…", angled-wire-repair "repairs
// arbitrary angles while preserving orthogonal and 45-degree routes"); this
// is the repair button, its status and its one undo.
test("accepts free angles and optionally straightens them in one undoable action", async ({
  page,
}) => {
  const project = createEmptyProject("angled-wire-project", "Angled wires");
  const document = project.documents[0]!;
  document.nets.push({ id: "net-bad", terminals: [] });
  document.junctions.push(
    { id: "bad-from", netId: "net-bad", position: { x: 200, y: 200 } },
    { id: "bad-to", netId: "net-bad", position: { x: 260, y: 230 } },
  );
  document.routes.push(
    createRoutePath({
      id: "route-bad",
      netId: "net-bad",
      start: { kind: "junction", junctionId: "bad-from" },
      end: { kind: "junction", junctionId: "bad-to" },
      bends: [],
      modes: ["manual"],
    }),
  );
  await openProject(page, project, "angled-wires.icproj.json");
  const route = page.locator('polyline[data-object-id="route-bad"]');
  await expect(route).toHaveAttribute("points", "200,200 260,230");

  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(
    page.getByText("VISUAL_NON_STANDARD_WIRE_ANGLE", { exact: false }),
  ).toHaveCount(0);
  await page.getByTestId("repair-angled-wires").click();
  await expectStatus(page, "Straightened 1 non-standard angled wire segment");
  await expect(route).toHaveAttribute("points", "200,200 260,200 260,230");
  await page.keyboard.press("Control+z");
  await expect(route).toHaveAttribute("points", "200,200 260,230");
});

test("visual observations locate the rear object while ERC findings stay independent", async ({
  page,
}) => {
  const project = createEmptyProject("drawing-review", "Drawing review");
  const document = project.documents[0]!;
  document.instances.push(
    { ...placedInstance("ADC1", "adc", 200, 200), reference: "ADC1" },
    {
      ...placedInstance("ADC2", "adc", 220, 210),
      reference: "ADC2",
      bodyFill: { kind: "background" },
    },
    { ...placedInstance("R1", "resistor", 440, 310), reference: "R1" },
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await openProject(
    page,
    serializeProject(project),
    "drawing-review.icproj.json",
  );
  const issues = page.getByTestId("project-diagnostics");
  async function checkAndReadErc() {
    await clickNetlistWorkflowCommand(page, "check-and-save");
    await page
      .getByTestId("save-sign-in-dialog")
      .getByRole("button", { name: "Not now", exact: true })
      .click();
    await expect(issues).toContainText("ERC_UNCONNECTED_PIN");
    const toggle = page.getByTestId("diagnostic-observations-toggle");
    if (
      (await toggle.count()) &&
      (await toggle.getAttribute("aria-pressed")) !== "true"
    )
      await toggle.click();
    return issues.locator('[data-domain="erc"]').allTextContents();
  }
  const ercBefore = await checkAndReadErc();
  const finding = issues.getByRole("button", {
    name: /ADC2 covers part of ADC1/u,
  });
  await expect(finding).toBeVisible();
  await finding.click();
  await expect(page.getByTestId("hit-ADC1")).toHaveClass(/selected/u);
  await expect(
    page
      .getByTestId("layer-location-outlines")
      .locator('[data-object-id="ADC1"]'),
  ).toBeVisible();
  await page.keyboard.press("Alt+Shift+Home");
  await expect(page.getByTestId("statusbar-issues")).toContainText(
    /out of date|stale/iu,
  );
  expect(await checkAndReadErc()).toEqual(ercBefore);
  await expect(finding).toHaveCount(0);
  await expect(issues).toContainText(/ADC1.*in front of.*ADC2/u);
});

test("selects rear drawing text from an overlap and outlines a covered locked shape", async ({
  page,
}) => {
  const project = createEmptyProject("rear-drawing", "Rear drawing targets");
  const document = project.documents[0]!;
  const textAnchor = { kind: "free" as const, position: { x: 180, y: 160 } };
  document.annotations.push({
    id: "front-label",
    kind: "instance-label",
    content: { runs: [{ kind: "text", value: "Front label" }] },
    anchor: textAnchor,
    alignment: "middle",
    rotation: 0,
    locked: false,
  });
  const center = { x: 310, y: 260 };
  document.drafting = {
    objects: [
      {
        id: "rear-note",
        kind: "text",
        content: { runs: [{ kind: "text", value: "Rear note" }] },
        alignment: "middle",
        rotation: 0,
        anchor: textAnchor,
        zIndex: 0,
        locked: false,
      },
      {
        id: "rear-circle",
        kind: "circle",
        center,
        radius: 10,
        anchor: { kind: "free", position: center },
        lineStyle: "solid",
        zIndex: 1,
        layer: "background",
        locked: true,
      },
      {
        id: "foreground-cover",
        kind: "rectangle",
        center,
        width: 60,
        height: 40,
        rotation: 0,
        anchor: { kind: "free", position: center },
        lineStyle: "solid",
        zIndex: 2,
        layer: "foreground",
        locked: false,
        styleOverride: { fillColor: "#e2d4ad" },
      },
      {
        id: "partial-cover",
        kind: "rectangle",
        center: { x: 200, y: 179 },
        width: 10,
        height: 8,
        rotation: 0,
        anchor: { kind: "free", position: { x: 200, y: 179 } },
        zIndex: 3,
        layer: "foreground",
        locked: false,
        lineStyle: "solid",
        styleOverride: { fillColor: "#e2d4ad" },
      },
    ],
  };
  document.instances = [
    { ...placedInstance("ADC1", "adc", 200, 200), reference: "ADC1" },
  ];
  document.drawingOrder = [
    { kind: "drafting", id: "rear-note" },
    { kind: "drafting", id: "rear-circle" },
    { kind: "electrical" },
    { kind: "instance", id: "ADC1" },
    { kind: "circuit-marks" },
    { kind: "annotation", id: "front-label" },
    { kind: "drafting", id: "foreground-cover" },
    { kind: "drafting", id: "partial-cover" },
  ];
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await openProject(
    page,
    serializeProject(project),
    "rear-drawing.icproj.json",
  );
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await page
    .getByTestId("save-sign-in-dialog")
    .getByRole("button", { name: "Not now", exact: true })
    .click();
  await page.getByTestId("diagnostic-observations-toggle").click();
  const issues = page.getByTestId("project-diagnostics");
  await issues
    .getByRole("button", {
      name: /rectangle partial-cover covers part of ADC1/u,
    })
    .click();
  await expect(
    page
      .getByTestId("layer-location-outlines")
      .locator('[data-object-id="ADC1"]'),
  ).toBeVisible();
  await issues
    .getByRole("button", { name: /Front label is in front of Rear note/u })
    .click();
  await expect(page.getByTestId("drafting-hit-rear-note")).toHaveClass(
    /selected/u,
  );
  await issues
    .getByRole("button", {
      name: /rectangle foreground-cover covers part of circle rear-circle/u,
    })
    .click();
  await expect(
    page
      .getByTestId("layer-location-outlines")
      .locator('[data-drafting-id="rear-circle"]'),
  ).toBeVisible();
});

test("a wire coverage finding frames the covered interval", async ({
  page,
}) => {
  const project = createEmptyProject("wire-coverage", "Wire coverage");
  const document = project.documents[0]!;
  const center = { x: 1240, y: 120 };
  document.drafting = {
    objects: [
      {
        id: "cover",
        kind: "rectangle",
        center,
        width: 20,
        height: 40,
        rotation: 0,
        anchor: { kind: "free", position: center },
        zIndex: 0,
        layer: "foreground",
        locked: false,
        lineStyle: "solid",
        styleOverride: { fillColor: "#e2d4ad" },
      },
    ],
  };
  document.nets = [{ id: "net", terminals: [] }];
  document.junctions = [
    { id: "start", netId: "net", position: { x: 0, y: center.y } },
    { id: "end", netId: "net", position: { x: 1600, y: center.y } },
  ];
  document.routes = [
    createRoutePath({
      id: "wire",
      netId: "net",
      start: { kind: "junction", junctionId: "start" },
      end: { kind: "junction", junctionId: "end" },
      bends: [],
      modes: ["manual"],
    }),
  ];
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 401, json: { error: "unauthorized" } }),
  );
  await openProject(
    page,
    serializeProject(project),
    "wire-coverage.icproj.json",
  );
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await page
    .getByTestId("save-sign-in-dialog")
    .getByRole("button", { name: "Not now", exact: true })
    .click();
  await page.getByTestId("diagnostic-observations-toggle").click();
  await page
    .getByTestId("project-diagnostics")
    .getByRole("button", { name: /rectangle cover covers part of route wire/u })
    .click();
  const canvas = page.getByTestId("schematic-canvas");
  const hit = canvas.getByTestId("route-hit-wire");
  await expect(hit).toHaveClass(/selected/u);
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error("Schematic canvas is not visible");
  await expect
    .poll(async () => {
      const [screen] = await onScreen(canvas, [center] as const);
      return Math.abs(screen.x - (bounds.x + bounds.width / 2));
    })
    .toBeLessThan(bounds.width / 3);
});
