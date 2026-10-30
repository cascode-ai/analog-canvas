import { expect, test } from "./gallery-test.js";
import { openEditor } from "./editor-fixtures.js";
import {
  ENTRY,
  mockGalleryApi,
  mockPreviews,
  sessionUser,
  signIn,
} from "./gallery-fixtures.js";

test("Shelf export preserves each load failure without downloading", async ({
  page,
}) => {
  await signIn(page, sessionUser());
  await mockPreviews(page);
  await page.route("**/api/projects", (route) =>
    route.fulfill({
      json: {
        projects: [
          {
            id: "p1",
            name: "Saved",
            updatedAt: "2026-10-01T00:00:00Z",
            revision: 1,
            schemaVersion: 33,
          },
        ],
      },
    }),
  );
  let refusal = { status: 401, body: {} as object };
  await page.route("**/api/projects/p1", (route) =>
    refusal.status === 0
      ? route.abort()
      : route.fulfill({ status: refusal.status, json: refusal.body }),
  );
  let downloads = 0;
  page.on("download", () => downloads++);
  await page.goto("/?view=shelf");
  for (const [status, body, message] of [
    [401, {}, "Sign in"],
    [403, { error: "account-blocked" }, "Owner"],
    [404, {}, "not found"],
    [
      429,
      { error: "too-many-requests", retryAfterSeconds: 12 },
      "Wait 12 seconds",
    ],
    [503, {}, "server could not answer"],
    [0, {}, "Check your connection"],
  ] as const) {
    refusal = { status, body };
    await page.getByTestId("shelf-actions-p1").click();
    await page.getByRole("menuitem", { name: "Export", exact: true }).click();
    await expect(page.getByRole("alert")).toContainText(message);
  }
  expect(downloads).toBe(0);
});

test("Insert retries a failed cursor and preserves the first page count", async ({
  page,
}) => {
  await signIn(page, sessionUser());
  await mockPreviews(page);
  let attempts = 0;
  await mockGalleryApi(page, { tags: [] }, async (url, route) => {
    if (!url.searchParams.has("cursor"))
      return route.fulfill({
        json: { entries: [ENTRY], nextCursor: "page-2", total: 40 },
      });
    attempts++;
    if (attempts === 1) return route.fulfill({ status: 503, json: {} });
    return route.fulfill({
      json: {
        entries: [{ ...ENTRY, id: "second", name: "Second" }],
        nextCursor: null,
      },
    });
  });
  await openEditor(page);
  await page.getByTestId("examples-toggle").click();
  const panel = page.getByTestId("examples-panel");
  await expect(panel.getByTestId("examples-panel-more-failed")).toContainText(
    "503",
  );
  await panel.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(panel.getByTestId("gallery-example-second")).toBeVisible();
  await expect(panel.getByTestId("examples-panel-more-failed")).toHaveCount(0);
  await expect(panel.getByTestId("examples-panel-count")).toHaveText(
    "40 circuits",
  );
  expect(attempts).toBe(2);
});

for (const status of [401, 403]) {
  test(`Insert shows the ${status} recovery when the next page is refused`, async ({
    page,
  }) => {
    await signIn(page, sessionUser());
    await mockPreviews(page);
    let attempts = 0;
    await mockGalleryApi(page, { tags: [] }, async (url, route) => {
      if (!url.searchParams.has("cursor"))
        return route.fulfill({
          json: { entries: [ENTRY], nextCursor: "page-2", total: 40 },
        });
      attempts++;
      return route.fulfill({
        status,
        json: {
          error: status === 403 ? "account-blocked" : "sign-in-required",
        },
      });
    });
    await openEditor(page);
    await page.getByTestId("examples-toggle").click();
    const panel = page.getByTestId("examples-panel");
    await expect(
      panel.getByTestId(
        status === 403 ? "gallery-blocked" : "examples-panel-sign-in",
      ),
    ).toBeVisible();
    await expect(
      panel.getByRole("button", { name: "Retry", exact: true }),
    ).toHaveCount(0);
    await expect(panel.getByTestId(`gallery-example-${ENTRY.id}`)).toHaveCount(
      0,
    );
    await panel.locator(".examples-panel-results").evaluate((e) => {
      e.scrollTop = e.scrollHeight;
    });
    await page.evaluate(() => new Promise(requestAnimationFrame));
    expect(attempts).toBe(1);
  });
}

test("My submissions keeps the card and names failed withdraw, restore and delete", async ({
  page,
}) => {
  await signIn(page, sessionUser());
  await mockPreviews(page);
  await page.route("**/api/gallery/mine", (route) =>
    route.fulfill({
      json: {
        entries: [
          { ...ENTRY, status: "public", rejectReason: null },
          { ...ENTRY, id: "withdrawn", status: "recycled", rejectReason: null },
        ],
      },
    }),
  );
  await page.route(`**/api/gallery/${ENTRY.id}/recycle`, (route) =>
    route.fulfill({ status: 403, json: { error: "account-blocked" } }),
  );
  await page.route("**/api/gallery/withdrawn/restore", (route) =>
    route.fulfill({
      status: 429,
      json: { error: "too-many-requests", retryAfterSeconds: 12 },
    }),
  );
  await page.route("**/api/gallery/withdrawn", (route) =>
    route.fulfill({ status: 401, json: {} }),
  );
  await page.goto("/mine");
  await page.getByTestId(`mine-withdraw-${ENTRY.id}`).click();
  await expect(page.getByTestId("mine-notice")).toContainText("Owner");
  await expect(page.getByTestId(`mine-withdraw-${ENTRY.id}`)).toBeEnabled();
  await page.getByTestId("mine-restore-withdrawn").click();
  await expect(page.getByTestId("mine-notice")).toContainText(
    "Wait 12 seconds",
  );
  await page.getByTestId("mine-delete-withdrawn").click();
  await expect(page.getByTestId("mine-notice")).toContainText("Sign in");
  await expect(page.getByTestId("mine-card-withdrawn")).toBeVisible();
});
