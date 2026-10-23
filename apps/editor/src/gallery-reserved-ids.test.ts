import { describe, expect, it } from "vitest";

import { loadGalleryFeed } from "./gallery-client";
import { isReservedGalleryId } from "./gallery-reserved-ids";
import { isRequestFailure } from "./request-failure";

describe("reserved Gallery ids", () => {
  it("are short ids of a fixed rule, never a UUID or a dataset's id", () => {
    expect(isReservedGalleryId("ww5fnfambz")).toBe(true);
    for (const id of [
      "ww5fnfambx",
      "2f4b8c1e-1d2a-4c3b-9e8f-0a1b2c3d4e5f",
      "ct-0001",
    ])
      expect(isReservedGalleryId(id)).toBe(false);
  });

  it("never reach the wall, the Insert panel or the Agent", async () => {
    const entry = (id: string) => ({ id, name: id });
    const feed = await loadGalleryFeed(async () =>
      Response.json({
        entries: [
          entry("a2b3c4d5e6"),
          entry("ww5fnfambz"),
          entry("f7g8h9j2k3"),
        ],
        nextCursor: null,
      }),
    );
    expect(
      typeof feed === "object" &&
        !isRequestFailure(feed) &&
        feed.entries.map(({ id }) => id),
    ).toEqual(["a2b3c4d5e6", "f7g8h9j2k3"]);
  });
});
