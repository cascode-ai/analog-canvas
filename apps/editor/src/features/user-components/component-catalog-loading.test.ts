import { describe, expect, it, vi } from "vitest";
import { loadComponentCatalog } from "./component-catalog-loading";
import {
  ComponentLibraryError,
  type loadSharedComponentSummaries,
} from "./component-library-client";
import type { ComponentLibrarySummaryPage } from "./component-library-contract";

const catalog = { version: 1, type: "all", order: "circuit-first" } as const;
function page(
  ids: string[],
  nextCursor: string | null = null,
  catalogRevision = 1,
): ComponentLibrarySummaryPage {
  return {
    entries: ids.map((id) => ({
      id,
      name: id,
      revision: 1,
      authorId: "alice",
      author: "Alice",
      status: "shared",
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
      capability: "symbol-only",
      pinCount: 0,
      parameterCount: 0,
    })),
    nextCursor,
    catalogRevision,
  };
}
const loader = () => vi.fn<typeof loadSharedComponentSummaries>();
function read(
  load: ReturnType<typeof loader>,
  receive = vi.fn(),
  previous?: ComponentLibrarySummaryPage,
  progress?: {
    resume: ComponentLibrarySummaryPage | undefined;
    retain(page: ComponentLibrarySummaryPage | undefined): void;
  },
  signal = new AbortController().signal,
) {
  return loadComponentCatalog(
    "resistor",
    false,
    catalog,
    signal,
    receive,
    previous,
    progress,
    load,
  );
}

describe("component catalog loading", () => {
  it("resumes an interrupted initial page and propagates ordinary failures without restarting", async () => {
    const receive = vi.fn();
    const error = new Error("offline");
    const load = loader()
      .mockResolvedValueOnce(page(["a"], "tail"))
      .mockRejectedValueOnce(error);
    await expect(read(load, receive)).rejects.toBe(error);
    expect(receive).toHaveBeenCalledTimes(1);
    const retry = loader().mockResolvedValueOnce(page(["b"]));
    await read(retry, receive, receive.mock.lastCall![0]);
    expect(retry.mock.calls[0]![1]).toBe("tail");
    expect(
      receive.mock.lastCall![0].entries.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["a", "b"]);
  });
  it("buffers replacement pages, resumes after failure, and publishes only a complete generation", async () => {
    const previous = page(["old"]);
    const receive = vi.fn();
    const progress = {
      resume: undefined as ComponentLibrarySummaryPage | undefined,
      retain(next: ComponentLibrarySummaryPage | undefined) {
        this.resume = next;
      },
    };
    const load = loader()
      .mockResolvedValueOnce(page(["new"], "tail", 2))
      .mockRejectedValueOnce(new Error("offline"));
    await expect(read(load, receive, previous, progress)).rejects.toThrow(
      "offline",
    );
    expect(receive).not.toHaveBeenCalled();
    expect(progress.resume?.entries[0]?.id).toBe("new");
    expect(load.mock.calls[0]![6]).toBe(1);
    const retry = loader().mockResolvedValueOnce(page(["last"], null, 2));
    await read(retry, receive, previous, progress);
    expect(retry.mock.calls[0]![1]).toBe("tail");
    expect(retry.mock.calls[0]![6]).toBeUndefined();
    expect(
      receive.mock.lastCall![0].entries.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["new", "last"]);
    expect(progress.resume).toBeUndefined();
  });
  it("rejects repeated cursors before another request", async () => {
    const load = loader().mockResolvedValue(page(["a"], "loop"));
    await expect(read(load)).rejects.toThrow("repeated page");
    expect(load).toHaveBeenCalledTimes(2);
  });
  it("restarts a changed catalog once and discards the old generation and visited cursors", async () => {
    const changed = new ComponentLibraryError(
      "changed",
      409,
      false,
      "COMPONENT_CATALOG_CHANGED",
    );
    const load = loader()
      .mockRejectedValueOnce(changed)
      .mockResolvedValueOnce(page(["new"], "tail", 2))
      .mockResolvedValueOnce(page(["last"], null, 2));
    const receive = vi.fn();
    const retain = vi.fn();
    await read(load, receive, page(["old"], "tail"), {
      resume: undefined,
      retain,
    });
    expect(load.mock.calls.map((args) => args[1])).toEqual([
      "tail",
      null,
      "tail",
    ]);
    expect(load.mock.calls[1]![6]).toBeUndefined();
    expect(retain.mock.calls[0]).toEqual([undefined]);
    expect(receive).toHaveBeenCalledTimes(1);
    expect(
      receive.mock.lastCall![0].entries.map(
        (entry: { id: string }) => entry.id,
      ),
    ).toEqual(["new", "last"]);
  });
  it("propagates a second catalog change and unrelated library errors", async () => {
    const changed = new ComponentLibraryError(
      "changed",
      409,
      false,
      "COMPONENT_CATALOG_CHANGED",
    );
    const load = loader().mockRejectedValue(changed);
    await expect(read(load)).rejects.toBe(changed);
    expect(load).toHaveBeenCalledTimes(2);
    const forbidden = new ComponentLibraryError("forbidden", 403);
    const refused = loader().mockRejectedValue(forbidden);
    await expect(read(refused)).rejects.toBe(forbidden);
    expect(refused).toHaveBeenCalledTimes(1);
  });
  it("keeps unchanged cards without publishing an empty not-modified page", async () => {
    const load = loader().mockResolvedValue({ ...page([]), notModified: true });
    const receive = vi.fn();
    const retain = vi.fn();
    await read(load, receive, page(["old"]), { resume: undefined, retain });
    expect(load.mock.calls[0]![6]).toBe(1);
    expect(receive).not.toHaveBeenCalled();
    expect(retain).toHaveBeenCalledWith(undefined);
  });
  it("does not publish or retain a response arriving after cancellation", async () => {
    const controller = new AbortController();
    const load = loader().mockImplementation(async () => {
      controller.abort();
      return page(["late"]);
    });
    const receive = vi.fn();
    const retain = vi.fn();
    await expect(
      read(
        load,
        receive,
        undefined,
        { resume: undefined, retain },
        controller.signal,
      ),
    ).rejects.toBe(controller.signal.reason);
    expect(receive).not.toHaveBeenCalled();
    expect(retain).not.toHaveBeenCalled();
  });
  it("publishes an empty initial catalog", async () => {
    const receive = vi.fn();
    await read(loader().mockResolvedValue(page([])), receive);
    expect(receive).toHaveBeenCalledWith(page([]));
  });
  it("progressively follows cursors and replaces duplicate IDs with the latest summary", async () => {
    const load = loader()
      .mockResolvedValueOnce(page(["a", "b"], "next"))
      .mockResolvedValueOnce({
        ...page(["b", "c"]),
        entries: [
          { ...page(["b"]).entries[0]!, name: "updated" },
          ...page(["c"]).entries,
        ],
      });
    const receive = vi.fn();
    await read(load, receive);
    expect(
      receive.mock.calls.map(([value]) =>
        value.entries.map((entry: { id: string }) => entry.id),
      ),
    ).toEqual([
      ["a", "b"],
      ["a", "b", "c"],
    ]);
    expect(receive.mock.lastCall![0].entries[1].name).toBe("updated");
    expect(load.mock.calls.map((args) => args[1])).toEqual([null, "next"]);
  });
});
