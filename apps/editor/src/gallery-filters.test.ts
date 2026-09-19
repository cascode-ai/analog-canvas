import { describe, expect, it } from "vitest";
import {
  createDefaultGalleryFilters,
  galleryFilterSearch,
  galleryFiltersNarrowQuery,
  galleryFiltersNarrowWall,
  parseGalleryFilterQuery,
  parseStoredGalleryFilters,
  resolveGalleryFilters,
} from "./gallery-filters";

describe("gallery filter preferences", () => {
  it("reads every narrowing choice out of a link", () => {
    const { filters, narrowed } = parseGalleryFilterQuery(
      "?view=shelf&author=alice&owner=account-alice&tags=bias,opamp&q=mirror&netlist=1&liked=1",
    );
    expect(filters).toEqual({
      view: "shelf",
      author: "alice",
      ownerUserId: "account-alice",
      tags: ["bias", "opamp"],
      search: "mirror",
      netlistable: true,
      liked: true,
    });
    expect(narrowed).toBe(true);
  });

  it("treats a bare wall as no request at all", () => {
    const { filters, narrowed, namesView } = parseGalleryFilterQuery("?view=");
    expect(filters).toEqual(createDefaultGalleryFilters());
    expect(narrowed).toBe(false);
    expect(namesView).toBe(true);
  });

  it("writes the filters back without disturbing other parameters", () => {
    const search = galleryFilterSearch("?seed=demo&author=bob&netlist=1", {
      ...createDefaultGalleryFilters(),
      tags: ["bias"],
      liked: true,
    });
    const params = new URLSearchParams(search);
    expect(params.get("seed")).toBe("demo");
    expect(params.get("tags")).toBe("bias");
    expect(params.get("liked")).toBe("1");
    // Cleared choices leave, so the URL never outlives the state it describes.
    expect(params.has("author")).toBe(false);
    expect(params.has("owner")).toBe(false);
    expect(params.has("netlist")).toBe(false);
  });

  it("round-trips a mutable byline with its stable account identity", () => {
    const search = galleryFilterSearch("", {
      ...createDefaultGalleryFilters(),
      author: "Shared Name",
      ownerUserId: "owner-123",
    });
    expect(parseGalleryFilterQuery(search).filters).toEqual({
      ...createDefaultGalleryFilters(),
      author: "Shared Name",
      ownerUserId: "owner-123",
    });
    expect(
      parseStoredGalleryFilters(
        JSON.stringify({ author: "Shared Name", ownerUserId: "owner-123" }),
      ),
    ).toEqual({
      ...createDefaultGalleryFilters(),
      author: "Shared Name",
      ownerUserId: "owner-123",
    });
  });

  it("drops the query entirely once nothing is selected", () => {
    expect(
      galleryFilterSearch("?author=bob&tags=bias", {
        ...createDefaultGalleryFilters(),
      }),
    ).toBe("");
  });

  it("keeps a whitespace-only search out of the URL", () => {
    expect(
      galleryFilterSearch("", {
        ...createDefaultGalleryFilters(),
        search: "   ",
      }),
    ).toBe("");
  });

  it("restores the reader's last choice when the link asks for nothing", () => {
    const stored = JSON.stringify({
      view: "gallery",
      author: "alice",
      ownerUserId: "account-alice",
      tags: ["bias"],
      search: "mirror",
      netlistable: true,
      liked: false,
    });
    expect(resolveGalleryFilters("", stored)).toEqual({
      view: "gallery",
      author: "alice",
      ownerUserId: "account-alice",
      tags: ["bias"],
      search: "mirror",
      netlistable: true,
      liked: false,
    });
  });

  it("lets a narrowing link replace the stored preference outright", () => {
    const stored = JSON.stringify({ author: "alice", netlistable: true });
    expect(resolveGalleryFilters("?tags=opamp", stored)).toEqual({
      ...createDefaultGalleryFilters(),
      tags: ["opamp"],
    });
  });

  it("restores the narrowing but obeys the wall the link names", () => {
    const stored = JSON.stringify({ view: "gallery", author: "alice" });
    expect(resolveGalleryFilters("?view=shelf", stored)).toEqual({
      ...createDefaultGalleryFilters(),
      view: "shelf",
      author: "alice",
    });
  });

  it("restores a deliberately empty choice as emptiness", () => {
    expect(
      resolveGalleryFilters("", JSON.stringify(createDefaultGalleryFilters())),
    ).toEqual(createDefaultGalleryFilters());
  });

  it("ignores a store that is missing, damaged or the wrong shape", () => {
    expect(parseStoredGalleryFilters(null)).toBeNull();
    expect(parseStoredGalleryFilters("{")).toBeNull();
    expect(parseStoredGalleryFilters("[]")).toBeNull();
    expect(parseStoredGalleryFilters("7")).toBeNull();
  });

  it("bounds what a hand-edited store can restore", () => {
    const restored = parseStoredGalleryFilters(
      JSON.stringify({
        author: "a".repeat(400),
        tags: ["bias", "bias", "", 7, "opamp"],
        search: "s".repeat(400),
        netlistable: "yes",
      }),
    );
    expect(restored?.author).toHaveLength(200);
    expect(restored?.search).toHaveLength(200);
    expect(restored?.tags).toEqual(["bias", "opamp"]);
    // Only a real boolean turns a mark on.
    expect(restored?.netlistable).toBe(false);
  });

  it("separates the wall's own slice from the text search", () => {
    const search = { ...createDefaultGalleryFilters(), search: "mirror" };
    expect(galleryFiltersNarrowWall(search)).toBe(true);
    expect(galleryFiltersNarrowQuery(search)).toBe(false);
    const liked = { ...createDefaultGalleryFilters(), liked: true };
    expect(galleryFiltersNarrowQuery(liked)).toBe(true);
  });
});
