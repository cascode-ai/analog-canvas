import { expect, it, vi } from "vitest";
import { APP_ORIGIN } from "./app-protocol";
import { createExternalLinkHandler } from "./external-links";

it("opens fixed product links in the system browser and refuses arbitrary destinations", async () => {
  const open = vi.fn(async (_url: string) => {});
  const handle = createExternalLinkHandler(open, "a".repeat(40));
  const request = (body: unknown, origin = APP_ORIGIN) =>
    new Request(`${APP_ORIGIN}/desktop/external`, {
      method: "POST",
      headers: { origin },
      body: JSON.stringify(body),
    });
  expect((await handle(request({ target: "owner" }))).ok).toBe(true);
  expect(open).toHaveBeenLastCalledWith("https://tokenzhang.com");
  expect((await handle(request({ target: "repository" }))).ok).toBe(true);
  expect(open).toHaveBeenLastCalledWith(
    "https://github.com/cascode-ai/analog-canvas",
  );
  expect((await handle(request({ target: "source" }))).ok).toBe(true);
  expect(open).toHaveBeenLastCalledWith(
    `https://github.com/cascode-ai/analog-canvas/commit/${"a".repeat(40)}`,
  );
  expect(
    (await handle(request({ target: "https://example.com" }))).status,
  ).toBe(400);
  expect(
    (await handle(request({ target: "owner", url: "file:///C:/Windows" })))
      .status,
  ).toBe(400);
  expect(
    (await handle(request({ target: "owner" }, "https://example.com"))).status,
  ).toBe(403);
  expect(open).toHaveBeenCalledTimes(3);
});
