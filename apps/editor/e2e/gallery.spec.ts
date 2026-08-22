import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

const ENTRY = {
  id: "g-ring",
  name: "Ring Oscillator",
  author: "tz",
  description: "Three-stage loop",
  createdAt: "2026-08-21T10:00:00.000Z",
  schemaVersion: 21,
};

async function mockGallery(page: Page, entries: object[]): Promise<void> {
  await page.route("**/api/gallery", (route) =>
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

test("masonry places the top row left-to-right in distinct columns", async ({
  page,
}) => {
  const entries = ["m-a", "m-b", "m-c"].map((id, index) => ({
    id,
    name: `Circuit ${id}`,
    author: "tz",
    description: index === 0 ? "taller card" : "",
    createdAt: "2026-08-22T10:00:00.000Z",
    schemaVersion: 21,
  }));
  await page.route("**/api/gallery", (route) =>
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
          schemaVersion: 21,
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
  expect(listRequests.filter((query) => query === "?cursor=c1")).toHaveLength(
    1,
  );
  expect(
    listRequests.every((query) => query === "" || query === "?cursor=c1"),
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
    schemaVersion: 21,
  }));
  await page.route("**/api/gallery", (route) =>
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
        schemaVersion: 21,
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
              schemaVersion: 21,
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
        schemaVersion: 21,
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
  await page.route("**/api/gallery/review", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  let restored = 0;
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

  await page.goto("/review");
  await expect(page.getByTestId("bin-card-bin-1")).toBeVisible();
  await page.getByTestId("bin-restore-bin-1").click();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  expect(restored).toBe(1);
});

test("falls back to bundled tiles when the gallery is empty or unreachable", async ({
  page,
}) => {
  await page.route("**/api/gallery", (route) =>
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
  await expect(page.locator(".app-brand-copy p")).toContainText(ENTRY.name);

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

  await page.getByTestId("account-signout").click();
  await expect(page.getByTestId("account-signin")).toBeVisible();
  expect(loggedOut).toBe(1);
});

test("the Publish button posts the live Project with the passphrase", async ({
  page,
}) => {
  const posted: { authorization: string | null; body: string }[] = [];
  // The real submissions endpoint is /api/gallery/submissions — the mock
  // matches it exactly so a client posting anywhere else fails this test.
  await page.route("**/api/gallery", (route) =>
    route.fulfill({ json: { entries: [], nextCursor: null } }),
  );
  await page.route("**/api/gallery/submissions", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    posted.push({
      authorization: route.request().headers()["authorization"] ?? null,
      body: route.request().postData() ?? "",
    });
    return route.fulfill({ status: 201, json: { id: "entry-99" } });
  });

  await page.goto("/editor");
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();

  await dialog.getByLabel("Circuit name").fill("Publish Demo");
  await dialog.getByLabel("Author").fill("Vivian");
  const publish = dialog.getByRole("button", { name: "Publish" });
  await expect(publish).toBeDisabled();
  await dialog.getByLabel("Owner passphrase").fill("secret-token");
  await publish.click();

  await expect(page.getByTestId("status")).toHaveText(
    'Published "Publish Demo" to the gallery',
  );
  expect(posted).toHaveLength(1);
  const request = posted[0]!;
  expect(request.authorization).toBe("Bearer secret-token");
  const body = JSON.parse(request.body) as {
    name: string;
    author: string;
    projectText: string;
  };
  expect(body.name).toBe("Publish Demo");
  expect(body.author).toBe("Vivian");
  expect(JSON.parse(body.projectText).schemaVersion).toBe(ENTRY.schemaVersion);

  // The passphrase is remembered for the session and offered on reopen.
  await page.getByTestId("publish-gallery-button").click();
  await expect(
    page.getByTestId("publish-gallery-dialog").getByLabel("Owner passphrase"),
  ).toHaveValue("secret-token");
});

test("an admin session publishes without the passphrase row", async ({
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
    author: string;
    tags: string[];
  }[] = [];
  await page.route("**/api/gallery/submissions", (route) => {
    const body = route.request().postDataJSON() as {
      author: string;
      tags: string[];
    };
    posted.push({
      authorization: route.request().headers()["authorization"] ?? null,
      author: body.author,
      tags: body.tags,
    });
    return route.fulfill({ status: 201, json: { id: "entry-77" } });
  });

  await page.goto("/editor");
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText("Signed in as Token Zhang")).toBeVisible();
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  // The account display name prefills the author byline.
  await expect(dialog.getByLabel("Author")).toHaveValue("Token Zhang");

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
      author: "Token Zhang",
      tags: ["amplifier", "latch"],
    },
  ]);
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
  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();

  // The empty canvas fails the content gate, evaluated locally.
  const gates = page.getByTestId("publish-gallery-gates");
  await expect(gates).toBeVisible();
  await expect(gates).toContainText("Fix these before submitting");
  await expect(gates).toContainText("Too little content");
  await expect(dialog.getByLabel("Owner passphrase")).toHaveCount(0);
  await expect(
    dialog.getByRole("button", { name: "Submit for review" }),
  ).toBeDisabled();
});

test("a reviewer approves a pending submission from the review queue", async ({
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
  await page.route("**/api/gallery/review", (route) =>
    route.fulfill({
      json: {
        entries: [
          {
            id: "p-1",
            name: "Pending Filter",
            author: "maker",
            description: "Second-order RC",
            createdAt: "2026-08-22T09:00:00.000Z",
          },
        ],
      },
    }),
  );
  await page.route("**/api/gallery/p-1/preview.svg", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#fff"/></svg>',
    }),
  );
  const decisions: string[] = [];
  await page.route("**/api/gallery/p-1/approve", (route) => {
    decisions.push("approve");
    return route.fulfill({ json: { id: "p-1", status: "public" } });
  });

  await page.goto("/review");
  const card = page.getByTestId("review-card-p-1");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Pending Filter");
  await card.getByTestId("review-approve-p-1").click();
  await expect(page.getByTestId("review-empty")).toBeVisible();
  expect(decisions).toEqual(["approve"]);
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
  await expect(page.getByTestId("mine-edit-mine-2")).toHaveAttribute(
    "href",
    "/g/mine-2",
  );
  await expect(page.getByTestId("mine-status-mine-2")).toHaveText("Published");
});

test("an opened gallery entry offers updating in place", async ({ page }) => {
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
  await expect(page.getByTestId("publish-mode")).toBeVisible();
  // The update option names exactly what it will replace.
  await expect(page.getByTestId("publish-mode")).toContainText(ENTRY.name);
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
  await expect(page.getByTestId("version-2")).toContainText(
    "Ring Oscillator (older)",
  );
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
  await expect(page.getByTestId("status")).toContainText(
    "Opened fresh.icproj.json",
  );

  await page.getByTestId("publish-gallery-button").click();
  const dialog = page.getByTestId("publish-gallery-dialog");
  await expect(dialog).toBeVisible();
  await expect(page.getByTestId("publish-mode")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Publish" })).toBeVisible();
});

test("the Examples panel lists the gallery and opens an entry", async ({
  page,
}) => {
  await mockGallery(page, [ENTRY]);
  await page.route("**/api/gallery?limit=60", (route) =>
    route.fulfill({ json: { entries: [ENTRY], nextCursor: null } }),
  );

  await page.goto("/editor");
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
  await expect(page.getByTestId("status")).toContainText(
    `Opened gallery circuit: ${ENTRY.name}`,
  );
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
