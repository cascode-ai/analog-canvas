import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  createEmptyDocument,
  createEmptyProject,
  CURRENT_PROJECT_SCHEMA_VERSION,
} from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { hierarchicalSymbolId } from "@icm/symbols";

import { chooseComponent, clickCommand } from "./editor-fixtures.js";

const ENTRY = {
  id: "g-ring",
  name: "Ring Oscillator",
  author: "tz",
  description: "Three-stage loop",
  createdAt: "2026-08-21T10:00:00.000Z",
  schemaVersion: 23,
};

/** Match the list path with or without filters and a paging cursor. */
const galleryListUrl = (url: URL): boolean => url.pathname === "/api/gallery";

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
      netlist: { reference: "R1", parameters: {} },
    },
    {
      id: "R2",
      symbolId: "resistor",
      placement: {
        position: { x: 200, y: 0 },
        rotation: 0,
        mirror: "none",
      },
      netlist: { reference: "R2", parameters: {} },
    },
    {
      id: "XU0",
      symbolId: hierarchicalSymbolId(child.netlist!.name),
      placement: {
        position: { x: 100, y: 120 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        reference: "XU0",
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
  await page.route(`**/api/gallery/${ENTRY.id}/preview.svg`, (route) =>
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

test("the site lands on the full-screen gallery feed", async ({ page }) => {
  await mockGallery(page, [ENTRY]);
  await page.goto("/");
  const feed = page.getByTestId("gallery-feed");
  await expect(feed).toBeVisible();
  const brand = page.getByTestId("gallery-editor-link");
  await expect(brand).toHaveCSS("display", "flex");
  await expect(brand).toHaveCSS("text-decoration-line", "none");
  await expect(brand.locator(".app-brand-mark")).toBeVisible();

  // With community entries present the wall shows them alone: the bundled
  // starter tiles exist only while the gallery is empty.
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toBeVisible();
  await expect(
    page.getByTestId("gallery-bundled-common-source-amplifier"),
  ).toHaveCount(0);
  await expect(page.getByTestId("gallery-new-circuit")).toHaveAttribute(
    "href",
    "/editor",
  );
});

test("the Owner rejects a Gallery entry with an author-visible reason", async ({
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
  let rejectReason = "";
  await page.route(`**/api/gallery/${ENTRY.id}/reject`, async (route) => {
    rejectReason = (route.request().postDataJSON() as { reason: string })
      .reason;
    await route.fulfill({ json: { id: ENTRY.id, status: "rejected" } });
  });

  await page.goto("/");
  const menu = page.getByTestId(`gallery-owner-menu-${ENTRY.id}`);
  await expect(menu).toBeVisible();
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
  await page.getByTestId("gallery-tag-option-amplifier").click();
  await expect(page.getByTestId("gallery-tile-t-pll")).toHaveCount(0);
  await page.getByTestId("gallery-tag-option-adc").click();
  await expect(page).toHaveURL(/tags=amplifier%2Cadc|tags=amplifier,adc/);
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
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
  // The circuit name is an editable field now, so it is read as a value.
  await expect(page.getByTestId("project-name-input")).toHaveValue(ENTRY.name);

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
          isAdmin: true,
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
      schemaVersion: CURRENT_PROJECT_SCHEMA_VERSION,
    },
  ]);
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

test("Check and Save shelves the circuit and the shelf reopens it", async ({
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
          isAdmin: false,
        },
      },
    }),
  );
  const shelf: { id: string; name: string; projectText: string }[] = [];
  await page.route("**/api/workspace/recent", (route) => {
    if (route.request().method() === "POST") {
      const body = route.request().postDataJSON() as {
        name: string;
        projectText: string;
      };
      // The server keeps the newest three; the client only has to send.
      shelf.unshift({ id: `slot-${shelf.length}`, ...body });
      return route.fulfill({
        json: {
          slots: shelf.slice(0, 3).map((slot) => ({
            id: slot.id,
            name: slot.name,
            savedAt: "2026-08-23T00:00:00.000Z",
            schemaVersion: ENTRY.schemaVersion,
          })),
        },
      });
    }
    return route.fulfill({ json: { slots: [] } });
  });
  await page.route("**/api/workspace/recent/*", (route) => {
    const id = new URL(route.request().url()).pathname.split("/").pop();
    const slot = shelf.find((candidate) => candidate.id === id);
    return slot
      ? route.fulfill({
          json: { name: slot.name, projectText: slot.projectText },
        })
      : route.fulfill({ status: 404, json: { error: "not-found" } });
  });

  await page.goto("/editor");
  await chooseComponent(page, "nmos");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 280 } });
  await page.keyboard.press("Escape");
  await page.getByTestId("check-and-save-button").click();

  // A lone transistor is not a netlistable circuit, and that is not an error:
  // a schematic is allowed to be abbreviated. Saving neither judges it nor
  // interrupts with a report.
  await expect(page.getByTestId("status")).toContainText("to your shelf");
  await expect(page.getByRole("dialog", { name: "Check Report" })).toHaveCount(
    0,
  );
  expect(shelf).toHaveLength(1);
  expect(shelf[0]!.projectText).toContain("nmos");

  // And it comes back: the shelved circuit is listed under File and reopens.
  await clickCommand(page, "File", shelf[0]!.name);
  await expect(page.getByTestId("status")).toContainText("Opened");
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

test("stars the circuits that extract and counts thumbs on every card", async ({
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
  // The star marks the one that extracts. The other is on the wall all the
  // same — a schematic is allowed to be abbreviated.
  await expect(
    page.getByTestId(`gallery-star-${extractable.id}`),
  ).toBeVisible();
  await expect(page.getByTestId(`gallery-star-${sketch.id}`)).toHaveCount(0);
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

  // The empty canvas fails the content gate, evaluated locally.
  const gates = page.getByTestId("publish-gallery-gates");
  await expect(gates).toBeVisible();
  await expect(gates).toContainText("Fix these before publishing");
  await expect(gates).toContainText("Too little content");
  await expect(gates).toHaveCSS("border-top-color", "rgb(235, 87, 87)");
  await expect(gates).toHaveCSS("background-color", "rgba(235, 87, 87, 0.08)");
  const tags = dialog.getByTestId("publish-tags");
  await expect(tags).toHaveCSS("display", "flex");
  await expect(tags).toHaveCSS("flex-direction", "column");
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  // The gates still hold, but the button says what actually happens next.
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeDisabled();
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
            workspace_slots: {
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
  await chooseComponent(page, "resistor");
  await page
    .getByTestId("schematic-canvas")
    .click({ position: { x: 360, y: 230 } });
  await page.keyboard.press("Escape");
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
    name: "Protect the current Project",
  });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel (keep editing)" }).click();
  await expect(page.getByTestId("hit-R1")).toHaveCount(1);

  await card.click();
  await dialog.getByRole("button", { name: "Discard and continue" }).click();
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
  for (const rail of await tileRails.all()) {
    await expect(rail).toHaveAttribute("stroke-width", "3.24");
  }
  await expect(
    tile.locator(
      '[data-layer="junctions"] circle[cx="380"][cy="160"], [data-layer="junctions"] circle[cx="500"][cy="160"]',
    ),
  ).toHaveCount(0);

  await tile.click();
  await expect(page).toHaveURL(
    /\/editor\?example=current-mirror-loaded-differential-pair$/,
  );
  const canvasRails = page.locator(
    '[data-testid="schematic-canvas"] [data-route-presentation="power-rail"]',
  );
  await expect(canvasRails).toHaveCount(3);
  for (const rail of await canvasRails.all()) {
    await expect(rail).toHaveAttribute("stroke-width", "3.24");
  }
  await expect(
    page.locator(
      '[data-testid="schematic-canvas"] [data-layer="junctions"] circle[cx="380"][cy="160"], [data-testid="schematic-canvas"] [data-layer="junctions"] circle[cx="500"][cy="160"]',
    ),
  ).toHaveCount(0);
});
