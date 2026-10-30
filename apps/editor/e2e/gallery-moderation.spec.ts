// Moderation: rejecting and withdrawing entries, the recycle bin, moderation
// collections and pending visual reviews. A member's own withdrawal is in
// gallery-account.spec.ts; the page holding no maintenance forms is the
// ModerationContent module test.

import { expect, test } from "./gallery-test.js";
import {
  ENTRY,
  mockGallery,
  mockGalleryApi,
  mockPreviews,
  mockProviders,
  sessionUser,
  signIn,
} from "./gallery-fixtures.js";

const OWNER = sessionUser({
  id: "owner-1",
  displayName: "Owner",
  email: "owner@example.com",
  isAdmin: true,
});

test("the Owner withdraws an entry from its tile menu and rejects another with an author-visible reason", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 500 });
  let sessionRequests = 0;
  await mockProviders(page, { github: true, google: false, email: false });
  await page.route("**/api/auth/me", (route) => {
    sessionRequests += 1;
    return route.fulfill({ json: { user: OWNER } });
  });
  const other = { ...ENTRY, id: "g-other", name: "Other circuit" };
  await mockGallery(page, [ENTRY, other]);
  await mockPreviews(page);
  const calls: string[] = [];
  let rejectReason = "";
  let rejectNotify: boolean | undefined;
  await page.route("**/api/gallery/*/{recycle,reject}", async (route) => {
    const [, , , id, action] = new URL(route.request().url()).pathname.split(
      "/",
    );
    calls.push(`${action} ${id}`);
    if (action === "reject") {
      const body = route.request().postDataJSON() as {
        reason: string;
        notify?: boolean;
      };
      rejectReason = body.reason;
      rejectNotify = body.notify;
      return route.fulfill({
        json: { id, status: "rejected", emailed: body.notify === true },
      });
    }
    await route.fulfill({ json: { id } });
  });

  await page.goto("/");
  const menu = page.getByTestId(`gallery-owner-menu-${ENTRY.id}`);
  await expect(menu).toBeVisible();
  expect(sessionRequests).toBe(1);
  // On a phone the menu stays inside the window.
  await menu.locator("summary").click();
  await expect
    .poll(async () =>
      menu.locator(".gallery-owner-popover").evaluate((popover) => {
        const rect = popover.getBoundingClientRect();
        return (
          rect.left >= 0 &&
          rect.right <= innerWidth &&
          rect.top >= 0 &&
          rect.bottom <= innerHeight
        );
      }),
    )
    .toBe(true);
  await expect(
    page.getByTestId(`gallery-owner-edit-${ENTRY.id}`),
  ).toHaveAttribute("href", `/g/${ENTRY.id}`);
  // Withdrawing is undone from the recycle bin, so it asks nothing more.
  await page.getByTestId(`gallery-owner-withdraw-${ENTRY.id}`).click();
  await expect(page.getByTestId(`gallery-tile-${ENTRY.id}`)).toHaveCount(0);
  await expect(page.getByTestId("gallery-owner-notice")).toContainText(
    "recycle bin",
  );

  // Rejection is a direct card action, beside the management menu.
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.getByTestId(`gallery-owner-reject-${other.id}`).click();
  const confirm = page.getByTestId("gallery-owner-reject-confirm");
  const note = page.getByTestId("gallery-owner-reject-note");
  await expect(confirm).toBeDisabled();
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
  await note.fill("Other reason");
  await expect(confirm).toBeEnabled();
  await note.fill("");
  await expect(confirm).toBeDisabled();

  await page.getByTestId("gallery-owner-reject-option-too-ugly").check();
  await page
    .getByTestId("gallery-owner-reject-option-circuit-incorrect")
    .check();
  await expect(confirm).toBeEnabled();
  await note.fill("Label the ports and remove the loose wire.");
  await confirm.click();

  await expect(page.getByTestId(`gallery-tile-${other.id}`)).toHaveCount(0);
  // The author is emailed the reason unless the box is cleared.
  await expect(page.getByTestId("gallery-owner-notice")).toContainText(
    "its author was emailed the reason",
  );
  expect(rejectNotify).toBe(true);
  expect(rejectReason).toBe(
    "too ugly; circuit incorrect — Note: Label the ports and remove the loose wire.",
  );
  expect(calls).toEqual([`recycle ${ENTRY.id}`, `reject ${other.id}`]);
});

test("the Owner restores, recycles or deletes rejected and binned work in one click each", async ({
  page,
}) => {
  await signIn(page, OWNER);
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
  let recycled = [
    { id: "bin-1", name: "Old Sketch", recycledAt: "2026-08-22T08:00:00.000Z" },
  ];
  const calls: string[] = [];
  await page.route("**/api/gallery/rejected", (route) =>
    route.fulfill({ json: { entries: rejected } }),
  );
  await page.route("**/api/gallery/recycled", (route) =>
    route.fulfill({ json: { entries: recycled } }),
  );
  await page.route(
    /\/api\/gallery\/[\w-]+(\/(restore|recycle))?$/u,
    (route) => {
      if (route.request().method() === "GET") return route.fallback();
      const [, , , id, action] = new URL(route.request().url()).pathname.split(
        "/",
      );
      calls.push(`${action ?? route.request().method()} ${id}`);
      rejected = rejected.filter((entry) => entry.id !== id);
      if (action === "recycle")
        recycled = [
          { id: id!, name: "Spam", recycledAt: "2026-08-22T10:00:00.000Z" },
        ];
      else recycled = recycled.filter((entry) => entry.id !== id);
      return route.fulfill({ json: { id, status: action ?? "deleted" } });
    },
  );

  await page.goto("/moderation");
  // The bin restores what was recycled.
  await expect(page.getByTestId("bin-card-bin-1")).toBeVisible();
  await page.getByTestId("bin-restore-bin-1").click();
  await expect(page.getByTestId("bin-empty")).toBeVisible();

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

  // The server deletes only from the bin, so Delete on a rejected circuit
  // moves it there and deletes it, in the one click.
  await page.getByTestId("rejected-delete-rejected-gone").click();
  await expect(page.getByTestId("rejected-card-rejected-gone")).toHaveCount(0);
  await expect(page.getByTestId("bin-card-rejected-gone")).toHaveCount(0);

  await page.getByTestId("rejected-recycle-rejected-delete").click();
  await expect(page.getByTestId("rejected-empty")).toBeVisible();
  await expect(page.getByTestId("bin-card-rejected-delete")).toBeVisible();

  // Deleting from the bin asks nothing more: the click is the decision.
  await page.getByTestId("bin-delete-rejected-delete").click();
  await expect(page.getByTestId("bin-empty")).toBeVisible();
  expect(calls).toEqual([
    "restore bin-1",
    "restore rejected-restore",
    "recycle rejected-gone",
    "DELETE rejected-gone",
    "recycle rejected-delete",
    "DELETE rejected-delete",
  ]);
});

test("moderation uses full-width responsive masonry and keyboard-accessible card actions", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await signIn(page, OWNER);
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
  await signIn(page, OWNER);
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
  await signIn(page, sessionUser({ id: "maker-1", displayName: "Maker" }));
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
        { kind: "global-vdd", detail: ".global VDD in the netlist" },
      ],
    },
    assessedPreviewRevision: ENTRY.previewRevision,
  };
  await mockPreviews(page);
  const tags = [{ tag: "amplifier", count: 1 }];
  await mockGalleryApi(page, { tags }, async (url, route) => {
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
  });
  await page.route(
    (url) => url.pathname === "/api/gallery/review-me/curation",
    (route) => {
      const body = route.request().postDataJSON();
      expect(body.expectedCurationRevision).toBe(1);
      expect(body.expectedPreviewRevision).toBe(ENTRY.previewRevision);
      entry = { ...entry, attention: body.attention, curationRevision: 2 };
      return route.fulfill({ json: { entry } });
    },
  );
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
  // Each finding is listed under its reason.
  const review = page.getByTestId("gallery-attention-review-me");
  await expect(review).toContainText("Needs attention");
  await expect(review).toContainText(
    "Wiring break · Output wire has a visible gap",
  );
  await expect(review).toContainText("Global VDD · .global VDD");
  await review.getByRole("button", { name: "Mark resolved" }).click();
  await expect(page.getByTestId("gallery-tile-review-me")).toHaveCount(0);
  await expect(review).toContainText("Reviewed · resolved");
  await page.keyboard.press("Escape");
  await expect(review).toHaveCount(0);
  await page.getByTestId("gallery-filter-attention").click();
  await openReview();
  await expect(review).toContainText("Reviewed · resolved");
});
