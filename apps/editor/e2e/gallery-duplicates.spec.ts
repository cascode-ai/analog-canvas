// Duplicate checks: the admin cleanup, the check before publishing and its
// topology comparison, and the durable check across reloads.

import { expect, test } from "./gallery-test.js";
import { readFileSync } from "node:fs";
import { createEmptyProject } from "@icm/model";
import { serializeProject, parseProject } from "@icm/project-protocol";
import { awaitEditorReady, chooseComponent } from "./editor-fixtures.js";
import {
  ENTRY,
  galleryResistorProject,
  mockGallery,
} from "./gallery-fixtures.js";

test("admin checks duplicates and cleans selected copies with partial failure recovery", async ({
  page,
  context,
}) => {
  const project = createEmptyProject("duplicate-fixture", "Circuit");
  const document = project.documents[0]!;
  document.instances = ["R1", "R2"].map((id) => ({
    id,
    reference: id,
    symbolId: "resistor",
    placement: null,
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: { value: "1k" },
    },
  }));
  document.nets = ["1", "2"].map((pinName) => ({
    id: pinName,
    terminals: document.instances.map(({ id }) => ({
      instanceId: id,
      pinName,
    })),
  }));
  const renamed = structuredClone(project);
  renamed.documents[0]!.instances[0]!.reference = "R99";
  const different = structuredClone(project);
  different.documents[0]!.instances[0]!.netlist!.parameters.value = "2k";
  const entries = [
    { ...ENTRY, id: "original", name: "Resistor pair" },
    { ...ENTRY, id: "redrawn", name: "Completely different title" },
    { ...ENTRY, id: "unfinished", name: "Unfinished circuit" },
    {
      ...ENTRY,
      id: "other-original",
      name: "Other original",
      createdAt: "2025-01-01",
    },
    { ...ENTRY, id: "other-copy", name: "Other copy" },
  ];
  const projects = [
    project,
    renamed,
    createEmptyProject("empty", "Empty"),
    different,
    different,
  ];
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "owner-1",
          displayName: "Owner",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  const recycled = new Set<string>();
  const cleanupRequests: Array<{
    keep: { id: string };
    remove: Array<{ id: string }>;
  }> = [];
  let failOtherGroup = true;
  // Context routes also intercept the dedicated worker's fetch requests.
  await context.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/duplicates/recycle") {
      const body = route.request().postDataJSON();
      cleanupRequests.push(body);
      if (failOtherGroup && body.keep.id === "other-original")
        return route.fulfill({
          status: 409,
          json: { error: "duplicate-group-changed" },
        });
      const removed = body.remove.map((entry: { id: string }) => entry.id);
      removed.forEach((id: string) => recycled.add(id));
      return route.fulfill({ json: { kept: body.keep.id, recycled: removed } });
    }
    if (url.pathname.endsWith("preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 60"><path d="M10 30h20l5 -10 10 20 10 -20 10 20 5 -10h20" fill="none" stroke="black"/></svg>',
      });
    if (url.pathname === "/api/gallery") {
      const visible = (
        url.searchParams.has("author") ? [entries[0]!] : entries
      ).filter((entry) => !recycled.has(entry.id));
      return route.fulfill({
        json: {
          entries: visible,
          total: visible.length,
          nextCursor: null,
        },
      });
    }
    if (url.pathname.endsWith("/tags"))
      return route.fulfill({ json: { tags: [] } });
    const index = entries.findIndex((entry) =>
      url.pathname.endsWith(`/${entry.id}`),
    );
    if (index >= 0)
      return route.fulfill({
        json: {
          status: "public",
          entry: entries[index],
          projectText: serializeProject(projects[index]!),
        },
      });
    return route.fulfill({ json: {} });
  });
  await page.goto("/?author=tz");
  await expect(page.getByTestId("gallery-tile-original")).toBeVisible();
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  await expect(sidebar.getByTestId("gallery-check-duplicates")).toBeVisible();
  await expect(sidebar.locator(".gallery-sidebar-admin")).toContainText(
    "Check duplicates",
  );
  await expect(
    page.getByRole("button", {
      name: "Fill missing SKY130 models",
      exact: true,
    }),
  ).toHaveCount(0);
  await page.getByTestId("gallery-check-duplicates").click();
  const panel = page.getByTestId("gallery-duplicates");
  await expect(panel.getByRole("status")).toContainText(
    "Scan finished: 5 checked · 2 extra copies in 2 groups · 1 unable to compare",
  );
  await expect(
    panel.getByRole("link", { name: "Completely different title tz" }),
  ).toHaveAttribute("href", "/g/redrawn");
  await expect(page.getByTestId("gallery-tile-original")).toContainText(
    "Duplicate · group 1",
  );
  await panel.getByText("Unable to compare · 1").click();
  await expect(panel.getByText("No netlist devices to compare")).toBeVisible();
  await expect(
    panel.getByRole("radio", { name: "Keep Resistor pair", exact: true }),
  ).toBeChecked();
  await panel
    .getByRole("radio", {
      name: "Keep Completely different title",
      exact: true,
    })
    .check();
  await page.screenshot({
    path: "plan/gallery-duplicate-cleanup.png",
    fullPage: true,
  });
  await panel
    .getByRole("button", { name: "Remove all extra copies (2)", exact: true })
    .click();
  await expect(
    panel.getByText("Moved 1 circuit to the recycle bin.", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toContainText(
    "changed or no longer match",
  );
  expect(cleanupRequests.map((request) => request.keep.id)).toEqual([
    "redrawn",
    "other-original",
  ]);
  expect([...recycled]).toEqual(["original"]);
  await expect(page.getByTestId("gallery-tile-original")).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: "Open recycle bin" }),
  ).toHaveAttribute("href", "/moderation");
  failOtherGroup = false;
  const remainingGroup = panel
    .locator("details")
    .filter({ hasText: "same netlist" });
  if ((await remainingGroup.getAttribute("open")) === null) {
    await remainingGroup.locator("summary").click();
  }
  await remainingGroup
    .getByRole("button", { name: "Keep selected, remove 1 copy" })
    .click();
  await expect(
    panel.getByText("Moved 2 circuits to the recycle bin.", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(
    panel.getByText("No remaining duplicates", { exact: false }),
  ).toBeVisible();
  expect([...recycled]).toEqual(["original", "other-copy"]);
  await panel.getByRole("button", { name: "Hide results" }).click();
  await expect(
    panel.getByText("No remaining duplicates", { exact: false }),
  ).not.toBeVisible();
});

for (const role of ["user", "moderator"]) {
  test(`duplicate check is hidden for ${role}`, async ({ page }) => {
    await page.route("**/api/auth/me", (route) =>
      route.fulfill({
        json: {
          user:
            role === "visitor"
              ? null
              : {
                  id: "member",
                  displayName: "Member",
                  email: "member@example.com",
                  provider: "github",
                  role,
                  isAdmin: false,
                },
        },
      }),
    );
    await page.route("**/api/gallery**", (route) =>
      route.fulfill({
        json: { entries: [ENTRY], total: 1, tags: [], nextCursor: null },
      }),
    );
    await page.goto("/");
    await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
    await expect(page.getByTestId("gallery-check-duplicates")).toHaveCount(0);
    await expect(
      page.getByRole("button", {
        name: "Fill missing SKY130 models",
        exact: true,
      }),
    ).toHaveCount(0);
  });
}

test("Publish checks exact and nearest duplicates without adding a Gallery control", async ({
  page,
  context,
}) => {
  const entries = [
    { ...ENTRY, id: "nearest", name: "Same topology, other value" },
    { ...ENTRY, id: "exact", name: "Exact resistor pair" },
    { ...ENTRY, id: "partial", name: "Single resistor" },
  ];
  const projects = new Map([
    ["nearest", galleryResistorProject("2k")],
    ["exact", galleryResistorProject()],
    ["partial", galleryResistorProject("1k", 1)],
  ]);
  let releaseScan!: () => void;
  const scanPaused = new Promise<void>((resolve) => {
    releaseScan = resolve;
  });
  let detailRequests = 0;
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "publisher-1",
          displayName: "Publisher",
          email: "publisher@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await context.route("**/api/gallery**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery")
      return route.fulfill({
        json: { entries, nextCursor: null, total: entries.length },
      });
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({ json: { tags: [] } });
    if (url.pathname.endsWith("preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
      });
    const id = url.pathname.split("/").pop()!;
    const project = projects.get(id);
    if (project) {
      detailRequests++;
      await scanPaused;
      return route.fulfill({
        json: {
          status: "public",
          entry: entries.find((entry) => entry.id === id),
          projectText: serializeProject(project),
        },
      });
    }
    return route.fulfill({ status: 404, json: {} });
  });

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "current.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(galleryResistorProject())),
  });
  await expect(page.getByTestId("status")).toContainText("current.icproj.json");
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  await expect(panel.getByTestId("gallery-find-similar")).toHaveCount(0);
  await expect(panel.getByText("Check current topology")).toHaveCount(0);
  await page.getByTestId("examples-toggle").click();

  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  const check = dialog.getByTestId("gallery-find-similar");
  const publish = dialog.getByRole("button", { name: "Publish", exact: true });
  await expect(check).toBeVisible();
  const buttonBox = await check.boundingBox();
  const publishBox = await publish.boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(publishBox).not.toBeNull();
  expect(buttonBox!.height).toBeLessThan(44);
  expect(Math.abs(buttonBox!.y - publishBox!.y)).toBeLessThan(4);

  await check.click();
  await expect.poll(() => detailRequests).toBe(3);
  await expect(check).toBeDisabled();
  // A running check of this Cell explains nothing; Publish simply stays open.
  await expect(dialog.getByTestId("gallery-topology-snapshot")).toHaveCount(0);
  await expect(publish).toBeEnabled();
  await dialog
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByTestId("gallery-topology-task-notice")).toContainText(
    "Checking",
  );
  const otherTab = await context.newPage();
  await otherTab.goto("about:blank");
  await otherTab.bringToFront();
  releaseScan();
  await expect(page.getByTestId("gallery-topology-task-notice")).toContainText(
    "finished",
  );
  await page.bringToFront();
  await otherTab.close();
  await page
    .getByTestId("gallery-topology-task-notice")
    .getByRole("button", { name: "View results" })
    .click();
  const results = dialog.getByTestId("gallery-topology-results");
  await expect(results.getByRole("link")).toHaveCount(3);
  await expect(results.getByRole("link").nth(0)).toContainText(
    "Exact resistor pair",
  );
  await expect(results.locator("article").nth(0)).toContainText(
    "Exact topology match",
  );
  await expect(results.getByRole("link").nth(1)).toContainText(
    "Same topology, other value",
  );
  await expect(results.locator("article").nth(1)).toContainText(
    "Exact topology match",
  );
  await expect(results.getByRole("link").nth(0)).toHaveAttribute(
    "href",
    "/g/exact",
  );
  await expect(results.locator("article").nth(0)).toContainText(
    "including models and parameters",
  );
  await expect(results.locator("article").nth(1)).toContainText(
    "netlist details differ",
  );
  await expect(check).toBeEnabled();
  await expect(check).toHaveText("Check Again");
  await expect(results.locator("article").nth(1)).toContainText("94% match");
  await page.getByTestId("topology-compare-nearest").click();
  const comparison = page.getByRole("dialog", {
    name: "Circuit match comparison",
  });
  await expect(comparison).toBeVisible();
  await expect(comparison.getByTestId("topology-highlight-source")).toHaveCount(
    2,
  );
  await expect(comparison.getByTestId("topology-highlight-target")).toHaveCount(
    2,
  );
  // The comparison includes actual conductors, not just isolated symbol previews.
  await expect(
    comparison
      .locator(
        '[data-testid="topology-comparison-source"] [data-layer="routes"] path',
      )
      .first(),
  ).toBeVisible();
  await comparison.getByTestId("topology-highlight-source").first().click();
  await expect(comparison.getByTestId("topology-highlight-source")).toHaveCount(
    1,
  );
  await expect(comparison.getByTestId("topology-highlight-target")).toHaveCount(
    1,
  );
  const valueRow = comparison.getByRole("row", { name: "value 1k 2k" });
  await expect(valueRow).toBeVisible();
  await comparison
    .getByRole("button", { name: "All matches", exact: true })
    .click();
  await page.screenshot({ path: "plan/topology-comparison.png" });
  await page.keyboard.press("Delete");
  await page.keyboard.press("Escape");
  await expect(comparison).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("instance-count")).toHaveText("2");
  // Editing the live Project and revising a candidate cannot rewrite completed comparisons.
  await dialog
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  projects.set("nearest", galleryResistorProject("99k"));
  await page.getByTestId("project-file").setInputFiles({
    name: "edited.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(galleryResistorProject("9k"))),
  });
  await expect(page.getByTestId("status")).toContainText("edited.icproj.json");
  // Publishing the other Project shows none of the last check's results
  // (#1417); its notice still shows them when asked.
  await page.getByTestId("publish-gallery-button").click();
  await expect(dialog.getByTestId("gallery-topology-snapshot")).toContainText(
    "The last check was for another Project or Cell",
  );
  await expect(page.getByTestId("topology-compare-nearest")).toHaveCount(0);
  await dialog
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  await page
    .getByTestId("gallery-topology-task-notice")
    .getByRole("button", { name: "View results", exact: true })
    .click();
  await expect(dialog.getByTestId("gallery-topology-snapshot")).toContainText(
    "Historical check for another Project or Cell",
  );
  await page.getByTestId("topology-compare-nearest").click();
  await comparison
    .getByRole("button", { name: "R1 ↔ R1", exact: true })
    .click();
  await expect(valueRow).toBeVisible();
  expect(detailRequests).toBe(3);
  await comparison
    .getByRole("button", { name: "Close circuit comparison" })
    .click();
  await page.getByTestId("topology-compare-partial").click();
  await expect(comparison.getByTestId("topology-highlight-source")).toHaveCount(
    1,
  );
  await expect(comparison.getByTestId("topology-highlight-target")).toHaveCount(
    1,
  );
  await expect(comparison).toContainText("1 matched devices");
});

test("topology comparison enters the matched child Cell and shows SKY130 parameter differences", async ({
  page,
  context,
}) => {
  const project = parseProject(
    readFileSync(
      new URL(
        "../src/examples/five-transistor-ota-sky130.icproj.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const candidate = structuredClone(project);
  const transistor = candidate.documents
    .find((doc) => doc.id === "document-ota-5t")!
    .instances.find((item) => item.id === "M1")!;
  transistor.netlist!.parameters.w = "99u";
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "publisher",
          displayName: "Publisher",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await context.route("**/api/gallery**", (route) => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === "/api/gallery")
      return route.fulfill({
        json: { entries: [ENTRY], nextCursor: null, total: 1 },
      });
    if (pathname === "/api/gallery/tags")
      return route.fulfill({ json: { tags: [] } });
    if (pathname.endsWith("preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
    return route.fulfill({
      json: {
        status: "public",
        entry: ENTRY,
        projectText: serializeProject(candidate),
      },
    });
  });
  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "ota.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(project)),
  });
  await expect(page.getByTestId("status")).toContainText("ota.icproj.json");
  await page.getByTestId("publish-gallery-button").click();
  await page.getByTestId("gallery-find-similar").click();
  await page.getByTestId(`topology-compare-${ENTRY.id}`).click();
  const comparison = page.getByRole("dialog", {
    name: "Circuit match comparison",
  });
  await expect(
    comparison.locator(
      '[data-testid="topology-highlight-source"][data-instance-id="XDUT"]',
    ),
  ).toBeVisible();
  await comparison
    .getByRole("button", { name: "XDUT / XM1 ↔ XDUT / XM1", exact: true })
    .click();
  await expect(
    comparison.getByTestId("topology-highlight-source"),
  ).toHaveAttribute("data-instance-id", "M1");
  await expect(
    comparison.getByTestId("topology-highlight-target"),
  ).toHaveAttribute("data-instance-id", "M1");
  await expect(
    comparison.getByRole("row", { name: "w 96u 99u", exact: true }),
  ).toBeVisible();
  await page.screenshot({ path: "plan/topology-ota-comparison.png" });
  await comparison
    .getByRole("button", { name: "All matches", exact: true })
    .click();
  await expect(
    comparison.locator(
      '[data-testid="topology-highlight-source"][data-instance-id="XDUT"]',
    ),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(comparison).toHaveCount(0);
});

test("durable duplicate check reconnects after reload and a closed browser page", async ({
  page,
  context,
}) => {
  let job: {
    id: string;
    revision: number;
    projectText: string;
    running: boolean;
    dismissed: boolean;
    report: {
      scanned: number;
      total: number;
      comparable: number;
      matches: [];
      uncheckable: number;
      complete: boolean;
    };
  } | null = null;
  await context.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "publisher",
          displayName: "Publisher",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  let starts = 0;
  await context.route("**/api/topology-task**", (route) => {
    if (route.request().method() === "POST") {
      starts++;
      const body = route.request().postDataJSON();
      job = {
        id: body.id,
        revision: 1,
        projectText: body.projectText,
        running: true,
        dismissed: false,
        report: {
          scanned: 1,
          total: 7,
          comparable: 1,
          matches: [],
          uncheckable: 0,
          complete: false,
        },
      };
    }
    return route.fulfill({ json: { job } });
  });
  await mockGallery(page, []);
  await page.goto("/editor?new=1");
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 300, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("publish-gallery-button").click();
  await page.getByTestId("gallery-find-similar").click();
  await expect(page.getByTestId("gallery-topology-check")).toContainText(
    "1 / 7",
  );
  const originalText = job!.projectText;
  page.on("dialog", (dialog) => dialog.accept());
  const resumed = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/topology-task" &&
      response.request().method() === "GET",
  );
  await page.reload();
  await awaitEditorReady(page);
  expect(await (await resumed).json()).toMatchObject({
    job: { id: job!.id, report: { scanned: 1 } },
  });
  await expect(page.getByTestId("gallery-topology-task-notice")).toContainText(
    "1 compared",
  );
  expect(starts).toBe(1);
  await page.close();
  // The server finishes while no page exists; reopening merely reads it.
  job = {
    ...job!,
    revision: 2,
    running: false,
    report: { ...job!.report, scanned: 7, comparable: 7, complete: true },
  };
  const reopened = await context.newPage();
  const restored = reopened.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/topology-task" &&
      response.request().method() === "GET",
  );
  await reopened.goto("/editor?new=1");
  await awaitEditorReady(reopened);
  expect(await (await restored).json()).toMatchObject({
    job: { id: job!.id, running: false, report: { scanned: 7 } },
  });
  await expect(
    reopened.getByTestId("gallery-topology-task-notice"),
  ).toContainText("Duplicate check finished");
  await reopened
    .getByRole("button", { name: "View results", exact: true })
    .click();
  await expect(reopened.getByTestId("gallery-topology-check")).toContainText(
    "7 comparable circuits checked",
  );
  expect(job.projectText).toBe(originalText);
  expect(starts).toBe(1);
  await reopened.close();
});
