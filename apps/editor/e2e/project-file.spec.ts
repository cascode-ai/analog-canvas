import { expect, test, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CURRENT_PROJECT_SCHEMA_VERSION } from "@icm/model";

import {
  chooseComponent,
  downloadBytes,
  openMenu,
  recoveryProjectTexts,
} from "./editor-fixtures.js";

async function mockCloudProjects(page: Page) {
  let stored: {
    id: string;
    name: string;
    projectText: string;
    updatedAt: string;
    revision: number;
    schemaVersion: number;
  } | null = null;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Circuit Author",
          email: "author@example.com",
          provider: "github",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { projects: stored ? [stored] : [] } });
    }
    const body = route.request().postDataJSON() as {
      name: string;
      projectText: string;
    };
    const parsed = JSON.parse(body.projectText) as { schemaVersion: number };
    stored = {
      id: "cloud-1",
      name: body.name,
      projectText: body.projectText,
      updatedAt: "2026-08-28T10:00:00.000Z",
      revision: 1,
      schemaVersion: parsed.schemaVersion,
    };
    return route.fulfill({ status: 201, json: { project: stored } });
  });
  await page.route("**/api/projects/cloud-1", (route) => {
    if (!stored) return route.fulfill({ status: 404, json: {} });
    if (route.request().method() === "GET") {
      return route.fulfill({ json: { project: stored } });
    }
    const body = route.request().postDataJSON() as {
      name: string;
      projectText: string;
    };
    stored = {
      ...stored,
      name: body.name,
      projectText: body.projectText,
      revision: stored.revision + 1,
      updatedAt: "2026-08-28T10:01:00.000Z",
    };
    return route.fulfill({ json: { project: stored } });
  });
  return { stored: () => stored };
}

test("Cloud Save updates one binding while local export stays interchange", async ({
  page,
}) => {
  const cloud = await mockCloudProjects(page);
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();

  await downloadBytes(page, "File", "Export Project File…");
  await expect(page.getByTestId("project-unsaved-indicator")).toBeVisible();
  await expect(page.getByTestId("status")).toContainText("Export requested");

  const fileMenu = await openMenu(page, "File");
  await expect(
    fileMenu.getByRole("button", { name: "Save as Cloud Copy…" }),
  ).toHaveCount(0);
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("status")).toContainText(
    "Saved New Circuit to Cloud",
  );
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 500, y: 230 } });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+s");
  await expect.poll(() => cloud.stored()?.revision).toBe(2);
  const reopenedMenu = await openMenu(page, "File");
  await expect(reopenedMenu.getByText("Cloud Projects (1/3)")).toBeVisible();
  await expect(
    reopenedMenu.getByRole("button", { name: "Save", exact: true }),
  ).toHaveCount(1);
  const cloudProjectButton = reopenedMenu.getByTestId("cloud-project-cloud-1");
  const cloudProjectTime = cloudProjectButton.locator("time");
  await expect(cloudProjectTime).toBeVisible();
  expect(
    await cloudProjectTime.evaluate(
      (element) => getComputedStyle(element).overflow,
    ),
  ).toBe("hidden");
  const buttonBounds = await cloudProjectButton.boundingBox();
  const timeBounds = await cloudProjectTime.boundingBox();
  expect(buttonBounds).not.toBeNull();
  expect(timeBounds).not.toBeNull();
  expect(timeBounds!.x + timeBounds!.width).toBeLessThanOrEqual(
    buttonBounds!.x + buttonBounds!.width,
  );
  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await page.goto("/editor");
  await expect(page.getByTestId("status")).toContainText(
    "Opened Cloud Project New Circuit",
  );
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("hit-R2")).toHaveCount(1);

  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await page.getByTestId("gallery-new-circuit").click();
  await expect(page).toHaveURL(/\/editor\?new=1$/u);
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
});

test("Gallery navigation uses the replacement decision without a second browser prompt", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByRole("link", { name: "Back to the gallery" }).click();
  const guard = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await expect(guard).toBeVisible();
  await guard.getByRole("button", { name: "Stay" }).click();
  await expect(page).toHaveURL(/\/editor/u);

  await page.getByRole("link", { name: "Back to the gallery" }).click();
  await guard.getByRole("button", { name: "Continue without saving" }).click();
  await expect(page).toHaveURL(/\/$/u);
  await page.goto("/editor");
  await expect(page.getByTestId("startup-recovery-banner")).toHaveCount(0);
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();
});

test("imports and upgrades a portable Project before explicit export", async ({
  page,
}) => {
  const source = JSON.parse(
    readFileSync(
      resolve(process.cwd(), "fixtures/projects/minimal/project.icproj.json"),
      "utf8",
    ),
  ) as Record<string, unknown>;
  const previousVersion = CURRENT_PROJECT_SCHEMA_VERSION - 1;
  source.schemaVersion = previousVersion;
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: `minimal-v${previousVersion}.icproj.json`,
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(source)),
  });
  await expect(page.getByTestId("status")).toContainText(
    `upgraded minimal-v${previousVersion}.icproj.json`,
  );
  const exported = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as { schemaVersion: number };
  expect(exported.schemaVersion).toBe(CURRENT_PROJECT_SCHEMA_VERSION);
});

test("rejects invalid imports without replacing live or recovered work", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("project-file").setInputFiles({
    name: "broken.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from("{ not valid json"),
  });
  await expect(page.getByTestId("status")).toContainText("INVALID_JSON");
  await expect(page.getByTestId("revision")).toHaveText("1");
  await expect
    .poll(() => recoveryProjectTexts(page))
    .toContain('"revision": 1');
});

test("replacement guard offers cancel, discard, and Cloud Save", async ({
  page,
}) => {
  const cloud = await mockCloudProjects(page);
  await page.addInitScript(() => {
    Object.defineProperty(window, "indexedDB", {
      configurable: false,
      get() {
        throw new DOMException("storage blocked", "InvalidStateError");
      },
    });
  });
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");

  const input = page.getByTestId("project-file");
  const replacement = resolve(
    process.cwd(),
    "fixtures/projects/phase-1-manual/project.icproj.json",
  );
  await input.setInputFiles(replacement);
  const dialog = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(page.getByTestId("revision")).toHaveText("1");

  await input.evaluate((element) => ((element as HTMLInputElement).value = ""));
  await input.setInputFiles(replacement);
  await dialog
    .getByRole("button", { name: "Save to Cloud and continue" })
    .click();
  await expect(dialog).toBeHidden();
  expect(cloud.stored()?.projectText).toContain("resistor");
  await expect(page.getByTestId("active-document-name")).toHaveText(
    "Manual Editor Demo",
  );
});

test("discarding a dirty replacement does not leave a second project stack", async ({
  page,
}) => {
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
  let fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "New Project" }).click();
  const dialog = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await dialog.getByRole("button", { name: "Continue without saving" }).click();
  await expect(page.getByTestId("canvas-empty-state")).toBeVisible();
  fileMenu = await openMenu(page, "File");
  await expect(
    fileMenu.getByRole("button", { name: "Previous Project" }),
  ).toHaveCount(0);
  await expect(
    fileMenu.getByRole("button", { name: "Download Backup" }),
  ).toHaveCount(0);
});

test("reverts to the last acknowledged Cloud revision", async ({ page }) => {
  await mockCloudProjects(page);
  await page.goto("/editor");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 320, y: 230 } });
  await page.keyboard.press("Escape");
  let fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByTestId("project-unsaved-indicator")).toHaveCount(0);

  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 500, y: 230 } });
  await page.keyboard.press("Escape");
  fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Revert to Last Saved" }).click();
  await page
    .getByRole("dialog", { name: "Unsaved changes" })
    .getByRole("button", { name: "Continue without saving" })
    .click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await expect(page.getByTestId("hit-R2")).toHaveCount(0);
});

test("the circuit name drives Cloud Save and portable export", async ({
  page,
}) => {
  const cloud = await mockCloudProjects(page);
  await page.goto("/editor");
  const name = page.getByTestId("project-name-input");
  await name.fill("Bandgap Reference");
  await name.press("Enter");
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();
  await expect.poll(() => cloud.stored()?.name).toBe("Bandgap Reference");
  const exported = JSON.parse(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  ) as { name?: string };
  expect(exported.name).toBe("Bandgap Reference");
});
