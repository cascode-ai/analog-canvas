// Version history: browsing and restoring Gallery versions, comparing and
// branching from history, and Shelf save history.

import { expect, test } from "./gallery-test.js";
import type { CircuitProject } from "@icm/model";
import {
  serializeProject,
  parseProject,
  CURRENT_PROJECT_FILE_VERSION,
} from "@icm/project-protocol";
import {
  awaitEditorReady,
  downloadBytes,
  parseSavedProject,
} from "./editor-fixtures.js";
import {
  ENTRY,
  galleryResistorProject,
  mockGallery,
} from "./gallery-fixtures.js";

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

test("Gallery history compares components and branches without changing the source publication", async ({
  page,
}) => {
  const before = galleryResistorProject("1k", 3);
  const after = structuredClone(before);
  const document = after.documents[0]!;
  document.instances[0]!.netlist!.parameters.value = "2k";
  document.instances[2]!.id = "R4";
  document.instances[2]!.reference = "R4";
  document.instances[2]!.placement!.position.x += 40;
  for (const net of document.nets)
    for (const terminal of net.terminals)
      if (terminal.instanceId === "R3") terminal.instanceId = "R4";
  document.routes = [];
  const beforeText = serializeProject(before);
  let currentText = serializeProject(after);
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Reviewer",
          email: "owner@example.com",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}`, (route) =>
    route.fulfill({ json: { entry: ENTRY, projectText: currentText } }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}/versions`, (route) =>
    route.fulfill({
      json: {
        versions: [
          {
            versionId: "v1",
            versionNo: 1,
            name: "Resistors",
            author: "tz",
            tags: [],
            createdAt: "2026-09-20T00:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route(
    `**/api/gallery/${ENTRY.id}/versions/v1/preview.svg`,
    (route) =>
      route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}/versions/v1/project`, (route) =>
    route.fulfill({ json: { projectText: beforeText } }),
  );
  const cloudWrites: { method: string; projectText: string }[] = [];
  await page.route("**/api/projects", (route) => {
    if (route.request().method() === "GET")
      return route.fulfill({ json: { projects: [] } });
    const body = route.request().postDataJSON();
    cloudWrites.push({
      method: route.request().method(),
      projectText: body.projectText,
    });
    return route.fulfill({
      status: 201,
      json: {
        project: {
          id: "branched-cloud",
          name: body.name,
          revision: 1,
          schemaVersion: CURRENT_PROJECT_FILE_VERSION,
          updatedAt: "2026-09-21T09:00:00.000Z",
          projectText: body.projectText,
        },
      },
    });
  });
  const writes: string[] = [];
  page.on("request", (request) => {
    if (
      ["PUT", "POST", "DELETE"].includes(request.method()) &&
      new URL(request.url()).pathname.startsWith("/api/gallery/")
    )
      writes.push(request.url());
  });
  await page.goto(`/g/${ENTRY.id}`);
  await awaitEditorReady(page);
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  await page.getByTestId("hit-R1").click();
  await page.getByTestId("publish-gallery-button").click();
  await page.getByTestId("publish-history").click();
  await page.getByTestId("version-compare-1").click();
  const comparison = page.getByTestId("version-comparison");
  await expect(comparison).toContainText("1 added · 1 removed · 2 modified");
  await expect(page.getByTestId("version-highlight-before")).toHaveCount(3);
  await expect(page.getByTestId("version-highlight-after")).toHaveCount(3);
  await expect(
    page.locator(
      '[data-testid="version-highlight-before"][data-change="removed"]',
    ),
  ).toHaveAttribute("data-instance-id", "R3");
  const highlight = page.locator(
    '[data-testid="version-highlight-after"][data-instance-id="R1"]',
  );
  const box = await highlight.boundingBox();
  expect(box!.width).toBeGreaterThan(20);
  await highlight.click();
  const details = page.getByRole("table", { name: "R1 changes" });
  await expect(details).toContainText("netlist.parameters.value");
  await expect(details).toContainText("1k");
  await expect(details).toContainText("2k");
  // Mouse/keyboard comparison is isolated from the live editor and stays frozen.
  await page.keyboard.press("Delete");
  await page.keyboard.press("ControlOrMeta+z");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  currentText = beforeText;
  await expect(details).toContainText("2k");
  await page.screenshot({ path: "plan/gallery-history-comparison.png" });
  await page.setViewportSize({ width: 640, height: 800 });
  const beforeBox = await page
    .locator(".version-compare-side")
    .first()
    .boundingBox();
  const afterBox = await page
    .locator(".version-compare-side")
    .last()
    .boundingBox();
  expect(afterBox!.y).toBeGreaterThanOrEqual(beforeBox!.y + beforeBox!.height);
  expect(
    await page
      .getByTestId("version-history-dialog")
      .evaluate((element) => element.scrollWidth <= element.clientWidth),
  ).toBe(true);
  await page.screenshot({ path: "plan/gallery-history-mobile.png" });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByTestId("version-branch-1").click();
  await expect(page.getByTestId("version-history-dialog")).toHaveCount(0);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab").nth(1)).toContainText("branch v1");
  await expect(page.getByTestId("active-instance-count")).toHaveText("3");
  const branched = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(branched.id).not.toBe(before.id);
  expect(
    (branched as CircuitProject).documents[0]!.instances.map(
      (item) => item.reference,
    ),
  ).toEqual(["R1", "R2", "R3"]);
  expect(branched.documents[0]!.instances[0]!.netlist!.parameters.value).toBe(
    "1k",
  );
  await page.getByTestId("publish-gallery-button").click();
  await expect(page.getByTestId("publish-history")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Update entry", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Cancel", exact: true })
    .click();
  await page.keyboard.press("ControlOrMeta+s");
  await expect.poll(() => cloudWrites.length).toBe(1);
  expect(cloudWrites[0]!.method).toBe("POST");
  expect(parseProject(cloudWrites[0]!.projectText).id).toBe(branched.id);
  await page.getByRole("tab").first().click();
  await expect(page.getByTestId("hit-R4")).toBeVisible();
  await page.getByTestId("publish-gallery-button").click();
  await expect(page.getByTestId("publish-history")).toBeVisible();
  expect(writes).toEqual([]);
});

test("Gallery historical branch link creates an independent project and unavailable snapshots explain the error", async ({
  page,
}) => {
  const project = galleryResistorProject("47k", 1);
  await page.route("**/api/gallery/entry/versions/v1/project", (route) =>
    route.fulfill({ json: { projectText: serializeProject(project) } }),
  );
  await page.goto("/editor?history=entry&version=v1&versionNo=1");
  await awaitEditorReady(page);
  await expect(page.getByRole("tab").last()).toContainText("branch v1");
  await expect(page.getByTestId("active-instance-count")).toHaveText("1");
  const branch = parseSavedProject(
    (await downloadBytes(page, "File", "Export Project File…")).toString(
      "utf8",
    ),
  );
  expect(branch.id).not.toBe(project.id);
  expect(branch.documents[0]!.instances[0]!.netlist!.parameters.value).toBe(
    "47k",
  );
  await page.route("**/api/gallery/entry/versions/missing/project", (route) =>
    route.fulfill({ status: 404, json: { error: "not-found" } }),
  );
  page.on("dialog", (dialog) => dialog.accept());
  // Navigation does not await the async workspace boot or its history fetch.
  // Start the error-UI assertion only after the mocked failure was delivered;
  // retain its normal timeout and assert the actual HTTP boundary as well.
  const unavailable = page.waitForResponse(
    (response) =>
      new URL(response.url()).pathname ===
      "/api/gallery/entry/versions/missing/project",
  );
  await page.goto("/editor?history=entry&version=missing&versionNo=1");
  const response = await unavailable;
  expect(response.status()).toBe(404);
  await response.finished();
  await expect(page.getByTestId("status")).toContainText(
    "snapshot is unavailable",
  );
});

test("Shelf save history compares, branches privately and restores with the listed revision", async ({
  page,
}) => {
  const before = galleryResistorProject("1k");
  const after = galleryResistorProject("2k");
  const summary = {
    id: "draft",
    name: "Private amplifier",
    revision: 4,
    updatedAt: "2026-09-21T08:00:00Z",
    schemaVersion: CURRENT_PROJECT_FILE_VERSION,
  };
  let branch: { projectText: string; galleryEntryId?: string } | undefined;
  let restored = false;
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "owner",
          displayName: "Author",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  await mockGallery(page, []);
  await page.route("**/api/projects**", (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname;
    if (path.endsWith("/preview.svg"))
      return route.fulfill({
        contentType: "image/svg+xml",
        body: '<svg xmlns="http://www.w3.org/2000/svg"/>',
      });
    if (path.endsWith("/restore")) {
      expect(req.headers()["if-match"]).toBe("revision-4");
      restored = true;
      return route.fulfill({ json: { project: { ...summary, revision: 5 } } });
    }
    if (path.endsWith("/versions"))
      return route.fulfill({
        json: {
          revision: 4,
          versions: [
            {
              versionId: "draft:3",
              versionNo: 3,
              name: "Earlier amplifier",
              author: "",
              tags: [],
              createdAt: summary.updatedAt,
            },
          ],
        },
      });
    if (path.endsWith("/project"))
      return route.fulfill({ json: { projectText: serializeProject(before) } });
    if (req.method() === "POST") {
      branch = req.postDataJSON();
      return route.fulfill({
        status: 201,
        json: { project: { ...summary, id: "branch", revision: 1 } },
      });
    }
    return route.fulfill({
      json:
        path === "/api/projects"
          ? { projects: [summary] }
          : { project: { ...summary, projectText: serializeProject(after) } },
    });
  });
  await page.goto("/?view=shelf");
  const openHistory = async () => {
    await page.getByTestId("shelf-actions-draft").click();
    await page.getByRole("menuitem", { name: "Version history" }).click();
    await expect(page.getByTestId("version-history-dialog")).toContainText(
      "current draft kept separately",
    );
  };
  await openHistory();
  await page.getByTestId("version-compare-3").click();
  await expect(page.getByTestId("version-comparison")).toContainText(
    "2 modified",
  );
  await page.getByTestId("version-branch-3").click();
  await expect(page.getByTestId("version-history-dialog")).toHaveCount(0);
  expect(branch?.galleryEntryId).toBeUndefined();
  expect(parseProject(branch!.projectText).id).not.toBe(before.id);
  await openHistory();
  await page.getByTestId("version-restore-3").click();
  await expect(page.getByTestId("version-history-dialog")).toHaveCount(0);
  expect(restored).toBe(true);
});
