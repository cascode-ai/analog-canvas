import { expect, it } from "vitest";
import { createGalleryPanelLoader } from "./gallery-panel-loader";

it("shares concurrent requests only within one panel refresh, and retries after settlement", async () => {
  const replies: ((response: Response) => void)[] = [];
  const requests: string[] = [];
  const fetcher = ((url: RequestInfo | URL) => {
    requests.push(String(url));
    return new Promise<Response>((resolve) => replies.push(resolve));
  }) as typeof fetch;
  const loader = createGalleryPanelLoader(fetcher);
  const first = loader.feed({ q: "ota" });
  const same = loader.feed({ q: "ota" });
  const nextIdentity = createGalleryPanelLoader(fetcher).feed({ q: "ota" });
  expect(requests).toHaveLength(2);
  replies[0]!(
    Response.json({ entries: [], nextCursor: null, total: 0, search: "ota" }),
  );
  replies[1]!(new Response("", { status: 401 }));
  expect(await first).toEqual(await same);
  expect(await nextIdentity).not.toEqual(await first);
  const retry = loader.feed({ q: "ota" });
  expect(requests).toHaveLength(3);
  replies[2]!(new Response("", { status: 503 }));
  expect(await retry).toBeNull();
});
