import { afterEach, describe, expect, it, vi } from "vitest";

import {
  announceGalleryChange,
  galleryPreviewUrl,
  primeGalleryPreview,
  subscribeGalleryRefresh,
} from "./gallery-client";

class FakeBroadcastChannel {
  static readonly channels = new Map<string, Set<FakeBroadcastChannel>>();

  private readonly listeners = new Set<
    (event: MessageEvent<unknown>) => void
  >();

  constructor(readonly name: string) {
    const peers = FakeBroadcastChannel.channels.get(name) ?? new Set();
    peers.add(this);
    FakeBroadcastChannel.channels.set(name, peers);
  }

  addEventListener(
    type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    if (type === "message") this.listeners.add(listener);
  }

  removeEventListener(
    type: string,
    listener: (event: MessageEvent<unknown>) => void,
  ): void {
    if (type === "message") this.listeners.delete(listener);
  }

  postMessage(data: unknown): void {
    for (const peer of FakeBroadcastChannel.channels.get(this.name) ?? []) {
      if (peer === this) continue;
      for (const listener of peer.listeners) {
        listener({ data } as MessageEvent<unknown>);
      }
    }
  }

  close(): void {
    FakeBroadcastChannel.channels.get(this.name)?.delete(this);
    this.listeners.clear();
  }
}

afterEach(() => {
  vi.unstubAllGlobals();
  FakeBroadcastChannel.channels.clear();
});

describe("Gallery preview caching", () => {
  it("uses one immutable URL per preview revision", () => {
    expect(galleryPreviewUrl("entry-1", "revision 0")).toBe(
      "/api/gallery/entry-1/preview.svg?v=revision%200",
    );
    expect(galleryPreviewUrl("entry-1", "revision-7")).toBe(
      "/api/gallery/entry-1/preview.svg?v=revision-7",
    );
    expect(galleryPreviewUrl("entry-1")).toBe(
      "/api/gallery/entry-1/preview.svg",
    );
  });

  it("warms only a revisioned preview without delaying on failure", async () => {
    const fetchLike = vi
      .fn()
      .mockResolvedValueOnce(new Response("<svg/>"))
      .mockRejectedValueOnce(new Error("offline")) as unknown as typeof fetch;

    await primeGalleryPreview("entry-1", "revision-3", fetchLike);
    await primeGalleryPreview("entry-1", "revision-4", fetchLike);
    await primeGalleryPreview("entry-1", undefined, fetchLike);

    expect(fetchLike).toHaveBeenCalledTimes(2);
    expect(fetchLike).toHaveBeenNthCalledWith(
      1,
      "/api/gallery/entry-1/preview.svg?v=revision-3",
      { credentials: "same-origin", cache: "reload" },
    );
  });
});

describe("Gallery refresh notifications", () => {
  it("broadcasts a successful mutation to another tab", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      FakeBroadcastChannel as unknown as typeof BroadcastChannel,
    );
    const remote = new FakeBroadcastChannel("analog-canvas-gallery-change-v1");
    const messages: unknown[] = [];
    remote.addEventListener("message", (event) => messages.push(event.data));

    announceGalleryChange({
      entryId: "entry-1",
      previewRevision: "revision-5",
    });

    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      type: "gallery-changed",
      entryId: "entry-1",
      previewRevision: "revision-5",
    });
  });

  it("accepts valid cross-tab messages and ignores malformed ones", () => {
    vi.stubGlobal(
      "BroadcastChannel",
      FakeBroadcastChannel as unknown as typeof BroadcastChannel,
    );
    const changes: unknown[] = [];
    const unsubscribe = subscribeGalleryRefresh((change) =>
      changes.push(change),
    );
    const remote = new FakeBroadcastChannel("analog-canvas-gallery-change-v1");

    remote.postMessage({ type: "gallery-changed", sourceId: "other-tab" });
    remote.postMessage({
      type: "gallery-changed",
      sourceId: "other-tab",
      entryId: "entry-2",
      previewRevision: "revision-6",
    });

    expect(changes).toEqual([
      { entryId: "entry-2", previewRevision: "revision-6" },
    ]);
    unsubscribe();
  });
});
