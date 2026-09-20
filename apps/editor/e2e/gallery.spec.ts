import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { Locator, Page } from "@playwright/test";

import {
  createEmptyDocument,
  createEmptyProject,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import {
  serializeProject,
  parseProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "@icm/project-protocol";
import { hierarchicalSymbolId } from "@icm/symbols";

import {
  awaitEditorReady,
  chooseComponent,
  openMenu,
} from "./editor-fixtures.js";
import { CLOUD_PROJECT_LIMIT } from "../src/features/editor-shell/cloud-projects";

const ENTRY = {
  id: "g-ring",
  name: "Ring Oscillator",
  author: "tz",
  description: "Three-stage loop",
  createdAt: "2026-08-21T10:00:00.000Z",
  previewRevision: "revision-0",
  previewWidth: 640,
  previewHeight: 360,
  schemaVersion: 23,
};

/** Match the list path with or without filters and a paging cursor. */
const galleryListUrl = (url: URL): boolean => url.pathname === "/api/gallery";

function galleryResistorProject(value = "1k", count = 2) {
  const project = createEmptyProject(`gallery-${value}-${count}`, "Resistors");
  const document = project.documents[0]!;
  document.instances = Array.from({ length: count }, (_, index) => ({
    id: `R${index + 1}`,
    reference: `R${index + 1}`,
    symbolId: "resistor",
    placement: null,
    netlist: {
      binding: { kind: "primitive" as const, deviceClass: "resistor" as const },
      parameters: { value },
    },
  }));
  document.nets = ["1", "2"].map((pinName) => ({
    id: pinName,
    terminals: document.instances.map(({ id }) => ({
      instanceId: id,
      pinName,
    })),
  }));
  return project;
}

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

for (const role of ["visitor", "user", "moderator"]) {
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

function hierarchicalPublishProject() {
  const project = createEmptyProject("hierarchical-publish", "Hierarchical");
  const top = project.documents[0]!;
  const child = createEmptyDocument("document-child", "scdac_unit");
  top.instances = [
    {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "R1",
      netlist: { parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: {
        position: { x: 200, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      reference: "R2",
      netlist: { parameters: {} },
    },
    {
      id: "XU0",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      placement: {
        position: { x: 100, y: 120 },
        rotation: 0,
        mirror: "none",
      },
      reference: "XU0",
      netlist: {
        parameters: {},
        binding: { kind: "subcircuit", childDocumentId: child.id },
      },
    },
  ];
  top.nets = [
    {
      id: "n1",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    },
    {
      id: "n2",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "2" },
      ],
    },
  ];
  project.documents.push(child);
  return project;
}

async function mockGallery(page: Page, entries: object[]): Promise<void> {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries, nextCursor: null } }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}/preview.svg*`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}`, (route) =>
    route.fulfill({
      json: {
        entry: ENTRY,
        projectText: serializeProject(
          createEmptyProject("gallery-ring", ENTRY.name),
        ),
      },
    }),
  );
}

test("Gallery copies SKY130 dependencies with preview, repeat placement and atomic undo", async ({
  page,
}) => {
  const source = parseProject(
    readFileSync(
      "apps/editor/src/examples/simulation-common-source.icproj.json",
      "utf8",
    ),
  );
  const count = source.documents.find((d) => d.id === source.topDocumentId)!
    .instances.length;
  await mockGallery(page, [{ ...ENTRY, tags: ["clock"] }]);
  await page.route(`**/api/gallery/${ENTRY.id}`, (route) =>
    route.fulfill({
      json: { entry: ENTRY, projectText: serializeProject(source) },
    }),
  );
  await page.goto("/editor");
  await awaitEditorReady(page);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  await expect(panel.getByTestId("examples-panel-tag-toggle")).toHaveCount(0);
  const search = panel.getByTestId("examples-panel-search");
  await expect(search).toHaveAttribute("placeholder", "Search Gallery…");
  await search.fill("clock");
  await expect(page.getByTestId(`gallery-example-${ENTRY.id}`)).toBeVisible();
  await search.fill("");
  await page.getByTestId(`gallery-example-${ENTRY.id}`).click();
  const canvas = page.getByTestId("schematic-canvas");
  const box = await canvas.boundingBox();
  if (!box) throw new Error("Canvas is not measurable");
  await page.mouse.move(box.x + 260, box.y + 220);
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("instance-count")).toHaveText("0");
  await page.getByTestId(`gallery-example-${ENTRY.id}`).click();
  await page.mouse.move(box.x + 260, box.y + 220);
  await page.keyboard.press("r");
  await canvas.click({ position: { x: 260, y: 220 } });
  await expect(page.getByTestId("instance-count")).toHaveText(String(count));
  await expect(page.getByTestId("copy-placement-preview")).toBeVisible();
  await canvas.click({ position: { x: 600, y: 380 } });
  await expect(page.getByTestId("instance-count")).toHaveText(
    String(count * 2),
  );
  await page.keyboard.press("Escape");
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText(String(count));
  await page.keyboard.press("Control+z");
  await expect(page.getByTestId("instance-count")).toHaveText("0");
  await page.keyboard.press("Control+Shift+z");
  await expect(page.getByTestId("instance-count")).toHaveText(String(count));
});

test("the editor Gallery finds exact and nearest matches for the current topology", async ({
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
  const check = panel.getByTestId("gallery-find-similar");
  await expect(check).toBeVisible();
  const buttonBox = await check.boundingBox();
  const searchBox = await panel
    .getByTestId("examples-panel-search")
    .boundingBox();
  expect(buttonBox).not.toBeNull();
  expect(searchBox).not.toBeNull();
  expect(buttonBox!.height).toBeLessThan(44);
  expect(buttonBox!.y).toBeLessThan(searchBox!.y);

  await check.click();
  await expect.poll(() => detailRequests).toBe(3);
  await page.getByTestId("project-file").setInputFiles({
    name: "edited.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(galleryResistorProject("1k", 1))),
  });
  await expect(page.getByTestId("status")).toContainText("edited.icproj.json");
  await expect(check).toBeDisabled();
  await expect(panel.getByTestId("gallery-topology-snapshot")).toContainText(
    "Canvas changed",
  );
  await page.getByTestId("examples-toggle").click();
  await page.getByTestId("examples-toggle").click();
  await expect(check).toBeDisabled();
  releaseScan();
  const results = panel.getByTestId("gallery-topology-results");
  await expect(results.getByRole("link")).toHaveCount(3);
  await expect(results.getByRole("link").nth(0)).toContainText(
    "Exact resistor pair",
  );
  await expect(results.getByRole("link").nth(0)).toContainText(
    "Exact topology match",
  );
  await expect(results.getByRole("link").nth(1)).toContainText(
    "Same topology, other value",
  );
  await expect(results.getByRole("link").nth(1)).toContainText(
    "Exact topology match",
  );
  await expect(results.getByRole("link").nth(0)).toHaveAttribute(
    "href",
    "/g/exact",
  );
  await expect(check).toBeEnabled();
  await check.click();
  await expect(results.getByRole("link").first()).toContainText(
    "Single resistor",
  );
  await expect(
    panel.getByTestId("gallery-topology-snapshot"),
  ).not.toContainText("Canvas changed");
});

test("the site lands on the full-screen gallery feed", async ({ page }) => {
  await mockGallery(page, [ENTRY]);
  await page.goto("/");
  const feed = page.getByTestId("gallery-feed");
  await expect(feed).toBeVisible();
  const brand = page.getByTestId("gallery-editor-link");
  await expect(brand).toHaveCSS("display", "flex");
  await expect(brand).toHaveCSS("text-decoration-line", "none");
  const brandMark = brand.locator(".app-brand-mark");
  await expect(brandMark).toBeVisible();
  await expect(brandMark).toHaveCSS("background-image", /icon\.svg/);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute(
    "href",
    "/icon.svg",
  );

  // With community entries present the wall shows them alone: the bundled
  // starter tiles exist only while the gallery is empty.
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img"),
  ).toHaveAttribute("src", `/api/gallery/${ENTRY.id}/preview.svg?v=revision-0`);
  await expect(
    page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img"),
  ).toHaveAttribute("width", "640");
  await expect(
    page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img"),
  ).toHaveAttribute("height", "360");
  await expect(
    page.getByTestId("gallery-bundled-common-source-amplifier"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-new-circuit")).toHaveAttribute(
    "href",
    "/editor?new=1",
  );
});

test("an open Gallery switches to a newly published preview revision", async ({
  page,
}) => {
  let previewRevision = "revision-0";
  let listRequests = 0;
  await page.route(galleryListUrl, (route) => {
    listRequests += 1;
    return route.fulfill({
      json: {
        entries: [{ ...ENTRY, previewRevision }],
        nextCursor: null,
      },
    });
  });
  await page.route(`**/api/gallery/${ENTRY.id}/preview.svg*`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>',
    }),
  );

  await page.goto("/");
  const image = page.getByTestId(`gallery-tile-${ENTRY.id}`).locator("img");
  await expect(image).toHaveAttribute(
    "src",
    `/api/gallery/${ENTRY.id}/preview.svg?v=revision-0`,
  );

  previewRevision = "revision-1";
  await page.evaluate(() => {
    const channel = new BroadcastChannel("analog-canvas-gallery-change-v1");
    channel.postMessage({
      type: "gallery-changed",
      sourceId: "editor-tab",
      entryId: "g-ring",
      previewRevision: "revision-1",
    });
    channel.close();
  });

  await expect(image).toHaveAttribute(
    "src",
    `/api/gallery/${ENTRY.id}/preview.svg?v=revision-1`,
  );
  expect(listRequests).toBeGreaterThanOrEqual(2);
});

test("the Owner rejects a Gallery entry with an author-visible reason", async ({
  page,
}) => {
  let sessionRequests = 0;
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await page.route("**/api/auth/me", (route) => {
    sessionRequests += 1;
    return route.fulfill({
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
    });
  });
  await mockGallery(page, [ENTRY]);
  let rejectReason = "";
  await page.route(`**/api/gallery/${ENTRY.id}/reject`, async (route) => {
    rejectReason = (route.request().postDataJSON() as { reason: string })
      .reason;
    await route.fulfill({ json: { id: ENTRY.id, status: "rejected" } });
  });

  await page.goto("/");
  const menu = page.getByTestId(`gallery-owner-menu-${ENTRY.id}`);
  await expect(menu).toBeVisible();
  expect(sessionRequests).toBe(1);
  await menu.locator("summary").click();
  await expect(
    page.getByTestId(`gallery-owner-edit-${ENTRY.id}`),
  ).toHaveAttribute("href", `/g/${ENTRY.id}`);
  await menu.locator("summary").click();

  // Rejection is a direct card action, beside the management menu.
  await page.getByTestId(`gallery-owner-reject-${ENTRY.id}`).click();
  await expect(page.getByTestId("gallery-owner-reject-confirm")).toBeDisabled();
  for (const reason of [
    "too ugly",
    "circuit incorrect",
    "too simple",
    "duplicate",
  ]) {
    await expect(
      page.getByTestId(
        `gallery-owner-reject-option-${reason.replace(/\s/gu, "-")}`,
      ),
    ).toBeVisible();
  }
  // A free-form other reason is independently sufficient.
  await page.getByTestId("gallery-owner-reject-note").fill("Other reason");
  await expect(page.getByTestId("gallery-owner-reject-confirm")).toBeEnabled();
  await page.getByTestId("gallery-owner-reject-note").fill("");
  await expect(page.getByTestId("gallery-owner-reject-confirm")).toBeDisabled();

  await page.getByTestId("gallery-owner-reject-option-too-ugly").check();
  await page
    .getByTestId("gallery-owner-reject-option-circuit-incorrect")
    .check();
  await expect(page.getByTestId("gallery-owner-reject-confirm")).toBeEnabled();
  await page
    .getByTestId("gallery-owner-reject-note")
    .fill("Label the ports and remove the loose wire.");
  await page.getByTestId("gallery-owner-reject-confirm").click();

  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toHaveCount(0);
  await expect(page.getByTestId("gallery-owner-notice")).toContainText(
    "rejected",
  );
  expect(rejectReason).toBe(
    "too ugly; circuit incorrect — Note: Label the ports and remove the loose wire.",
  );
});

test("the Owner withdraws a Gallery entry into the recycle bin", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
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
  await mockGallery(page, [ENTRY]);
  let withdrawn = 0;
  await page.route(`**/api/gallery/${ENTRY.id}/recycle`, (route) => {
    withdrawn += 1;
    return route.fulfill({ json: { id: ENTRY.id, status: "recycled" } });
  });

  await page.goto("/");
  await page
    .getByTestId(`gallery-owner-menu-${ENTRY.id}`)
    .locator("summary")
    .click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId(`gallery-owner-withdraw-${ENTRY.id}`).click();

  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toHaveCount(0);
  await expect(page.getByTestId("gallery-owner-notice")).toContainText(
    "recycle bin",
  );
  expect(withdrawn).toBe(1);
});

test("masonry places the top row left-to-right in distinct columns", async ({
  page,
}) => {
  const entries = ["m-a", "m-b", "m-c"].map((id, index) => ({
    id,
    name: `Circuit ${id}`,
    author: "tz",
    description: index === 0 ? "taller card" : "",
    createdAt: "2026-08-22T10:00:00.000Z",
    schemaVersion: 23,
  }));
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries, nextCursor: null } }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-m-c")).toBeVisible();
  const positions = await page.locator(".masonry-item").evaluateAll((items) =>
    items.map((item) => {
      const match = /translate\(([-\d.]+)px, ([-\d.]+)px\)/u.exec(
        (item as HTMLElement).style.transform,
      );
      return { x: Number(match?.[1]), y: Number(match?.[2]) };
    }),
  );
  expect(positions).toHaveLength(3);
  // All three fit the top row: same y, strictly increasing x (reading
  // order), and the container has a measured height.
  expect(positions.every((position) => position.y === 0)).toBe(true);
  expect(positions[1]!.x).toBeGreaterThan(positions[0]!.x);
  expect(positions[2]!.x).toBeGreaterThan(positions[1]!.x);
  const wallHeight = await page
    .locator(".masonry")
    .evaluate((wall) => Number.parseFloat((wall as HTMLElement).style.height));
  expect(wallHeight).toBeGreaterThan(100);
});

test("the feed pages through the cursor as the sentinel comes into view", async ({
  page,
}) => {
  const listRequests: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    listRequests.push(url.search);
    const second = url.searchParams.get("cursor") === "c1";
    const ids = second ? ["p2-a", "p2-b"] : ["p1-a", "p1-b", "p1-c"];
    return route.fulfill({
      json: {
        entries: ids.map((id) => ({
          id,
          name: `Circuit ${id}`,
          author: "tz",
          description: "",
          createdAt: "2026-08-22T10:00:00.000Z",
          schemaVersion: 23,
        })),
        nextCursor: second ? null : "c1",
      },
    });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-p1-a")).toBeVisible();
  // The short first page leaves the sentinel visible, so page two loads
  // without any user scrolling and the cursor chain ends. (StrictMode
  // double-mounts the initial effect in dev, so the plain request may
  // fire twice; the cursor page must load exactly once.)
  await expect(page.getByTestId("gallery-tile-p2-b")).toBeVisible();
  const cursors = listRequests.map((query) =>
    new URLSearchParams(query).get("cursor"),
  );
  expect(cursors.filter((cursor) => cursor === "c1")).toHaveLength(1);
  expect(cursors.every((cursor) => cursor === null || cursor === "c1")).toBe(
    true,
  );
  expect(
    listRequests.every(
      (query) => new URLSearchParams(query).get("seed") === null,
    ),
  ).toBe(true);
});

test("the feed scrolls inside its shell despite the locked app root", async ({
  page,
}) => {
  await page.setViewportSize({ width: 520, height: 420 });
  const entries = Array.from({ length: 8 }, (_, index) => ({
    id: `s-${index}`,
    name: `Circuit ${index}`,
    author: "tz",
    description: "",
    createdAt: "2026-08-22T10:00:00.000Z",
    schemaVersion: 23,
  }));
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries, nextCursor: null } }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 8"><rect width="10" height="8" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-s-0")).toBeVisible();
  const scrolled = await page.locator(".gallery-shell").evaluate((shell) => {
    shell.scrollTop = 9999;
    return {
      overflowY: getComputedStyle(shell).overflowY,
      scrollable: shell.scrollHeight > shell.clientHeight,
      scrollTop: shell.scrollTop,
    };
  });
  expect(scrolled.overflowY).toBe("auto");
  expect(scrolled.scrollable).toBe(true);
  expect(scrolled.scrollTop).toBeGreaterThan(0);
});

test("clicking a byline filters the wall to that author, clearable", async ({
  page,
}) => {
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    const alice = url.searchParams.get("author") === "alice";
    const entries = [
      {
        id: "f-alice",
        name: "Alice's OTA",
        author: "alice",
        description: "",
        createdAt: "2026-08-22T10:00:00.000Z",
        schemaVersion: 23,
      },
      ...(alice
        ? []
        : [
            {
              id: "f-bob",
              name: "Bob's Mixer",
              author: "bob",
              description: "",
              createdAt: "2026-08-22T09:00:00.000Z",
              schemaVersion: 23,
            },
          ]),
    ];
    return route.fulfill({ json: { entries, nextCursor: null } });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-f-bob")).toBeVisible();
  await page.getByTestId("gallery-author-f-alice").click();
  await expect(page.getByTestId("gallery-filter")).toContainText(
    "Circuits by alice",
  );
  await expect(page.getByTestId("gallery-tile-f-bob")).toHaveCount(0);
  await expect(page).toHaveURL(/\?author=alice$/);
  await page.getByTestId("gallery-filter-clear").click();
  await expect(page.getByTestId("gallery-tile-f-bob")).toBeVisible();
  await expect(page).not.toHaveURL(/author=/);
});

test("narrows the wall by netlist mark and by the reader's own likes", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u-reader",
          displayName: "Reader",
          email: "reader@example.com",
          provider: "github",
          role: "user",
        },
      },
    }),
  );
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    const tile = (
      id: string,
      name: string,
      netlistable: boolean,
      liked: boolean,
    ) => ({
      id,
      name,
      author: "reader",
      description: "",
      createdAt: "2026-08-22T10:00:00.000Z",
      schemaVersion: 23,
      netlistable,
      likes: liked ? 1 : 0,
      likedByViewer: liked,
    });
    const all = [
      tile("f-ready", "Extractable", true, false),
      tile("f-sketch", "Sketch", false, true),
    ];
    const entries = all.filter(
      (entry) =>
        (url.searchParams.get("netlistable") !== "1" || entry.netlistable) &&
        (url.searchParams.get("liked") !== "1" || entry.likedByViewer),
    );
    return route.fulfill({ json: { entries, nextCursor: null } });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-f-sketch")).toBeVisible();

  await page.getByTestId("gallery-filter-netlistable").click();
  await expect(page.getByTestId("gallery-tile-f-ready")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-f-sketch")).toHaveCount(0);
  await expect(page).toHaveURL(/netlist=1/u);

  // The two marks compose, and here nothing carries both: the wall says which
  // choice emptied it rather than reading as an empty Gallery.
  await page.getByTestId("gallery-filter-liked").click();
  await expect(page.getByTestId("gallery-mark-empty")).toBeVisible();

  await page.getByTestId("gallery-filter-netlistable").click();
  await expect(page.getByTestId("gallery-tile-f-sketch")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-f-ready")).toHaveCount(0);
});

test("keeps the reader's filter when they leave the wall and come back", async ({
  page,
}) => {
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    const alice = url.searchParams.get("author") === "alice";
    const entries = [
      {
        id: "p-alice",
        name: "Alice's OTA",
        author: "alice",
        description: "",
        createdAt: "2026-08-22T10:00:00.000Z",
        schemaVersion: 23,
      },
      ...(alice
        ? []
        : [
            {
              id: "p-bob",
              name: "Bob's Mixer",
              author: "bob",
              description: "",
              createdAt: "2026-08-22T09:00:00.000Z",
              schemaVersion: 23,
            },
          ]),
    ];
    return route.fulfill({ json: { entries, nextCursor: null } });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await page.getByTestId("gallery-author-p-alice").click();
  await expect(page.getByTestId("gallery-tile-p-bob")).toHaveCount(0);
  await expect(page).toHaveURL(/author=alice/u);

  // Opening a circuit and returning to the bare address is the common way
  // back; the wall must still be the slice the reader chose.
  await page.goto("/");
  await expect(page.getByTestId("gallery-filter")).toContainText(
    "Circuits by alice",
  );
  await expect(page.getByTestId("gallery-tile-p-bob")).toHaveCount(0);
  await expect(page).toHaveURL(/author=alice/u);

  // And clearing it is remembered just as well, so the wall cannot creep back
  // to a filter the reader switched off.
  await page.getByTestId("gallery-filter-clear").click();
  await expect(page.getByTestId("gallery-tile-p-bob")).toBeVisible();
  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-p-bob")).toBeVisible();
  await expect(page).not.toHaveURL(/author=/u);
});

test("the account chip sits on the header line and ellipsizes a long name", async ({
  page,
}) => {
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: false } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Zhishuai Zhang",
          email: "z@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      return route.fulfill({ json: { tags: [] } });
    }
    if (url.pathname !== "/api/gallery") return route.fallback();
    return route.fulfill({ json: { entries: [], nextCursor: null } });
  });

  await page.setViewportSize({ width: 760, height: 720 });
  await page.goto("/");
  const chip = page.getByTestId("account-name");
  await expect(chip).toBeVisible();

  // The name rides the same centre line as every other control in the row.
  // Zeroed vertical padding is what puts it there: the chip opts out of the
  // row's shared control rule so its ellipsis works, and that rule was also
  // what kept its line box the full height of the control.
  const centred = await chip.evaluate((element) => {
    const box = element.getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(element);
    const text = range.getBoundingClientRect();
    return text.top + text.height / 2 - (box.top + box.height / 2);
  });
  expect(Math.abs(centred)).toBeLessThanOrEqual(1);

  const newCircuit = page.getByTestId("gallery-new-circuit");
  const chipBox = (await chip.boundingBox())!;
  const buttonBox = (await newCircuit.boundingBox())!;
  expect(
    Math.abs(
      chipBox.y + chipBox.height / 2 - (buttonBox.y + buttonBox.height / 2),
    ),
  ).toBeLessThanOrEqual(1);

  // An ordinary two-part name fits whole at this width.
  expect(
    await chip.evaluate(
      (element) => element.scrollWidth <= element.clientWidth,
    ),
  ).toBe(true);

  // A name that cannot fit ends in an ellipsis rather than a sliced letter,
  // which only holds while the chip is not a flex container.
  const overflowing = await chip.evaluate((element) => {
    element.textContent = "A Considerably Longer Display Name";
    const style = getComputedStyle(element);
    return {
      clipped: element.scrollWidth > element.clientWidth,
      textOverflow: style.textOverflow,
      display: style.display,
    };
  });
  expect(overflowing.clipped).toBe(true);
  expect(overflowing.textOverflow).toBe("ellipsis");
  expect(overflowing.display).not.toContain("flex");
});

test("the left sidebar hosts overall search and grouped tags at desktop, half-screen and mobile widths", async ({
  page,
}) => {
  // Enough tags that the row would wrap over several lines unfiltered, which
  // is what pushed the wall itself below the fold.
  const tags = [
    "amplifier",
    "oscillator",
    "comparator",
    "dcdc",
    "power",
    "differential",
    "ota",
    "pll",
    "vtc",
    "adc",
    "bandgap",
    "cmfb",
    "current mirror",
    "ldo",
  ];
  let tagRequestCount = 0;
  let galleryRequestCount = 0;
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      tagRequestCount += 1;
      return route.fulfill({
        json: {
          tags: tags.map((tag, index) => ({ tag, count: index + 1 })),
          groups: [{ group: "Buffers", count: 23 }],
        },
      });
    }
    if (url.pathname !== "/api/gallery") return route.fallback();
    galleryRequestCount += 1;
    return route.fulfill({
      json: {
        entries: [
          {
            id: "t-one",
            name: "Circuit",
            author: "tz",
            description: "",
            createdAt: "2026-08-22T10:00:00.000Z",
            schemaVersion: 23,
            tags: ["ldo"],
          },
        ],
        nextCursor: null,
      },
    });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  const tile = page.getByTestId("gallery-tile-t-one");
  await expect(sidebar).toBeVisible();
  await expect.poll(() => tagRequestCount).toBe(1);
  await expect.poll(() => galleryRequestCount).toBe(1);
  await expect(page.getByText("Browse", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Categories", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Tagged circuits", { exact: true })).toHaveCount(
    0,
  );
  expect(
    await sidebar
      .locator(".gallery-tag-group > summary")
      .evaluateAll((items) =>
        items.map((item) => item.firstChild?.textContent?.trim()),
      ),
  ).toEqual([
    "Amplifiers",
    "Bias & references",
    "Buffers",
    "Clock & timing",
    "Computing",
    "Conversion",
    "Custom & legacy",
    "Design Attributes",
    "Devices & models",
    "Filters",
    "Logic & memory",
    "Power",
    "RF & communications",
    "Sampling",
    "Sensors",
  ]);
  const amplifierGroup = sidebar
    .locator("summary")
    .filter({ hasText: "Amplifiers" });
  await expect(
    sidebar.locator("summary").filter({ hasText: "Buffers" }).locator("span"),
  ).toHaveText("23");
  await expect(amplifierGroup).toBeVisible();
  await expect(amplifierGroup).toHaveCSS("font-weight", "600");
  await amplifierGroup.click();
  const amplifier = page.getByTestId("gallery-tag-option-amplifier");
  await expect(amplifier).toContainText("General Amplifier");
  expect((await amplifier.boundingBox())!.height).toBeLessThanOrEqual(28);
  const sidebarRhythm = await amplifierGroup.evaluate((summary) => {
    const group = summary.parentElement!;
    const items = [
      ...group.querySelectorAll<HTMLElement>(".gallery-sidebar-tag"),
    ];
    const summaryStyle = getComputedStyle(summary);
    const itemStyle = getComputedStyle(items[0]!);
    const first = items[0]!.getBoundingClientRect();
    const second = items[1]!.getBoundingClientRect();
    return {
      fontMatches: summaryStyle.fontFamily === itemStyle.fontFamily,
      colorMatches: summaryStyle.color === itemStyle.color,
      summaryFontSize: summaryStyle.fontSize,
      summaryFontWeight: summaryStyle.fontWeight,
      summaryPaddingBlock: [
        summaryStyle.paddingTop,
        summaryStyle.paddingBottom,
      ],
      groupMarginBottom: getComputedStyle(group).marginBottom,
      itemGap: second.top - first.bottom,
    };
  });
  expect(sidebarRhythm).toEqual({
    fontMatches: true,
    colorMatches: true,
    summaryFontSize: "12px",
    summaryFontWeight: "600",
    summaryPaddingBlock: ["6px", "6px"],
    groupMarginBottom: "4px",
    itemGap: 2,
  });
  const search = page.getByTestId("gallery-search");
  await expect(search).toHaveCount(1);
  await expect(page.getByTestId("gallery-tag-search")).toHaveCount(0);
  await sidebar.locator("summary").filter({ hasText: "Conversion" }).click();
  await expect(page.getByTestId("gallery-tag-option-adc")).toContainText("ADC");
  const logicGroup = page.getByTestId("gallery-tag-option-and").locator("..");
  await logicGroup.locator("summary").click();
  await expect(
    logicGroup
      .locator(".gallery-tag-name")
      .evaluateAll((items) => items.map((item) => item.textContent)),
  ).resolves.toEqual([
    "AND",
    "CML",
    "D Flip Flop",
    "D Latch",
    "DRAM",
    "Flip Flop",
    "Inverter",
    "Latch",
    "Level Shifter",
    "Logic",
    "Memory Cell",
    "Multiplexer",
    "NAND",
    "NOR",
    "OR",
    "Sense Amplifier",
    "SRAM",
    "TSPC",
    "XOR",
  ]);
  await sidebar
    .locator("summary")
    .filter({ hasText: /^Power/ })
    .click();
  const ldo = page.getByTestId("gallery-tag-option-ldo");
  await expect(ldo).toHaveCount(1);
  await ldo.scrollIntoViewIfNeeded();
  await expect(ldo).toBeVisible();
  expect(
    (await sidebar.boundingBox())!.x + (await sidebar.boundingBox())!.width,
  ).toBeLessThan((await tile.boundingBox())!.x);

  await search.fill("ld");
  await expect(page.getByTestId("gallery-tag-option-ldo")).toBeVisible();
  await expect(page.getByTestId("gallery-tag-option-amplifier")).toBeVisible();
  // The overall search narrows circuits without mutating tag navigation.
  await expect(search).toHaveValue("ld");
  await expect(tile).toBeVisible();
  await page.getByTestId("gallery-tag-option-ldo").click();
  await search.fill("osc");
  await expect(page.getByTestId("gallery-tag-option-ldo")).toBeVisible();
  await expect(page.getByTestId("gallery-tags-clear")).toContainText(
    "Clear 1 selected",
  );
  await expect(page).toHaveURL(/tags=ldo/);
  await search.fill("");
  await expect(tile).toBeVisible();

  await page.setViewportSize({ width: 800, height: 800 });
  await expect(sidebar).toBeVisible();
  // The ResizeObserver adapts the column after the viewport change; wait for
  // that layout pass before comparing the two columns.
  await expect
    .poll(async () => {
      const sidebarBox = await page
        .locator(".gallery-sidebar-slot")
        .boundingBox();
      const tileBox = await tile.boundingBox();
      return sidebarBox && tileBox
        ? sidebarBox.x + sidebarBox.width < tileBox.x
        : false;
    })
    .toBe(true);
  await expect(page.locator(".gallery-main")).toHaveJSProperty(
    "scrollWidth",
    await page
      .locator(".gallery-main")
      .evaluate((element) => element.clientWidth),
  );
  await page.screenshot({ path: "plan/gallery-sidebar-half.png" });

  await page.setViewportSize({ width: 390, height: 844 });
  await expect(sidebar).toBeHidden();
  await page.getByRole("button", { name: "Search & filters" }).click();
  await expect(sidebar).toBeVisible();
  await page.getByTestId("gallery-tags-clear").click();
  await expect(page.getByTestId("gallery-tag-option-ldo")).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await page.getByRole("button", { name: "Search & filters" }).click();
  await expect(sidebar).toBeHidden();
  await expect(tile).toBeVisible();
  await page.getByTestId("gallery-search").fill("zzz");
  await expect(page.getByTestId("gallery-search-empty")).toBeVisible();
});

test("the tag sidebar resizes by dragging and keyboard, remembers width and adapts to narrow windows", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: [ENTRY], nextCursor: null, total: 1 } }),
  );
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [{ tag: "amplifier", count: 1 }] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
    }),
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/");
  // Invalid saved settings must not break the layout or disable resizing.
  await page.evaluate(() =>
    localStorage.setItem("icm.gallery.sidebarWidth", "invalid"),
  );
  await page.reload();
  const handle = page.getByRole("separator", {
    name: "Resize Gallery filters",
  });
  const slot = page.locator(".gallery-sidebar-slot");
  const expectWidth = async (width: number) => {
    await expect(handle).toHaveAttribute("aria-valuenow", String(width));
    await expect
      .poll(async () => (await slot.boundingBox())?.width)
      .toBe(width);
  };
  const drag = async (delta: number) => {
    const bounds = (await handle.boundingBox())!;
    const x = bounds.x + bounds.width / 2;
    await page.mouse.move(x, bounds.y + 30);
    await page.mouse.down();
    await page.mouse.move(x + delta, bounds.y + 100, { steps: 5 });
    await page.mouse.up();
  };
  await expectWidth(238);
  await expect(handle).toHaveCSS("cursor", "col-resize");
  await drag(110);
  await expectWidth(348);
  await page.reload();
  await expectWidth(348);
  await drag(-80);
  await expectWidth(268);
  // Releasing away from the edge must terminate the captured drag.
  await page.mouse.move(700, 500);
  await expectWidth(268);
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  await expectWidth(276);
  await page.keyboard.press("Home");
  await expectWidth(180);
  await drag(-100);
  await expectWidth(180);
  await drag(700);
  await expectWidth(420);
  await page.setViewportSize({ width: 800, height: 800 });
  await expectWidth(360);
  await expect(page.locator(".gallery-main")).toHaveJSProperty(
    "scrollWidth",
    await page
      .locator(".gallery-main")
      .evaluate((element) => element.clientWidth),
  );
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(handle).toBeHidden();
  await page.getByRole("button", { name: "Search & filters" }).click();
  await expect(page.getByTestId("gallery-tag-sidebar")).toBeVisible();
  // Mobile filters fill their container instead of keeping the desktop width.
  expect((await slot.boundingBox())!.width).toBe(
    (await page.locator(".gallery-browser").boundingBox())!.width,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await expectWidth(420);
  await page.reload();
  await expectWidth(420);
});

test("the search box reaches metadata and tolerates small typos", async ({
  page,
}) => {
  const walled = [
    {
      id: "s1",
      name: "Ring Oscillator",
      author: "mei",
      description: "Three-stage loop",
      createdAt: "2026-08-21T10:00:00.000Z",
      schemaVersion: 23,
      tags: ["amplifier"],
    },
    {
      id: "s2",
      name: "Folded Cascode",
      author: "arash",
      description: "",
      createdAt: "2026-08-20T10:00:00.000Z",
      schemaVersion: 23,
      tags: [],
    },
  ];
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: walled, nextCursor: null, total: 2 } }),
  );
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [{ tag: "amplifier", count: 1 }] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );
  await page.goto("/");

  const box = page.getByTestId("gallery-search");
  await expect(
    page.locator(".gallery-sidebar-slot").getByTestId("gallery-search"),
  ).toBeVisible();
  await expect(
    page.getByTestId("gallery-tag-sidebar").getByTestId("gallery-search"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-tag-search")).toHaveCount(0);
  await expect(box).toHaveAttribute("placeholder", "Name, author, tag…");
  await expect(box).toHaveAttribute("aria-label", "Search circuits");

  await box.fill("mei");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-s2")).toHaveCount(0);
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "2 circuits · 1 match",
  );

  await box.fill("cascode");
  await expect(page.getByTestId("gallery-tile-s2")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-s1")).toHaveCount(0);

  await box.fill("three-stage");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();

  await box.fill("stgae");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();

  await box.fill("zzz");
  await expect(page.getByTestId("gallery-tile-s1")).toHaveCount(0);
  await expect(page.getByTestId("gallery-search-empty")).toHaveText(
    "No circuits match “zzz”.",
  );
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "2 circuits · 0 matches",
  );

  await box.fill("");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-s2")).toBeVisible();
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "2 circuits",
  );
});

test("an unfinished feed says it is still searching, not that nothing matches", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) => {
    const url = new URL(route.request().url());
    if (url.searchParams.get("cursor")) {
      // Hold the tail of the feed open: the fetch never resolves, so the
      // feed stays legitimately incomplete for the whole assertion window.
      return;
    }
    return route.fulfill({
      json: {
        entries: [
          {
            id: "s1",
            name: "Ring Oscillator",
            author: "mei",
            description: "",
            createdAt: "2026-08-21T10:00:00.000Z",
            schemaVersion: 23,
          },
        ],
        nextCursor: "2026-08-20T00:00:00.000Z|older",
        total: 40,
      },
    });
  });
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );
  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-s1")).toBeVisible();

  await page.getByTestId("gallery-search").fill("zzz");
  await expect(page.getByTestId("gallery-search-pending")).toHaveText(
    "No matches yet — searching older circuits…",
  );
  await expect(page.getByTestId("gallery-search-empty")).toHaveCount(0);
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "40 circuits · 0 matches so far",
  );
});

test("the wall states how many circuits the gallery holds", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: [ENTRY], nextCursor: null, total: 128 } }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}/preview.svg*`, (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/projects", (route) =>
    route.fulfill({ status: 401, json: { error: "authentication-required" } }),
  );
  await page.goto("/");
  await expect(page.getByTestId("gallery-count-panel")).toHaveText(
    "128 circuits",
  );
  // The shelf states its own count; the community total stays off it.
  await page.getByTestId("gallery-view-shelf").click();
  await expect(page.getByTestId("gallery-count-panel")).toHaveCount(0);
  await expect(page.getByTestId("shelf-signed-out")).toBeVisible();
});

test("the wall count opens a contributor ranking whose names open each gallery", async ({
  page,
}) => {
  const aliceEntries = [
    {
      ...ENTRY,
      id: "alice-2",
      name: "Alice OTA",
      author: "Alice",
      createdAt: "2026-08-22T10:00:00.000Z",
    },
    {
      ...ENTRY,
      id: "alice-1",
      name: "Alice Bandgap",
      author: "Alice",
    },
  ];
  const bobEntry = {
    ...ENTRY,
    id: "bob-1",
    name: "Bob Comparator",
    author: "Bob",
  };
  await page.route(galleryListUrl, (route) => {
    const url = new URL(route.request().url());
    const entries =
      url.searchParams.get("author") === "Alice"
        ? aliceEntries
        : [...aliceEntries, bobEntry];
    return route.fulfill({
      json: { entries, nextCursor: null, total: entries.length },
    });
  });
  await page.route("**/api/gallery/authors", (route) =>
    route.fulfill({
      json: {
        authors: [
          { author: "Alice", count: 2 },
          { author: "Bob", count: 1 },
        ],
      },
    }),
  );
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.route("**/api/gallery/*/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await page.getByTestId("gallery-count-panel").click();
  await expect(page.getByTestId("gallery-contributor-popover")).toContainText(
    "2 authors",
  );
  await expect(page.getByTestId("gallery-contributor-row-1")).toContainText(
    "Alice",
  );
  await expect(page.getByTestId("gallery-contributor-row-1")).toContainText(
    "2 circuits",
  );
  await expect(page.getByTestId("gallery-contributor-row-2")).toContainText(
    "Bob",
  );

  await expect(
    page.getByTestId("gallery-contributor-row-1").locator("summary"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-contributor-view-1")).toHaveCount(0);
  await page.getByTestId("gallery-contributor-author-1").click();

  await expect(page).toHaveURL(/\?author=Alice$/u);
  await expect(page.getByTestId("gallery-filter")).toContainText(
    "Circuits by Alice",
  );
  await expect(page.getByTestId("gallery-tile-alice-2")).toBeVisible();
  await expect(page.getByTestId("gallery-tile-bob-1")).toHaveCount(0);
});

test("an API without totals hides the count rather than guessing", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery/tags", (route) =>
    route.fulfill({ json: { tags: [] } }),
  );
  await page.goto("/");
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
  await expect(page.getByTestId("gallery-count-panel")).toHaveCount(0);
});

test("the tag menu multi-selects and tile tags join the selection", async ({
  page,
}) => {
  const listQueries: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags") {
      return route.fulfill({
        json: {
          tags: [
            { tag: "amplifier", count: 3 },
            { tag: "adc", count: 2 },
            { tag: "pll", count: 1 },
          ],
        },
      });
    }
    if (url.pathname !== "/api/gallery") return route.fallback();
    listQueries.push(url.searchParams.get("tags") ?? "");
    const selected = (url.searchParams.get("tags") ?? "")
      .split(",")
      .filter(Boolean);
    const all = [
      { id: "t-amp", tags: ["amplifier"] },
      { id: "t-adc", tags: ["adc", "amplifier"] },
      { id: "t-pll", tags: ["pll"] },
    ];
    const entries = all
      .filter(
        (entry) =>
          selected.length === 0 ||
          entry.tags.some((tag) => selected.includes(tag)),
      )
      .map((entry) => ({
        id: entry.id,
        name: `Circuit ${entry.id}`,
        author: "tz",
        description: "",
        createdAt: "2026-08-22T10:00:00.000Z",
        schemaVersion: 23,
        tags: entry.tags,
      }));
    return route.fulfill({ json: { entries, nextCursor: null } });
  });
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/");
  await expect(page.getByTestId("gallery-tile-t-pll")).toBeVisible();

  // Multi-select two tags: OR union, URL carried.
  const sidebar = page.getByTestId("gallery-tag-sidebar");
  await sidebar.locator("summary").filter({ hasText: "Amplifiers" }).click();
  await sidebar.locator("summary").filter({ hasText: "Conversion" }).click();
  const search = page.getByTestId("gallery-search");
  await search.fill("amplifier");
  await page.getByTestId("gallery-tag-option-amplifier").click();
  await expect(page.getByTestId("gallery-tile-t-pll")).toHaveCount(0);
  await search.fill("adc");
  await page.getByTestId("gallery-tag-option-adc").click();
  await expect(page).toHaveURL(/tags=amplifier%2Cadc|tags=amplifier,adc/);
  await search.fill("");
  await expect(page.getByTestId("gallery-tile-t-amp")).toBeVisible();
  expect(listQueries).toContain("amplifier,adc");

  // Clearing restores the full wall; a tile tag chip re-enters selection.
  await page.getByTestId("gallery-tags-clear").click();
  await expect(page.getByTestId("gallery-tile-t-pll")).toBeVisible();
  await page.getByTestId("gallery-tile-tag-t-pll-pll").click();
  await expect(page.getByTestId("gallery-tile-t-amp")).toHaveCount(0);
  await expect(page.getByTestId("gallery-tag-option-pll")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("the admin recycle bin restores a recycled entry", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  let restored = 0;
  await page.route("**/api/gallery/rejected", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.route("**/api/gallery/recycled", (route) =>
    route.fulfill({
      json: {
        entries: restored
          ? []
          : [
              {
                id: "bin-1",
                name: "Old Sketch",
                recycledAt: "2026-08-22T08:00:00.000Z",
              },
            ],
      },
    }),
  );
  await page.route("**/api/gallery/bin-1/restore", (route) => {
    restored += 1;
    return route.fulfill({ json: { id: "bin-1", status: "public" } });
  });

  await page.goto("/moderation");
  await expect(page.getByTestId("bin-card-bin-1")).toBeVisible();
  await page.getByTestId("bin-restore-bin-1").click();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  expect(restored).toBe(1);
});

test("the Owner restores rejected work or moves it through the bin before deletion", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  let rejected = [
    {
      id: "rejected-restore",
      name: "Corrected Amp",
      rejectReason: "Remove the loose wire",
      reviewedAt: "2026-08-22T09:00:00.000Z",
    },
    {
      id: "rejected-delete",
      name: "Spam",
      rejectReason: "Not a circuit",
      reviewedAt: "2026-08-22T08:00:00.000Z",
    },
  ];
  let recycled: Array<{ id: string; name: string; recycledAt: string }> = [];
  let deleted = 0;
  await page.route("**/api/gallery/rejected", (route) =>
    route.fulfill({ json: { entries: rejected } }),
  );
  await page.route("**/api/gallery/recycled", (route) =>
    route.fulfill({ json: { entries: recycled } }),
  );
  await page.route("**/api/gallery/rejected-restore/restore", (route) => {
    rejected = rejected.filter((entry) => entry.id !== "rejected-restore");
    return route.fulfill({
      json: { id: "rejected-restore", status: "public" },
    });
  });
  await page.route("**/api/gallery/rejected-delete/recycle", (route) => {
    rejected = rejected.filter((entry) => entry.id !== "rejected-delete");
    recycled = [
      {
        id: "rejected-delete",
        name: "Spam",
        recycledAt: "2026-08-22T10:00:00.000Z",
      },
    ];
    return route.fulfill({
      json: { id: "rejected-delete", status: "recycled" },
    });
  });
  await page.route("**/api/gallery/rejected-delete", (route) => {
    deleted += 1;
    recycled = [];
    return route.fulfill({ json: { id: "rejected-delete", deleted: true } });
  });

  await page.goto("/moderation");
  await expect(
    page.getByTestId("rejected-card-rejected-restore"),
  ).toContainText("Remove the loose wire");
  await expect(
    page.getByTestId("rejected-edit-rejected-restore"),
  ).toHaveAttribute("href", "/g/rejected-restore");
  await page.getByTestId("rejected-restore-rejected-restore").click();
  await expect(page.getByTestId("rejected-card-rejected-restore")).toHaveCount(
    0,
  );

  await page.getByTestId("rejected-recycle-rejected-delete").click();
  await expect(page.getByTestId("rejected-empty")).toBeVisible();
  await expect(page.getByTestId("bin-card-rejected-delete")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.getByTestId("bin-delete-rejected-delete").click();
  expect(deleted).toBe(0);
  await expect(page.getByTestId("bin-card-rejected-delete")).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByTestId("bin-delete-rejected-delete").click();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  expect(deleted).toBe(1);
});

test("falls back to bundled tiles when the gallery is empty or unreachable", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ status: 502, json: { error: "unavailable" } }),
  );
  await page.goto("/");
  await expect(
    page.getByTestId("gallery-bundled-two-stage-op-amp"),
  ).toBeVisible();
});

test("a gallery tile opens its circuit in the editor", async ({ page }) => {
  await mockGallery(page, [ENTRY]);
  await page.goto("/");
  await page.getByTestId(`gallery-tile-${ENTRY.id}`).click();
  await expect(page).toHaveURL(/\/g\/g-ring$/);
  // The editor arrives behind a lazy chunk. Wait for the canvas before
  // reading the status line: an expect() poll gives up sooner than a cold,
  // busy runner needs to load it, which is a failure with no defect in it.
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  // The circuit name is an editable field now, so it is read as a value.
  await expect(page.getByTestId("project-name-input")).toHaveValue(ENTRY.name);
  const gallerySummary = page.getByTestId("gallery-entry-summary");
  await expect(gallerySummary).toContainText(`by ${ENTRY.author}`);
  await expect(gallerySummary).toContainText(ENTRY.description);
  await gallerySummary.click();
  const galleryInformation = page.getByTestId("gallery-entry-popover");
  await expect(galleryInformation).toBeVisible();
  await expect(galleryInformation).toContainText("Contributor");
  await expect(galleryInformation).toContainText(ENTRY.author);
  await expect(galleryInformation).toContainText("Notes");
  await expect(galleryInformation).toContainText(ENTRY.description);

  // The brand mark is the single way back; a second toolbar link said the
  // same thing twice.
  await expect(page.getByTestId("toolbar-gallery-link")).toHaveCount(0);
  await expect(page.locator(".gallery-home-link h1")).toHaveText(
    "Analog Canvas",
  );
  const brandLink = page.locator(".gallery-home-link");
  await expect(brandLink).toHaveAttribute("href", "/");
  await brandLink.click();
  await expect(page.getByTestId("gallery-feed")).toBeVisible();
});

test("the feed offers exactly the enabled sign-in providers and sends email links", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: false, email: true } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user: null } }),
  );
  const emailStarts: string[] = [];
  await page.route("**/api/auth/email/start", (route) => {
    emailStarts.push(String(route.request().postDataJSON().email));
    return route.fulfill({ status: 202, json: { sent: true } });
  });

  await page.goto("/");
  await page.getByTestId("account-signin").locator("summary").click();
  await expect(page.getByTestId("signin-github")).toHaveAttribute(
    "href",
    "/api/auth/github/start",
  );
  await expect(page.getByTestId("signin-google")).toHaveCount(0);
  await page.getByTestId("signin-email-input").fill("vivian@example.com");
  await page.getByTestId("signin-email-send").click();
  await expect(page.getByTestId("account-notice")).toHaveText(
    "Check your inbox for the link.",
  );
  expect(emailStarts).toEqual(["vivian@example.com"]);
});

test("a signed-in owner renames the display name and signs out", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/auth/providers", (route) =>
    route.fulfill({ json: { github: true, google: true, email: true } }),
  );
  const user = {
    id: "u1",
    displayName: "tz",
    email: "owner@example.com",
    provider: "github",
    isAdmin: true,
  };
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({ json: { user } }),
  );
  const renames: string[] = [];
  await page.route("**/api/auth/profile", (route) => {
    const displayName = String(route.request().postDataJSON().displayName);
    renames.push(displayName);
    return route.fulfill({ json: { user: { ...user, displayName } } });
  });
  let loggedOut = 0;
  await page.route("**/api/auth/logout", (route) => {
    loggedOut += 1;
    return route.fulfill({ json: { ok: true } });
  });

  await page.goto("/");
  await expect(page.getByTestId("account-owner")).toHaveText("Owner");
  await page.getByTestId("account-name").click();
  await page.getByTestId("account-rename-input").fill("Token Zhang");
  await page.getByTestId("account-rename-input").press("Enter");
  await expect(page.getByTestId("account-name")).toHaveText("Token Zhang");
  expect(renames).toEqual(["Token Zhang"]);

  await page.locator(".account-more > summary").click();
  const accountPopover = page.locator(".account-popover");
  await expect(accountPopover).toHaveCSS("position", "absolute");
  await expect(accountPopover).toHaveCSS("display", "grid");
  await page.getByTestId("account-signout").click();
  await expect(page.getByTestId("account-signin")).toBeVisible();
  expect(loggedOut).toBe(1);
});

test("a signed-out visitor is asked to sign in, not for a passphrase", async ({
  page,
}) => {
  await page.route(galleryListUrl, (route) =>
    route.fulfill({ json: { entries: [], nextCursor: null } }),
  );

  await page.goto("/editor");
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();

  await expect(dialog.getByTestId("publish-signin")).toBeVisible();
  await expect(dialog.getByTestId("publish-signin-github")).toHaveAttribute(
    "href",
    "/api/auth/github/start",
  );
  // The passphrase is gone: no field, and nothing to submit without a session.
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Publish" })).toHaveCount(0);
});

test("a signed-in member publishes directly, bylined by the account", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  const posted: {
    authorization: string | null;
    hasAuthor: boolean;
    name: string;
    tags: string[];
    schemaVersion: number;
  }[] = [];
  const updated: { name: string; instanceCount: number }[] = [];
  // The real submissions endpoint is /api/gallery/submissions — the mock
  // matches it exactly so a client posting anywhere else fails this test.
  await page.route("**/api/gallery/submissions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const body = route.request().postDataJSON() as {
      author?: string;
      name: string;
      tags: string[];
      projectText: string;
    };
    posted.push({
      authorization: route.request().headers()["authorization"] ?? null,
      hasAuthor: "author" in body,
      name: body.name,
      tags: body.tags,
      schemaVersion: (JSON.parse(body.projectText) as { schemaVersion: number })
        .schemaVersion,
    });
    return route.fulfill({ status: 201, json: { id: "entry-77" } });
  });
  await page.route("**/api/gallery/entry-77", (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    const body = route.request().postDataJSON() as {
      name: string;
      projectText: string;
    };
    const project = JSON.parse(body.projectText) as {
      documents: { instances: unknown[] }[];
    };
    updated.push({
      name: body.name,
      instanceCount: project.documents[0]?.instances.length ?? 0,
    });
    return route.fulfill({ status: 200, json: { id: "entry-77" } });
  });

  await page.goto("/editor");
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Publishing as Token Zhang")).toBeVisible();
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  // The byline comes from the account, so there is no field to fill in.
  await expect(dialog.getByLabel("Author")).toHaveCount(0);

  await dialog.getByLabel("Circuit name").fill("Session Publish");
  await dialog.getByTestId("publish-preset-amplifier").click();
  await dialog.getByLabel("Add tag").fill("Latch");
  await dialog.getByLabel("Add tag").press("Enter");
  await expect(dialog.getByTestId("publish-tag-latch")).toBeVisible();
  await dialog.getByRole("button", { name: "Publish" }).click();
  await expect(page.getByTestId("status")).toHaveText(
    'Published "Session Publish" to the gallery',
  );
  expect(posted).toEqual([
    {
      authorization: null,
      hasAuthor: false,
      name: "Session Publish",
      tags: ["amplifier", "latch"],
      schemaVersion: CURRENT_PROJECT_FILE_VERSION,
    },
  ]);

  // The live Project remains the source of this publication. After another
  // edit, Publish must update the item it just created rather than creating a
  // duplicate Gallery entry.
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 340, y: 230 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("publish-gallery-button").click();
  await expect(page.getByTestId("publish-mode")).toContainText(
    "Session Publish",
  );
  await page
    .getByTestId("publish-gallery-dialog")
    .getByRole("button", { name: "Update entry" })
    .click();
  await expect(page.getByTestId("status")).toHaveText(
    'Updated "Session Publish" in the gallery',
  );
  expect(posted).toHaveLength(1);
  expect(updated).toEqual([{ name: "Session Publish", instanceCount: 1 }]);
});

test("a mistaken click beside the publish form keeps what was written", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          isAdmin: true,
        },
      },
    }),
  );

  await page.goto("/editor");
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Circuit name").fill("Folded Cascode");
  await dialog
    .getByLabel("Description")
    .fill("Gain boosted, 1.2 V supply, trimmed offset.");
  await dialog.getByLabel("Add tag").fill("Cascode");
  await dialog.getByLabel("Add tag").press("Enter");
  await expect(dialog.getByTestId("publish-tag-cascode")).toBeVisible();

  // A stray press on the backdrop beside a form being written in is a miss,
  // not a decision to throw the writing away.
  const viewport = page.viewportSize()!;
  await page.mouse.click(8, viewport.height - 8);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Circuit name")).toHaveValue("Folded Cascode");

  // Cancelling is a decision, and it still closes — but reopening comes back
  // to the draft rather than to an empty form.
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await page.getByTestId("publish-gallery-button").click();
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel("Circuit name")).toHaveValue("Folded Cascode");
  await expect(dialog.getByLabel("Description")).toHaveValue(
    "Gain boosted, 1.2 V supply, trimmed offset.",
  );
  await expect(dialog.getByTestId("publish-tag-cascode")).toBeVisible();
});

test("Cloud Save updates one stable private Project", async ({ page }) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          isAdmin: false,
        },
      },
    }),
  );
  let cloudProject: {
    id: string;
    name: string;
    projectText: string;
    updatedAt: string;
    revision: number;
    schemaVersion: number;
  } | null = null;
  let storedProjectText = "";
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        name: string;
        projectText: string;
      };
      storedProjectText = body.projectText;
      cloudProject = {
        id: "cloud-1",
        ...body,
        updatedAt: "2026-08-23T00:00:00.000Z",
        revision: 1,
        schemaVersion: ENTRY.schemaVersion,
      };
      return route.fulfill({
        status: 201,
        json: { project: cloudProject },
      });
    }
    return route.fulfill({
      json: { projects: cloudProject ? [cloudProject] : [] },
    });
  });
  await page.goto("/editor");
  await chooseComponent(page, "nmos");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 280 } });
  await page.keyboard.press("Escape");
  const fileMenu = await openMenu(page, "File");
  await fileMenu.getByRole("button", { name: "Save", exact: true }).click();

  // Private formal saving does not apply Gallery quality gates.
  await expect(page.getByTestId("status")).toContainText(
    "Saved New Circuit to Cloud",
  );
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );
  expect(storedProjectText).toContain("nmos");

  const reopenedMenu = await openMenu(page, "File");
  await expect(
    reopenedMenu.getByText(`Cloud Projects (1/${CLOUD_PROJECT_LIMIT})`),
  ).toBeVisible();
  await expect(
    reopenedMenu.getByTestId("cloud-project-cloud-1"),
  ).toBeDisabled();
});

test("keeps newest-first order and stops after the last circuit", async ({
  page,
}) => {
  const wall = Array.from({ length: 10 }, (_, index) => ({
    ...ENTRY,
    id: `g-${index}`,
    name: `Circuit ${index}`,
    createdAt: new Date(Date.UTC(2026, 7, 21, 10, 0, 10 - index)).toISOString(),
  }));
  const listRequests: string[] = [];
  await page.route("**/api/gallery**", (route) => {
    const url = new URL(route.request().url());
    if (url.pathname !== "/api/gallery") return route.fallback();
    listRequests.push(url.search);
    const offset = Number(url.searchParams.get("cursor") ?? "0");
    const slice = wall.slice(offset, offset + 3);
    return route.fulfill({
      json: {
        entries: slice,
        nextCursor:
          offset + slice.length < wall.length
            ? String(offset + slice.length)
            : null,
      },
    });
  });
  await page.route("**/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    }),
  );

  await page.goto("/");
  const tiles = page.locator('[data-testid^="gallery-tile-"]');
  await expect(tiles.first()).toBeVisible();

  // The wall fills through its cursor chain, then remains at exactly one copy
  // of each circuit no matter how often the exhausted sentinel is exposed.
  for (let scroll = 0; scroll < 6; scroll += 1) {
    await page.mouse.wheel(0, 4000);
    await page.waitForTimeout(250);
  }
  await expect(tiles).toHaveCount(wall.length);
  expect(
    await tiles.evaluateAll((items) =>
      items.map((item) => item.getAttribute("data-testid")),
    ),
  ).toEqual(wall.map((entry) => `gallery-tile-${entry.id}`));
  expect(
    listRequests.every(
      (query) => new URLSearchParams(query).get("seed") === null,
    ),
  ).toBe(true);
});

test("marks the circuits that extract and counts thumbs on every card", async ({
  page,
}) => {
  const extractable = {
    ...ENTRY,
    netlistable: true,
    likes: 2,
    likedByViewer: false,
  };
  const sketch = {
    ...ENTRY,
    id: "g-sketch",
    name: "Ideal Sketch",
    netlistable: false,
    likes: 0,
    likedByViewer: false,
  };
  await page.route(galleryListUrl, (route) =>
    route.fulfill({
      json: { entries: [extractable, sketch], nextCursor: null },
    }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"></svg>',
    }),
  );
  let toggles = 0;
  await page.route("**/api/gallery/*/like", (route) => {
    toggles += 1;
    return route.fulfill({ json: { likes: 3, likedByViewer: true } });
  });

  await page.goto("/");
  // The netlist mark, a drawn deck rather than a star, belongs to the one
  // that extracts. The other is on the wall all the same — a schematic is
  // allowed to be abbreviated.
  const mark = page.getByTestId(`gallery-netlist-${extractable.id}`);
  await expect(mark).toBeVisible();
  await expect(mark.locator("svg")).toHaveCount(1);
  await expect(mark).not.toContainText("★");
  await expect(page.getByTestId(`gallery-netlist-${sketch.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`gallery-tile-${sketch.id}`)).toBeVisible();

  const thumb = page.getByTestId(`gallery-like-${extractable.id}`);
  // The mark is drawn, not typed: an emoji is a different picture on every
  // platform and brings its own colour onto a wall of circuit drawings.
  await expect(thumb.locator("svg")).toHaveCount(1);
  await expect(thumb).not.toContainText("👍");
  await expect(thumb).toContainText("2");
  await expect(thumb).toHaveAttribute("aria-pressed", "false");

  // Pressing the thumb applies what the server returned, and does not follow
  // the card's link on the way.
  await thumb.click();
  await expect(thumb).toContainText("3");
  await expect(thumb).toHaveAttribute("aria-pressed", "true");
  expect(toggles).toBe(1);
  expect(new URL(page.url()).pathname).toBe("/");
});

test("an ordinary user sees blocking quality gates on an empty project", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u9",
          displayName: "Visitor",
          email: "visitor@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );

  await page.goto("/editor");
  const toolbar = page.locator(".toolbar-row").first();
  const toolbarStyleBeforeDialog = await toolbar.evaluate((element) => {
    const style = getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderTopColor: style.borderTopColor,
      display: style.display,
    };
  });
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect
    .poll(() =>
      toolbar.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
          backgroundColor: style.backgroundColor,
          borderTopColor: style.borderTopColor,
          display: style.display,
        };
      }),
    )
    .toEqual(toolbarStyleBeforeDialog);

  // The empty canvas trips the content check — listed as advice, never as a
  // hard gate: the checker has false positives and sketches are shareable.
  const gates = page.getByTestId("publish-gallery-gates");
  await expect(gates).toBeVisible();
  await expect(gates).toContainText("publishing stays open");
  await expect(gates).toContainText("Too little content");
  const tags = dialog.getByTestId("publish-tags");
  await expect(tags).toHaveCSS("display", "flex");
  await expect(tags).toHaveCSS("flex-direction", "column");
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeEnabled();
});

test("the publish dialog resolves internal Cell instances from the open Project", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u9",
          displayName: "Visitor",
          email: "visitor@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );

  await page.goto("/editor");
  await page.getByTestId("project-file").setInputFiles({
    name: "hierarchical-publish.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(serializeProject(hierarchicalPublishProject())),
  });
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByTestId("publish-gallery-gates")).toHaveCount(0);
  await expect(dialog).not.toContainText("ERC_UNRESOLVED_SYMBOL");
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeEnabled();
});

test("post-publication moderation has rejected work but no approval queue", async ({
  page,
}) => {
  const convergenceCalls: boolean[] = [];
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  await page.route("**/api/gallery/recycled", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.route("**/api/gallery/rejected", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.route(
    "**/api/gallery/maintenance/schema-current",
    async (route) => {
      const body = route.request().postDataJSON() as { apply?: boolean };
      convergenceCalls.push(body.apply === true);
      await route.fulfill({
        json: {
          applied: body.apply === true,
          targetSchemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
          inventory: {
            gallery_entries: {
              [String(CURRENT_PROJECT_SCHEMA_VERSION - 1)]: 3,
            },
            gallery_entry_versions: {
              [String(CURRENT_PROJECT_SCHEMA_VERSION - 1)]: 1,
            },
            cloud_projects: {
              [String(CURRENT_PROJECT_SCHEMA_VERSION - 1)]: 1,
            },
          },
          records: 5,
          ready: 5,
          failures: [],
        },
      });
    },
  );

  await page.goto("/moderation");
  await expect(page.getByTestId("moderation")).toBeVisible();
  await page.getByTestId("owner-settings").locator("summary").click();
  await expect(page.getByTestId("schema-backup-download")).toHaveAttribute(
    "href",
    "/api/gallery/maintenance/schema-backup",
  );
  await expect(page.getByTestId("schema-current-apply")).toBeDisabled();
  await page.getByTestId("schema-current-dry-run").click();
  await expect(page.getByTestId("schema-current-report")).toContainText(
    `Validated: 5/5 records ready for schema ${CURRENT_PROJECT_SCHEMA_VERSION}; 0 failures.`,
  );
  await expect(page.getByTestId("schema-current-report")).toContainText(
    `gallery_entries: v${CURRENT_PROJECT_SCHEMA_VERSION - 1}=3`,
  );
  await expect(page.getByTestId("schema-current-apply")).toBeDisabled();
  await page.getByTestId("schema-current-backup-confirmed").check();
  await page.getByTestId("schema-current-apply").click();
  await expect(page.getByTestId("schema-current-report")).toContainText(
    `Applied: 5/5 records ready for schema ${CURRENT_PROJECT_SCHEMA_VERSION}; 0 failures.`,
  );
  expect(convergenceCalls).toEqual([false, true]);
  // Curation is post-publication: rejected work and a bin, never an inbox.
  await expect(page.getByTestId("rejected-empty")).toBeVisible();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  await expect(page.getByTestId("review-empty")).toHaveCount(0);
  await expect(page.getByText("Nothing waiting for review")).toHaveCount(0);
});

test("an author deletes their own entry from My submissions", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u7",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  let live = true;
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: live
          ? [
              {
                id: "mine-9",
                name: "Draft I regret",
                createdAt: "2026-08-29T09:00:00.000Z",
                status: "public",
                rejectReason: null,
              },
            ]
          : [],
      },
    }),
  );
  const methods: string[] = [];
  await page.route("**/api/gallery/mine-9", (route) => {
    if (route.request().method() !== "DELETE") return route.fallback();
    methods.push("DELETE");
    live = false;
    return route.fulfill({ json: { id: "mine-9", deleted: true } });
  });

  await page.goto("/mine");
  const remove = page.getByTestId("mine-delete-mine-9");
  await expect(remove).toBeVisible();

  // Irreversible, so it asks first; declining leaves the entry alone.
  page.once("dialog", (dialog) => void dialog.dismiss());
  await remove.click();
  expect(methods).toHaveLength(0);
  await expect(remove).toBeVisible();

  page.once("dialog", (dialog) => void dialog.accept());
  await remove.click();
  await expect(page.getByTestId("mine-notice")).toContainText("Deleted");
  await expect(page.getByTestId("mine-delete-mine-9")).toHaveCount(0);
  expect(methods).toEqual(["DELETE"]);
});

test("/mine wears the site chrome and links every entry back to the editor", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u7",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: "mine-1",
            name: "Rejected Filter",
            createdAt: "2026-08-22T09:00:00.000Z",
            status: "rejected",
            rejectReason: "Label the ports",
          },
          {
            id: "mine-2",
            name: "Live Amp",
            createdAt: "2026-08-22T08:00:00.000Z",
            status: "public",
            rejectReason: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
    }),
  );

  await page.goto("/mine");
  // The standard chrome is present, not a bare paragraph.
  await expect(page.getByTestId("gallery-editor-link")).toBeVisible();
  await expect(page.getByTestId("gallery-new-circuit")).toBeVisible();
  await expect(page.getByTestId("mine-reason-mine-1")).toContainText(
    "Label the ports",
  );
  await expect(page.getByTestId("mine-withdraw-mine-1")).toHaveCount(0);
  await expect(page.getByTestId("mine-card-mine-1")).toContainText(
    "remains hidden until the Owner restores it",
  );
  await expect(page.getByTestId("mine-edit-mine-2")).toHaveAttribute(
    "href",
    "/g/mine-2",
  );
  await expect(page.getByTestId("mine-status-mine-2")).toHaveText("Published");
});

test("/mine offers owner withdrawal, restore, and version history", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u7",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "email",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  let withdrawn = false;
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: "mine-2",
            name: "Live Amp",
            createdAt: "2026-08-22T08:00:00.000Z",
            status: withdrawn ? "recycled" : "public",
            rejectReason: null,
          },
        ],
      },
    }),
  );
  await page.route("**/api/gallery/mine-2/recycle", (route) => {
    withdrawn = true;
    return route.fulfill({ json: { id: "mine-2" } });
  });
  await page.route("**/api/gallery/mine-2/restore", (route) => {
    withdrawn = false;
    return route.fulfill({ json: { id: "mine-2" } });
  });
  await page.route("**/api/gallery/mine-2/versions", (route) =>
    route.fulfill({
      json: {
        versions: [
          {
            versionId: "v-1",
            versionNo: 1,
            name: "Live Amp v1",
            author: "Maker",
            tags: [],
            createdAt: "2026-08-21T08:00:00.000Z",
          },
        ],
      },
    }),
  );
  const svg = {
    contentType: "image/svg+xml",
    body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
  };
  await page.route("**/api/gallery/*/preview.svg", (route) =>
    route.fulfill(svg),
  );
  await page.route("**/api/gallery/*/versions/*/preview.svg", (route) =>
    route.fulfill(svg),
  );

  await page.goto("/mine");
  // Withdrawal asks for a second, explicit click.
  await page.getByTestId("mine-withdraw-mine-2").click();
  await page.getByTestId("mine-withdraw-confirm-mine-2").click();
  await expect(page.getByTestId("mine-status-mine-2")).toHaveText("Withdrawn");
  await expect(page.getByTestId("mine-notice")).toContainText("Withdrew");
  // Restore republishes a voluntary withdrawal.
  await page.getByTestId("mine-restore-mine-2").click();
  await expect(page.getByTestId("mine-status-mine-2")).toHaveText("Published");
  // The version history dialog lists the snapshot with its preview.
  await page.getByTestId("mine-history-mine-2").click();
  const history = page.getByTestId("version-history-dialog");
  await expect(history).toBeVisible();
  await expect(page.locator(".version-history-backdrop")).toHaveCSS(
    "position",
    "fixed",
  );
  await expect(history).toHaveCSS("display", "flex");
  const version = page.getByTestId("version-1");
  await expect(version).toHaveCSS("display", "grid");
  await expect(version).toContainText("Live Amp v1");
});

test("an opened gallery entry offers updating in place", async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 900 });
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  const updates: { method: string; body: { name: string } }[] = [];
  await page.route(`**/api/gallery/${ENTRY.id}`, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    updates.push({
      method: route.request().method(),
      body: route.request().postDataJSON() as { name: string },
    });
    return route.fulfill({ json: { id: ENTRY.id, status: "public" } });
  });

  await page.goto(`/g/${ENTRY.id}`);
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  const publishMode = page.getByTestId("publish-mode");
  await expect(publishMode).toBeVisible();
  await expect(publishMode).toHaveCSS("display", "flex");
  await expect(publishMode).toHaveCSS("flex-direction", "column");
  const updateChoice = publishMode
    .getByRole("radio", { name: /^Update /u })
    .locator("..");
  const newChoice = publishMode
    .getByRole("radio", { name: "Publish as a new entry", exact: true })
    .locator("..");
  const [updateBox, newBox, historyBox] = await Promise.all([
    updateChoice.boundingBox(),
    newChoice.boundingBox(),
    page.getByTestId("publish-history").boundingBox(),
  ]);
  expect(updateBox).not.toBeNull();
  expect(newBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  expect(newBox!.y).toBeGreaterThanOrEqual(updateBox!.y + updateBox!.height);
  expect(historyBox!.y).toBeGreaterThanOrEqual(newBox!.y + newBox!.height);
  // The update option names exactly what it will replace.
  await expect(publishMode).toContainText(ENTRY.name);
  await expect(dialog.getByText("updates the entry in place")).toBeVisible();

  await dialog.getByRole("button", { name: "Update entry" }).click();
  await expect(page.getByTestId("status")).toContainText(
    `Updated "${ENTRY.name}" in the gallery`,
  );
  expect(updates).toHaveLength(1);
  expect(updates[0]!.body.name).toBe(ENTRY.name);
});

test("a reviewer browses version history and restores a version", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}/versions`, (route) =>
    route.fulfill({
      json: {
        versions: [
          {
            versionId: "v-2",
            versionNo: 2,
            name: "Ring Oscillator (older)",
            author: "tz",
            tags: ["oscillator"],
            createdAt: "2026-08-22T10:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/gallery/${ENTRY.id}/versions/v-2/preview.svg`,
    (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"><rect width="10" height="6" fill="#fff"/></svg>',
      }),
  );
  let restores = 0;
  await page.route(
    `**/api/gallery/${ENTRY.id}/versions/v-2/restore`,
    (route) => {
      restores += 1;
      return route.fulfill({ json: { id: ENTRY.id, restored: true } });
    },
  );

  await page.goto(`/g/${ENTRY.id}`);
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  await page.getByTestId("publish-gallery-button").click();
  await page.getByTestId("publish-history").click();

  const history = page.getByTestId("version-history-dialog");
  await expect(history).toBeVisible();
  const backdrop = page.locator(".version-history-backdrop");
  await expect(backdrop).toHaveCSS("position", "fixed");
  await expect(history).toHaveCSS("display", "flex");
  const backdropBox = await backdrop.boundingBox();
  const historyBox = await history.boundingBox();
  expect(backdropBox).not.toBeNull();
  expect(historyBox).not.toBeNull();
  const upperGap = historyBox!.y - backdropBox!.y;
  const lowerGap =
    backdropBox!.y + backdropBox!.height - historyBox!.y - historyBox!.height;
  // Loading this lazy dialog must not drop it into normal editor flow. The
  // overlay owns the viewport and keeps the workbench vertically centered.
  expect(Math.abs(upperGap - lowerGap)).toBeLessThanOrEqual(2);
  const version = page.getByTestId("version-2");
  await expect(version).toHaveCSS("display", "grid");
  await expect(version).toContainText("Ring Oscillator (older)");
  await page.getByTestId("version-restore-2").click();
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  expect(restores).toBe(1);
});

test("replacing the project retires the stale update offer", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery?limit=60", (route) =>
    // The panel sees an empty gallery, so it offers the bundled examples
    // — opening one replaces the Project with a non-gallery one.
    route.fulfill({ json: { entries: [], nextCursor: null } }),
  );
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Token Zhang",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );

  await page.goto(`/g/${ENTRY.id}`);
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );

  // Sanity: while the entry is the active Project, updating is offered.
  await page.getByTestId("publish-gallery-button").click();
  await expect(page.getByTestId("publish-mode")).toBeVisible();
  await page
    .getByTestId("publish-gallery-dialog")
    .getByRole("button", { name: "Cancel" })
    .click();

  // Import a different Project over it: the gallery entry is no longer
  // active, so publishing must NOT offer updating it any more.
  await page.getByTestId("project-file").setInputFiles({
    name: "fresh.icproj.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      serializeProject(createEmptyProject("fresh-project", "Fresh Start")),
    ),
  });
  // The fixture may pass through the rolling schema upgrade; either status
  // still proves that this different Project replaced the gallery entry.
  await expect(page.getByTestId("status")).toContainText("fresh.icproj.json");

  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("publish-mode")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeVisible();
});

test("the Examples panel guards dirty work before opening an entry", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery?limit=60", (route) =>
    route.fulfill({ json: { entries: [ENTRY], nextCursor: null } }),
  );

  await page.goto("/editor");
  for (const x of [300, 380, 460]) {
    await chooseComponent(page, "resistor");
    await page
      .getByTestId("schematic-canvas")
      .click({ position: { x, y: 230 } });
    await page.keyboard.press("Escape");
  }
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  await expect(panel).toHaveAttribute("data-open", "true");
  const card = panel.getByTestId(`gallery-example-${ENTRY.id}`);
  await expect(card).toBeVisible();
  await expect(card).toContainText(ENTRY.name);
  await expect(card).toContainText(ENTRY.author);
  // The panel replaced the bundled list with the shared gallery source.
  await expect(
    panel.getByTestId("shapes-example-common-source-amplifier"),
  ).toHaveCount(0);

  await card.click();
  const dialog = page.getByRole("dialog", {
    name: "Unsaved changes",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Stay" }).click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);

  await card.click();
  await dialog.getByRole("button", { name: "Continue without saving" }).click();
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  await expect(page.getByTestId("hit-R1")).toHaveCount(0);
});

test("bundled starter tiles open their example in the editor", async ({
  page,
}) => {
  await mockGallery(page, []);
  await page.goto("/");
  await page.getByTestId("gallery-bundled-common-source-amplifier").click();
  await expect(page).toHaveURL(/\/editor\?example=common-source-amplifier$/);
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    "Opened example: Common-Source Amplifier",
  );
});

test("bundled VDD rails keep their current presentation in the Gallery and editor", async ({
  page,
}) => {
  await mockGallery(page, []);
  await page.goto("/");
  const tile = page.getByTestId(
    "gallery-bundled-current-mirror-loaded-differential-pair",
  );
  const tileRails = tile.locator('[data-route-presentation="power-rail"]');
  await expect(tileRails).toHaveCount(3);
  // A conductor run is one shape, so a rail's width is on the shape carrying
  // its subpath rather than on the element that carries its identity.
  const railInkWidths = (root: Locator) =>
    root.evaluate((element: SVGElement | HTMLElement) => {
      const inks = [...element.querySelectorAll('[data-role="conductor-ink"]')];
      return [
        ...element.querySelectorAll('[data-route-presentation="power-rail"]'),
      ].map((rail) => {
        const subpath = `M ${Array.from((rail as SVGPolylineElement).points)
          .map((point) => `${point.x} ${point.y}`)
          .join(" L ")}`;
        return (
          inks
            .find((path) => (path.getAttribute("d") ?? "").includes(subpath))
            ?.getAttribute("stroke-width") ?? null
        );
      });
    });
  expect(await railInkWidths(tile)).toEqual(["3.24", "3.24", "3.24"]);
  await expect(
    tile.locator(
      '[data-layer="junctions"] circle[cx="380"][cy="160"], [data-layer="junctions"] circle[cx="500"][cy="160"]',
    ),
  ).toHaveCount(0);

  await tile.click();
  await expect(page).toHaveURL(
    /\/editor\?example=current-mirror-loaded-differential-pair$/,
  );
  await awaitEditorReady(page);
  const canvasRails = page.locator(
    '[data-testid="schematic-canvas"] [data-route-presentation="power-rail"]',
  );
  await expect(canvasRails).toHaveCount(3);
  expect(
    await railInkWidths(page.locator('[data-testid="schematic-canvas"]')),
  ).toEqual(["3.24", "3.24", "3.24"]);
  await expect(
    page.locator(
      '[data-testid="schematic-canvas"] [data-layer="junctions"] circle[cx="380"][cy="160"], [data-testid="schematic-canvas"] [data-layer="junctions"] circle[cx="500"][cy="160"]',
    ),
  ).toHaveCount(0);
});

test("authors can filter pending visual reviews and resolve their own drawing", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "maker-1",
          displayName: "Maker",
          email: "maker@example.com",
          provider: "github",
          isAdmin: false,
          role: "user",
        },
      },
    }),
  );
  let entry = {
    ...ENTRY,
    id: "review-me",
    ownerUserId: "maker-1",
    tags: ["amplifier"],
    curationRevision: 1,
    attention: {
      status: "needs-attention",
      issues: [
        {
          kind: "suspected-disconnection",
          detail: "Output wire has a visible gap near OUT.",
        },
      ],
    },
    assessedPreviewRevision: ENTRY.previewRevision,
  };
  await page.route("**/api/gallery**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === "/api/gallery/tags")
      return route.fulfill({
        json: {
          tags: [{ tag: "amplifier", count: 1 }],
        },
      });
    if (url.pathname === "/api/gallery/review-me/curation") {
      const body = route.request().postDataJSON();
      expect(body.expectedCurationRevision).toBe(1);
      expect(body.expectedPreviewRevision).toBe(ENTRY.previewRevision);
      entry = { ...entry, attention: body.attention, curationRevision: 2 };
      return route.fulfill({ json: { entry } });
    }
    if (url.pathname === "/api/gallery") {
      const included =
        url.searchParams.get("attention") !== "1" ||
        entry.attention.status === "needs-attention";
      return route.fulfill({
        json: {
          entries: included ? [entry] : [],
          nextCursor: null,
          total: included ? 1 : 0,
        },
      });
    }
    if (url.pathname.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 6"/>',
      });
    return route.fallback();
  });
  await page.goto("/");
  await expect(page.getByText("Categories", { exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId("gallery-tile-tag-review-me-amplifier"),
  ).toBeVisible();
  await page.getByTestId("gallery-filter-attention").click();
  await expect(page).toHaveURL(/attention=1/);
  const review = page.getByTestId("gallery-attention-review-me");
  await review.locator("summary").click();
  await expect(review).toContainText("Output wire has a visible gap");
  await review.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByTestId("gallery-tile-review-me")).toHaveCount(0);
  await page.getByTestId("gallery-filter-attention").click();
  await expect(page.getByTestId("gallery-attention-review-me")).toContainText(
    "Reviewed · resolved",
  );
});
