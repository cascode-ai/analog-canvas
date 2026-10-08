import { describe, expect, it } from "vitest";
import {
  createDefaultGalleryFilters,
  galleryFilterSearch,
  galleryFiltersNarrowQuery,
  parseGalleryFilterQuery,
  parseStoredGalleryFilters,
  resolveGalleryFilters,
} from "./gallery-filters";

describe("gallery filter preferences", () => {
  it("reads every narrowing choice out of a link", () => {
    const { filters, narrowed } = parseGalleryFilterQuery(
      "?view=shelf&author=alice&owner=account-alice&tags=bias,opamp&q=mirror&netlist=1&liked=1&parts=6-10,26-",
    );
    expect(filters).toEqual({
      view: "shelf",
      author: "alice",
      ownerUserId: "account-alice",
      tags: ["bias", "opamp"],
      search: "mirror",
      netlistable: true,
      withoutNetlist: false,
      ai: null,
      liked: true,
      attention: false,
      attentionKind: null,
      parts: ["6-10", "26-"],
      source: null,
    });
    expect(narrowed).toBe(true);
  });

  it("opens a reference dataset's wall by its link or one of its circuits (#1510)", () => {
    const linked = parseGalleryFilterQuery("?source=analoggenie");
    expect(linked.filters.source).toBe("analoggenie");
    expect(linked.narrowed).toBe(true);
    expect(galleryFilterSearch("", linked.filters)).toBe("?source=analoggenie");
    // An unknown source is the community wall.
    expect(parseGalleryFilterQuery("?source=nowhere").filters.source).toBe(
      null,
    );
    // A dataset circuit's link opens its dataset; a community one, the
    // community wall, whatever was stored.
    const stored = JSON.stringify({ source: "circuitthink" });
    expect(resolveGalleryFilters("?entry=ag-308", stored).source).toBe(
      "analoggenie",
    );
    expect(resolveGalleryFilters("?entry=pxxj67dmag", stored).source).toBe(
      null,
    );
    expect(resolveGalleryFilters("", stored).source).toBe("circuitthink");
  });

  it("carries the other side of each pair: without a netlist, AI or by hand", () => {
    const { filters, narrowed } = parseGalleryFilterQuery("?netlist=0&ai=1");
    expect(filters).toMatchObject({
      netlistable: false,
      withoutNetlist: true,
      ai: "ai",
    });
    expect(narrowed).toBe(true);
    expect(parseGalleryFilterQuery("?ai=0").filters.ai).toBe("human");
    expect(galleryFilterSearch("", filters)).toBe("?netlist=0&ai=1");
    expect(
      galleryFilterSearch("", {
        ...filters,
        withoutNetlist: false,
        ai: "human",
      }),
    ).toBe("?ai=0");
    // Storage keeps them too, and never both sides of the netlist pair.
    const stored = parseStoredGalleryFilters(
      JSON.stringify({ netlistable: true, withoutNetlist: true, ai: "human" }),
    );
    expect(stored).toMatchObject({
      netlistable: true,
      withoutNetlist: false,
      ai: "human",
    });
  });

  it("carries one attention reason, and only under Needs attention", () => {
    expect(
      parseGalleryFilterQuery("?attention=1&reason=global-vdd").filters
        .attentionKind,
    ).toBe("global-vdd");
    // A reason without Needs attention, or one no reason could spell, is
    // dropped; the Worker ignores a well-formed reason it does not know.
    expect(
      parseGalleryFilterQuery("?reason=global-vdd").filters.attentionKind,
    ).toBeNull();
    expect(
      parseGalleryFilterQuery("?attention=1&reason=Not%20a%20reason").filters
        .attentionKind,
    ).toBeNull();
    const params = new URLSearchParams(
      galleryFilterSearch("", {
        ...createDefaultGalleryFilters(),
        attention: true,
        attentionKind: "suspected-disconnection",
      }),
    );
    expect(params.get("reason")).toBe("suspected-disconnection");
    expect(
      new URLSearchParams(
        galleryFilterSearch("?attention=1&reason=global-vdd", {
          ...createDefaultGalleryFilters(),
          attentionKind: "global-vdd",
        }),
      ).has("reason"),
    ).toBe(false);
    expect(
      parseStoredGalleryFilters(
        JSON.stringify({ attention: true, attentionKind: "global-vdd" }),
      )?.attentionKind,
    ).toBe("global-vdd");
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
      attention: false,
      attentionKind: null,
      author: "alice",
      ownerUserId: "account-alice",
      tags: ["bias"],
      search: "mirror",
      netlistable: true,
      withoutNetlist: false,
      ai: null,
      liked: false,
      parts: [],
      source: null,
    });
  });

  it("carries part-count sizes through a link and storage", () => {
    const filters = {
      ...createDefaultGalleryFilters(),
      parts: ["0-5", "11-15"],
    };
    const search = galleryFilterSearch("", filters);
    expect(new URLSearchParams(search).get("parts")).toBe("0-5,11-15");
    expect(parseGalleryFilterQuery(search)).toMatchObject({
      filters,
      narrowed: true,
    });
    expect(
      parseStoredGalleryFilters(JSON.stringify({ parts: ["26-", 7, "x"] })),
    ).toEqual({ ...createDefaultGalleryFilters(), parts: ["26-"] });
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
    expect(galleryFiltersNarrowQuery(search)).toBe(false);
    const liked = { ...createDefaultGalleryFilters(), liked: true };
    expect(galleryFiltersNarrowQuery(liked)).toBe(true);
  });
});

it("round-trips attention independently of tags and retires category links", () => {
  const filters = {
    ...createDefaultGalleryFilters(),
    attention: true,
    tags: ["cascode"],
  };
  expect(
    parseGalleryFilterQuery(galleryFilterSearch("", filters)).filters,
  ).toEqual(filters);
  expect(parseStoredGalleryFilters(JSON.stringify(filters))).toEqual(filters);
  expect(galleryFiltersNarrowQuery(filters)).toBe(true);
  expect(galleryFilterSearch("?category=amplifiers", filters)).not.toContain(
    "category",
  );
  expect(parseGalleryFilterQuery("?category=amplifiers").narrowed).toBe(false);
});
