import { expect, test } from "@playwright/test";

import { chooseComponent } from "./editor-fixtures";

/**
 * Findings must reach the person drawing: the statusbar carries a persistent
 * issues badge fed by the live diagnostic snapshot, and clicking it opens the
 * properties dock with the issues section expanded, where each finding
 * navigates to its object.
 */
test("statusbar issues badge surfaces live findings and opens the workbench", async ({
  page,
}) => {
  await page.goto("/editor");

  // A fresh document rests at a quiet, still-clickable entry point.
  const badge = page.getByTestId("statusbar-issues");
  await expect(badge).toHaveAttribute("data-severity", "none");
  await expect(badge).toHaveText("No issues");

  // A placed component with open pins produces live actionable findings.
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 400, y: 240 } });
  await page.keyboard.press("Escape");
  await expect(badge).toHaveAttribute("data-severity", "warning");
  await expect(badge).toContainText("warning");

  // The badge opens the dock with the issues section expanded.
  await badge.click();
  const issuesSection = page.locator(
    'section[aria-label="Project diagnostics"] details',
  );
  await expect(issuesSection).toHaveAttribute("open", "");
  const findings = page.getByTestId("project-diagnostics").locator("li button");
  await expect(findings.first()).toBeVisible();

  // A finding navigates: the status line reports the ERC jump.
  await findings.first().click();
  await expect(page.getByTestId("status")).toContainText("ERC");
});
