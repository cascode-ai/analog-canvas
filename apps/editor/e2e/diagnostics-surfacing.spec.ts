import { expect, test } from "@playwright/test";
import { createEmptyProject, createRoutePath } from "@icm/model";

import {
  awaitEditorReady,
  chooseComponent,
  clickNetlistWorkflowCommand,
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
  await page.goto("/editor");
  await awaitEditorReady(page);

  // A fresh document rests at a quiet, still-clickable entry point.
  const badge = page.getByTestId("statusbar-issues");
  await expect(badge).toHaveAttribute("data-severity", "none");
  await expect(badge).toHaveText("Not checked");

  // Unfinished drawing produces neither diagnostic counts nor markers.
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 400, y: 240 } });
  await page.keyboard.press("Escape");
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
  await expect(page.getByTestId("status")).toContainText("ERC");

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
  await expect(page.getByTestId("status")).toContainText("ERC_UNCONNECTED_PIN");
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
    await chooseComponent(page, "resistor");
    await page.getByTestId("schematic-canvas").click({ position });
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("statusbar-issues")).toHaveText("Not checked");
  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(page.getByTestId("status")).toContainText("Sign in to save");
  await expect(page.getByTestId("project-diagnostics")).toContainText(
    "ERC_UNCONNECTED_PIN",
  );
  await page.getByTestId("diagnostic-observations-toggle").click();
  await expect(page.getByTestId("project-diagnostics")).toContainText(
    "VISUAL_SYMBOL_OVERLAP",
  );
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
});

test("accepts free angles and optionally straightens them in one undoable action", async ({
  page,
}) => {
  const project = createEmptyProject("angled-wire-project", "Angled wires");
  const document = project.documents[0]!;
  document.nets.push(
    { id: "net-bad", terminals: [] },
    { id: "net-45", terminals: [] },
  );
  document.junctions.push(
    { id: "bad-from", netId: "net-bad", position: { x: 200, y: 200 } },
    { id: "bad-to", netId: "net-bad", position: { x: 260, y: 230 } },
    { id: "diag-from", netId: "net-45", position: { x: 300, y: 200 } },
    { id: "diag-to", netId: "net-45", position: { x: 330, y: 230 } },
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
    createRoutePath({
      id: "route-45",
      netId: "net-45",
      start: { kind: "junction", junctionId: "diag-from" },
      end: { kind: "junction", junctionId: "diag-to" },
      bends: [],
      modes: ["manual"],
    }),
  );

  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("project-file").setInputFiles({
    name: "angled-wires.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(project)),
  });
  const badRoute = page.locator('polyline[data-object-id="route-bad"]');
  const diagonalRoute = page.locator('polyline[data-object-id="route-45"]');
  await expect(badRoute).toHaveAttribute("points", "200,200 260,230");
  await expect(diagonalRoute).toHaveAttribute("points", "300,200 330,230");

  await clickNetlistWorkflowCommand(page, "check-and-save");
  await expect(
    page.getByText("VISUAL_NON_STANDARD_WIRE_ANGLE", { exact: false }),
  ).toHaveCount(0);
  await page.getByTestId("repair-angled-wires").click();
  await expect(page.getByTestId("status")).toContainText(
    "Straightened 1 non-standard angled wire segment",
  );
  await expect(badRoute).toHaveAttribute("points", "200,200 260,200 260,230");
  await expect(diagonalRoute).toHaveAttribute("points", "300,200 330,230");

  await page.keyboard.press("Control+z");
  await expect(badRoute).toHaveAttribute("points", "200,200 260,230");
});
