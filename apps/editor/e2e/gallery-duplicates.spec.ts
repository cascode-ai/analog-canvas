// Duplicate checks: the admin cleanup and the check before publishing with
// its topology comparison. Reconnecting to the durable server check after a
// reload is the gallery-topology-task "durable topology observation" test.

import { expect, test } from "./gallery-test.js";
import type { Page } from "@playwright/test";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import {
  expectStatus,
  openProjectFile,
  exampleProject,
  openProject,
} from "./editor-fixtures.js";
import {
  ENTRY,
  fulfillPreview,
  galleryResistorProject,
  sessionUser,
  signIn,
} from "./gallery-fixtures.js";

/** The SKY130 model fill, which the Gallery sidebar does not offer. */
const fillModels = (page: Page) =>
  page.getByRole("button", { name: "Fill missing SKY130 models", exact: true });

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
    { ...ENTRY, id: "third-copy", name: "Third copy" },
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
    renamed,
    createEmptyProject("empty", "Empty"),
    different,
    different,
  ];
  await signIn(
    context,
    sessionUser({ id: "owner-1", displayName: "Owner", isAdmin: true }),
  );
  const recycled = new Set<string>();
  const cleanupRequests: Array<{
    keep: { id: string };
    remove: Array<{ id: string }>;
  }> = [];
  let failOtherGroup = true;
  let partialFirstGroup = true;
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
      if (partialFirstGroup && body.keep.id === "redrawn") {
        partialFirstGroup = false;
        recycled.add("original");
        return route.fulfill({
          status: 207,
          json: {
            kept: "redrawn",
            recycled: ["original"],
            results: [
              { id: "original", ok: true },
              { id: "third-copy", ok: false, error: "action-unconfirmed" },
            ],
          },
        });
      }
      removed.forEach((id: string) => recycled.add(id));
      return route.fulfill({ json: { kept: body.keep.id, recycled: removed } });
    }
    if (url.pathname.endsWith("preview.svg")) return fulfillPreview(route);
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
  await expect(fillModels(page)).toHaveCount(0);
  await page.getByTestId("gallery-check-duplicates").click();
  const panel = page.getByTestId("gallery-duplicates");
  await expect(panel.getByRole("status")).toContainText(
    "Scan finished: 6 checked · 3 extra copies in 2 groups · 1 unable to compare",
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
  await panel
    .getByRole("button", { name: "Remove all extra copies (3)", exact: true })
    .click();
  await expect(
    panel.getByText("Moved 1 circuit to the recycle bin.", { exact: false }),
  ).toBeVisible();
  await expect(panel).toContainText("changed or no longer match");
  await expect(panel).toContainText(
    "remaining removals could not be confirmed",
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
  await panel
    .getByRole("button", { name: "Remove all extra copies (2)", exact: true })
    .click();
  await expect(
    panel.getByText("Moved 3 circuits to the recycle bin.", { exact: false }),
  ).toBeVisible();
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(
    panel.getByText("No remaining duplicates", { exact: false }),
  ).toBeVisible();
  expect([...recycled]).toEqual(["original", "third-copy", "other-copy"]);
  await panel.getByRole("button", { name: "Hide results" }).click();
  await expect(
    panel.getByText("No remaining duplicates", { exact: false }),
  ).not.toBeVisible();
});

test("duplicate check is hidden for a moderator", async ({ page }) => {
  await signIn(page, sessionUser({ id: "member", role: "moderator" }));
  await page.route("**/api/gallery**", (route) =>
    route.fulfill({
      json: { entries: [ENTRY], total: 1, tags: [], nextCursor: null },
    }),
  );
  await page.goto("/");
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
  await expect(page.getByTestId("gallery-check-duplicates")).toHaveCount(0);
  await expect(fillModels(page)).toHaveCount(0);
});

test("Publish checks exact, nearest and hierarchical duplicates without adding a Gallery control", async ({
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
  await signIn(
    context,
    sessionUser({ id: "publisher-1", displayName: "Publisher" }),
  );
  await context.route("**/api/gallery**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery")
      return route.fulfill({
        json: { entries, nextCursor: null, total: entries.length },
      });
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({ json: { tags: [] } });
    if (url.pathname.endsWith("preview.svg")) return fulfillPreview(route);
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

  await openProject(
    page,
    serializeProject(galleryResistorProject()),
    "current.icproj.json",
  );
  await expectStatus(page, "current.icproj.json");
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
  const links = results.getByRole("link");
  const articles = results.locator("article");
  await expect(links).toHaveCount(3);
  await expect(links.nth(0)).toContainText("Exact resistor pair");
  await expect(articles.nth(0)).toContainText("Exact topology match");
  await expect(links.nth(1)).toContainText("Same topology, other value");
  await expect(articles.nth(1)).toContainText("Exact topology match");
  await expect(links.nth(0)).toHaveAttribute("href", "/g/exact");
  await expect(articles.nth(0)).toContainText(
    "including models and parameters",
  );
  await expect(articles.nth(1)).toContainText("netlist details differ");
  await expect(check).toBeEnabled();
  await expect(check).toHaveText("Check Again");
  await expect(articles.nth(1)).toContainText("94% match");
  await page.getByTestId("topology-compare-nearest").click();
  const comparison = page.getByRole("dialog", {
    name: "Circuit match comparison",
  });
  await expect(comparison).toBeVisible();
  const source = comparison.getByTestId("topology-highlight-source");
  const target = comparison.getByTestId("topology-highlight-target");
  await expect(source).toHaveCount(2);
  await expect(target).toHaveCount(2);
  // The comparison includes actual conductors, not just isolated symbol previews.
  await expect(
    comparison
      .locator(
        '[data-testid="topology-comparison-source"] [data-layer="routes"] path',
      )
      .first(),
  ).toBeVisible();
  await source.first().click();
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);
  const valueRow = comparison.getByRole("row", { name: "value 1k 2k" });
  await expect(valueRow).toBeVisible();
  await comparison
    .getByRole("button", { name: "All matches", exact: true })
    .click();
  await page.keyboard.press("Delete");
  await page.keyboard.press("Escape");
  await expect(comparison).toHaveCount(0);
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("instance-count")).toHaveText("2");
  // A frozen comparison of another Project or Cell, and a revised
  // candidate, are the gallery-topology-check and -match module tests.
  await page.getByTestId("topology-compare-partial").click();
  await expect(source).toHaveCount(1);
  await expect(target).toHaveCount(1);
  await expect(comparison).toContainText("1 matched devices");
  expect(detailRequests).toBe(3);

  // A hierarchical match enters the matched child Cell and shows its SKY130
  // parameter differences.
  const ota = exampleProject("five-transistor-ota-sky130.icproj.json");
  const sized = structuredClone(ota);
  sized.documents
    .find((doc) => doc.id === "document-ota-5t")!
    .instances.find((item) => item.id === "M1")!.netlist!.parameters.w = "99u";
  entries.push({ ...ENTRY, id: "sized-ota", name: "Sized OTA" });
  projects.set("sized-ota", sized);
  await comparison
    .getByRole("button", { name: "Close circuit comparison" })
    .click();
  await dialog
    .getByRole("button", { name: "Cancel", exact: true })
    .first()
    .click();
  await openProjectFile(page, serializeProject(ota), "ota.icproj.json");
  await expectStatus(page, "ota.icproj.json");
  await page.getByTestId("publish-gallery-button").click();
  await check.click();
  await page.getByTestId("topology-compare-sized-ota").click();
  const childInstance = comparison.locator(
    '[data-testid="topology-highlight-source"][data-instance-id="XDUT"]',
  );
  await expect(childInstance).toBeVisible();
  await comparison
    .getByRole("button", { name: "XDUT / XM1 ↔ XDUT / XM1", exact: true })
    .click();
  await expect(source).toHaveAttribute("data-instance-id", "M1");
  await expect(target).toHaveAttribute("data-instance-id", "M1");
  await expect(
    comparison.getByRole("row", { name: "w 96u 99u", exact: true }),
  ).toBeVisible();
  await comparison
    .getByRole("button", { name: "All matches", exact: true })
    .click();
  await expect(childInstance).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(comparison).toHaveCount(0);
});
