import { afterEach, expect, it, vi } from "vitest";
import { requestGalleryScan } from "./gallery-scan-request";

afterEach(() => vi.useRealTimers());

it("retries transient reads but never permanent errors", async () => {
  vi.useFakeTimers();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(new Response("", { status: 503 }))
    .mockResolvedValueOnce(new Response("", { status: 429 }))
    .mockResolvedValueOnce(Response.json({ entries: [] }));
  const pending = requestGalleryScan("/api/gallery", fetcher);
  await vi.runAllTimersAsync();
  expect(await pending).toEqual({ entries: [] });
  expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockReset().mockResolvedValue(new Response("", { status: 404 }));
  await expect(
    requestGalleryScan("/api/gallery/gone", fetcher),
  ).rejects.toThrow("404");
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("cancels pending retries immediately", async () => {
  vi.useFakeTimers();
  const controller = new AbortController();
  const fetcher = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new TypeError("Network failed"));
  const pending = requestGalleryScan(
    "/api/gallery",
    fetcher,
    controller.signal,
  );
  const assertion = expect(pending).rejects.toMatchObject({
    name: "AbortError",
  });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await assertion;
  await vi.runAllTimersAsync();
  expect(fetcher).toHaveBeenCalledTimes(1);
});
