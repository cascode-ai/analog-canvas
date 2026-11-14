import { expect, test } from "./gallery-test.js";
import {
  ENTRY,
  mockPreviews,
  sessionUser,
  signIn,
} from "./gallery-fixtures.js";

test("Review keeps an unresolved issue visible and reports a failed resolution", async ({
  page,
}) => {
  await signIn(page, sessionUser({ isOwner: true }));
  await mockPreviews(page);
  const card = {
    ...ENTRY,
    components: 3,
    reviews: 1,
    likes: 0,
    likedByViewer: false,
    mine: null,
  };
  await page.route("**/api/gallery/review/*/queue", (route) =>
    route.fulfill({
      json: {
        entries: route.request().url().includes("/community/") ? [card] : [],
      },
    }),
  );
  const review = {
    id: "review-one",
    entryId: ENTRY.id,
    revision: ENTRY.previewRevision,
    current: true,
    reviewer: "Reviewer",
    verdict: "issue",
    flags: ["wiring"],
    note: "Broken connection",
    at: "2026-11-14T00:00:00Z",
    resolved: false,
  };
  await page.route(`**/api/gallery/${ENTRY.id}/reviews`, (route) =>
    route.fulfill({ json: { current: [review], fixes: [] } }),
  );
  let refuse = true;
  await page.route(`**/api/gallery/${ENTRY.id}/reviews/review-one`, (route) => {
    if (refuse)
      return route.fulfill({
        status: 503,
        json: { error: "action-unconfirmed" },
      });
    review.resolved = true;
    return route.fulfill({ json: { ok: true } });
  });
  await page.goto("/review?scope=community&refs=0");
  const resolve = page.getByRole("button", { name: "Resolve", exact: true });
  await resolve.click();
  await expect(page.getByRole("alert")).toContainText("could not be resolved");
  await expect(resolve).toBeVisible();
  refuse = false;
  await resolve.click();
  await expect(resolve).toHaveCount(0);
  await expect(page.getByRole("alert")).toHaveCount(0);
});

test("Review retains its intent across a truncated reply and an older entry after reload", async ({
  page,
}) => {
  await signIn(page, sessionUser());
  await mockPreviews(page);
  const card = {
    ...ENTRY,
    components: 3,
    reviews: 0,
    likes: 0,
    likedByViewer: false,
    mine: null,
  };
  await page.route("**/api/gallery/review/*/queue", (route) =>
    route.fulfill({
      json: {
        entries: route.request().url().includes("/community/") ? [card] : [],
      },
    }),
  );
  const key = "cn_55555555-5555-4555-8555-555555555555";
  let prepared = 0;
  await page.route(`**/api/gallery/${ENTRY.id}/reviews/intent`, (route) => {
    prepared++;
    return route.fulfill({
      json: {
        key:
          prepared === 1
            ? key
            : "overseas_77777777-7777-4777-8777-777777777777",
      },
    });
  });
  const keys: (string | undefined)[] = [];
  let legacyMutations = 0;
  await page.route(`**/api/gallery/${ENTRY.id}/reviews`, (route) => {
    if (route.request().method() !== "GET") legacyMutations++;
    return route.fulfill({ json: { current: [], fixes: [] } });
  });
  await page.route(`**/api/gallery/${ENTRY.id}/reviews/commit`, (route) => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (keys.length === 2)
      return route.fulfill({ status: 404, json: { error: "not-found" } });
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: '{"review":',
    });
  });
  await page.goto("/review?scope=community&refs=0");
  await page.getByRole("button", { name: /Wiring break/ }).click();
  await page.getByTestId("review-not-pass").click();
  await expect(
    page.getByText("The review could not be saved.", { exact: true }),
  ).toBeVisible();
  expect(keys).toEqual([key]);
  await page.reload();
  await page.getByRole("button", { name: /Wiring break/ }).click();
  await page.getByTestId("review-not-pass").click();
  await expect.poll(() => keys.length).toBe(2);
  expect(keys).toEqual([key, key]);
  await expect(
    page.getByText("The review could not be saved.", { exact: true }),
  ).toBeVisible();
  await page.getByTestId("review-not-pass").click();
  await expect.poll(() => keys.length).toBe(3);
  expect(keys).toEqual([key, key, key]);
  expect(prepared).toBe(1);
  expect(legacyMutations).toBe(0);
});
