import { expect, test } from "@playwright/test";
import { awaitEditorReady } from "./editor-fixtures.js";

test("loopback examples do not depend on a Gallery server or its sign-in state", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/gallery"))
      requests.push(request.url());
  });
  await page.route("**/api/gallery**", (route) =>
    route.fulfill({ status: 401, json: { error: "sign in" } }),
  );
  await page.goto("/");
  await expect(
    page.getByTestId("gallery-bundled-two-stage-op-amp"),
  ).toBeVisible();
  await page.getByTestId("gallery-bundled-two-stage-op-amp").click();
  await awaitEditorReady(page);
  for (let i = 0; i < 3; i++) {
    await page.getByTestId("examples-toggle").click();
    await expect(
      page.getByTestId("shapes-example-two-stage-op-amp"),
    ).toBeVisible();
    await page.getByTestId("examples-toggle").click();
  }
  expect(requests).toEqual([]);
});
