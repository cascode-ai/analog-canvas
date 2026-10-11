// Moderation: rejecting and withdrawing entries, the recycle bin, moderation
// collections and pending visual reviews.

import { expect, test } from "./gallery-test.js";
import { ENTRY, mockGallery } from "./gallery-fixtures.js";

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
  await page.setViewportSize({ width: 360, height: 500 });
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
  await expect
    .poll(async () =>
      page.locator(".gallery-owner-popover").evaluate((menu) => {
        const rect = menu.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  // Withdrawing is undone from the recycle bin, so it asks nothing more.
  await page.getByTestId(`gallery-owner-withdraw-${ENTRY.id}`).click();

  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toHaveCount(0);
  await expect(page.getByTestId("gallery-owner-notice")).toContainText(
    "recycle bin",
  );
  expect(withdrawn).toBe(1);
});

test("a member withdraws their own entry from its tile, and only their own", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "member-1",
          displayName: "Member",
          email: "member@example.com",
          provider: "github",
          role: "user",
          isAdmin: false,
        },
      },
    }),
  );
  const mine = { ...ENTRY, ownerUserId: "member-1" };
  const theirs = {
    ...ENTRY,
    id: "g-other",
    name: "Someone else's",
    ownerUserId: "member-2",
  };
  await mockGallery(page, [mine, theirs]);
  let withdrawn = 0;
  await page.route(`**/api/gallery/${mine.id}/recycle`, (route) => {
    withdrawn += 1;
    return route.fulfill({ json: { id: mine.id, status: "recycled" } });
  });

  await page.goto("/");
  await expect(page.getByTestId(`gallery-tile-${theirs.id}`)).toBeVisible();
  await expect(
    page.getByTestId(`gallery-author-menu-${theirs.id}`),
  ).toHaveCount(0);
  await expect(page.getByTestId(`gallery-owner-reject-${mine.id}`)).toHaveCount(
    0,
  );
  await page
    .getByTestId(`gallery-author-menu-${mine.id}`)
    .getByLabel(`Manage ${mine.name}`)
    .click();
  await page.getByTestId(`gallery-author-withdraw-${mine.id}`).click();

  await expect(page.getByTestId(`gallery-tile-${mine.id}`)).toHaveCount(0);
  await expect(page.getByTestId(`gallery-tile-${theirs.id}`)).toBeVisible();
  await expect(page.getByTestId("gallery-owner-notice")).toContainText(
    "Restore it from My submissions",
  );
  expect(withdrawn).toBe(1);
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

test("the Owner restores, recycles or deletes rejected work in one click each", async ({
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
    {
      id: "rejected-gone",
      name: "More spam",
      rejectReason: "Not a circuit",
      reviewedAt: "2026-08-22T07:00:00.000Z",
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
  // The server deletes only from the bin, so Delete on a rejected circuit
  // moves it there and deletes it, in the one click.
  const gone: string[] = [];
  await page.route("**/api/gallery/rejected-gone/recycle", (route) => {
    gone.push("recycle");
    rejected = rejected.filter((entry) => entry.id !== "rejected-gone");
    return route.fulfill({ json: { id: "rejected-gone", status: "recycled" } });
  });
  await page.route("**/api/gallery/rejected-gone", (route) => {
    gone.push(route.request().method());
    return route.fulfill({ json: { id: "rejected-gone", deleted: true } });
  });

  await page.goto("/moderation");
  await expect(
    page.getByTestId("rejected-card-rejected-restore"),
  ).toContainText("Remove the loose wire");
  await expect(
    page.getByTestId("rejected-open-rejected-restore"),
  ).toHaveAttribute("href", "/g/rejected-restore");
  await page.getByTestId("rejected-restore-rejected-restore").click();
  await expect(page.getByTestId("rejected-card-rejected-restore")).toHaveCount(
    0,
  );

  await page.getByTestId("rejected-delete-rejected-gone").click();
  await expect(page.getByTestId("rejected-card-rejected-gone")).toHaveCount(0);
  await expect(page.getByTestId("bin-card-rejected-gone")).toHaveCount(0);
  expect(gone).toEqual(["recycle", "DELETE"]);

  await page.getByTestId("rejected-recycle-rejected-delete").click();
  await expect(page.getByTestId("rejected-empty")).toBeVisible();
  await expect(page.getByTestId("bin-card-rejected-delete")).toBeVisible();

  // Deleting from the bin asks nothing more: the click is the decision.
  await page.getByTestId("bin-delete-rejected-delete").click();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  expect(deleted).toBe(1);
});

test("post-publication moderation contains collections without operational maintenance forms", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Owner",
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
  const maintenance: string[] = [];
  page.on("request", (request) => {
    if (/\/maintenance\/|\/auth\/users\/role/.test(request.url()))
      maintenance.push(request.url());
  });
  await page.goto("/moderation");
  await expect(page.getByTestId("moderation")).toBeVisible();
  await expect(page.getByTestId("rejected-empty")).toBeVisible();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  await expect(page.getByTestId("owner-settings")).toHaveCount(0);
  await expect(page.getByRole("textbox")).toHaveCount(0);
  await expect(page.getByText("Project schema maintenance")).toHaveCount(0);
  await expect(page.getByText("Netlist marks", { exact: true })).toHaveCount(0);
  await expect(page.getByTestId("review-empty")).toHaveCount(0);
  expect(maintenance).toEqual([]);
});

test("moderation uses full-width responsive masonry and keyboard-accessible card actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Owner",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  const entries = Array.from({ length: 12 }, (_, index) => ({
    ...ENTRY,
    id: `review-${index}`,
    name: `Amplifier ${index}`,
    rejectReason:
      index % 2
        ? "Check the output connection."
        : "Two overlapping transistors near the output. Verify the intended topology before restoring this circuit.",
    previewWidth: 400,
    previewHeight: index % 3 ? 240 : 400,
  }));
  await page.route("**/api/gallery/rejected", (route) =>
    route.fulfill({ json: { entries } }),
  );
  await page.route("**/api/gallery/recycled", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.route("**/preview.svg*", (route) =>
    route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 240"><path d="M20 120h80l20 -25 30 50 30 -50 30 50 20 -25h140" stroke="black" fill="none"/></svg>',
    }),
  );
  await page.goto("/moderation");
  const cards = page.locator('[data-testid^="rejected-card-"]');
  await expect(cards).toHaveCount(12);
  const masonry = page.getByLabel("Rejected circuits");
  await expect
    .poll(async () => (await masonry.boundingBox())!.width)
    .toBeGreaterThan(1500);
  const columns = () =>
    cards.evaluateAll(
      (nodes) =>
        new Set(nodes.map((node) => Math.round(node.getBoundingClientRect().x)))
          .size,
    );
  await expect.poll(columns).toBe(5);
  await expect(page.getByText("Edit and replace", { exact: true })).toHaveCount(
    0,
  );
  await expect(page.getByTestId("rejected-open-review-0")).toHaveAttribute(
    "href",
    "/g/review-0",
  );
  // Every action is a button in view, in one row, reached with Tab.
  const actions = ["restore", "recycle", "delete"].map((action) =>
    page.getByTestId(`rejected-${action}-review-0`),
  );
  await actions[0]!.focus();
  for (const next of actions.slice(1)) {
    await page.keyboard.press("Tab");
    await expect(next).toBeFocused();
  }
  const tops = await Promise.all(
    actions.map(async (action) => (await action.boundingBox())!.y),
  );
  expect(Math.max(...tops) - Math.min(...tops)).toBeLessThanOrEqual(1);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect.poll(columns).toBe(1);
  const last = await actions[2]!.boundingBox();
  expect(last!.x + last!.width).toBeLessThanOrEqual(390);
  await expect
    .poll(() =>
      page
        .locator(".review-shell")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    )
    .toBe(true);
});

test("moderation keeps failed actions visible and retries collection loading", async ({
  page,
}) => {
  await page.route("**/api/auth/me", (route) =>
    route.fulfill({
      json: {
        user: {
          id: "u1",
          displayName: "Owner",
          provider: "github",
          role: "user",
          isAdmin: true,
        },
      },
    }),
  );
  let loadFailed = true;
  let restoreFailed = true;
  let restored = false;
  await page.route("**/api/gallery/rejected", (route) =>
    loadFailed
      ? route.fulfill({ status: 503, json: {} })
      : route.fulfill({
          json: { entries: restored ? [] : [{ ...ENTRY, id: "retry-entry" }] },
        }),
  );
  await page.route("**/api/gallery/recycled", (route) =>
    route.fulfill({ json: { entries: [] } }),
  );
  await page.route("**/api/gallery/retry-entry/restore", (route) => {
    if (restoreFailed) return route.fulfill({ status: 503, json: {} });
    restored = true;
    return route.fulfill({ json: { id: "retry-entry", status: "public" } });
  });
  await page.goto("/moderation");
  await expect(page.getByRole("alert")).toContainText(
    "Could not load rejected entries",
  );
  await expect(page.getByTestId("rejected-empty")).toHaveCount(0);
  loadFailed = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  const card = page.getByTestId("rejected-card-retry-entry");
  await expect(card).toBeVisible();
  await page.getByTestId("rejected-restore-retry-entry").click();
  await expect(card.getByRole("alert")).toContainText("Please try again");
  restoreFailed = false;
  await page.getByTestId("rejected-restore-retry-entry").click();
  await expect(page.getByTestId("rejected-empty")).toBeVisible();
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
  // The tile looks as it does to everyone; its review opens from its menu.
  await expect(page.getByTestId("gallery-attention-review-me")).toHaveCount(0);
  await page.getByTestId("gallery-filter-attention").click();
  await expect(page).toHaveURL(/attention=1/);
  const openReview = async () => {
    await page
      .getByTestId("gallery-author-menu-review-me")
      .locator("summary")
      .click();
    await page.getByTestId("gallery-author-review-review-me").click();
  };
  await openReview();
  const review = page.getByTestId("gallery-attention-review-me");
  await expect(review).toContainText("Needs attention");
  await expect(review).toContainText("Output wire has a visible gap");
  await review.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByTestId("gallery-tile-review-me")).toHaveCount(0);
  await expect(review).toContainText("Reviewed · resolved");
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await page.getByTestId("gallery-filter-attention").click();
  await openReview();
  await expect(review).toContainText("Reviewed · resolved");
});
