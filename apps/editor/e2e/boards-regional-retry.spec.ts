import { expect, test } from "@playwright/test";
import { BOARD_PAGE } from "../../../worker/boards-page";

test("keeps a Board retry after reload but sends a newly chosen circuit as a new command", async ({
  page,
}) => {
  const id = "abcdefghijklmnopqrstuvwx";
  const state = {
    board: {
      id,
      title: "Selection",
      revision: 1,
      slots: 10,
      createdBy: "Owner",
      createdAt: "2026-01-01T00:00:00Z",
      lockedAt: null,
    },
    items: [],
    events: [],
    viewer: {
      accountId: "owner-1",
      signedIn: true,
      canEdit: true,
      name: "Owner",
    },
  };
  const calls: {
    key: string | undefined;
    body: { changes: { entry: string }[] };
  }[] = [];
  await page.route(`**/boards/${id}`, (route) =>
    route.fulfill({ contentType: "text/html", body: BOARD_PAGE }),
  );
  await page.route(`**/api/boards/${id}`, (route) =>
    route.fulfill({ json: state }),
  );
  await page.route(`**/api/boards/${id}/changes`, async (route) => {
    calls.push({
      key: route.request().headers()["idempotency-key"],
      body: route.request().postDataJSON(),
    });
    state.board.revision = 2;
    await route.fulfill(
      calls.length < 3
        ? { status: 503, json: { error: "unconfirmed" } }
        : { json: state },
    );
  });
  await page.goto(`/boards/${id}`);
  const add = async (entry: string) => {
    await page.locator("#add-entries").fill(entry);
    await page.locator("#add-go").click();
  };
  await add("first-circuit");
  await expect(page.locator("#status")).toHaveText("unconfirmed");
  await page.reload();
  await add("first-circuit");
  await expect(page.locator("#status")).toHaveText("unconfirmed");
  await add("second-circuit");
  await expect(page.locator("#status")).toContainText("已加入");
  expect(calls).toHaveLength(3);
  expect(calls[0]?.key).toBeTruthy();
  expect(calls[1]).toEqual(calls[0]);
  expect(calls[2]?.body.changes).toEqual([
    { kind: "add", entry: "second-circuit", note: "" },
  ]);
  expect(calls[2]?.key).not.toBe(calls[0]?.key);
});
