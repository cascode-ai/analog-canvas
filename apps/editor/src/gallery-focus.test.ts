import { describe, expect, it } from "vitest";
import {
  galleryFocusEntryId,
  galleryFocusStep,
  withoutGalleryFocus,
} from "./gallery-focus";
import { resolveGalleryFilters } from "./gallery-filters";

describe("a link to one circuit on the Gallery wall", () => {
  it("reads a legible entry id and ignores anything else", () => {
    expect(galleryFocusEntryId("?entry=abc123")).toBe("abc123");
    expect(
      galleryFocusEntryId("?entry=ba28f58c-35bc-4a8c-8571-3a18cc9ae846"),
    ).toBe("ba28f58c-35bc-4a8c-8571-3a18cc9ae846");
    expect(galleryFocusEntryId("")).toBeNull();
    expect(galleryFocusEntryId("?entry=")).toBeNull();
    expect(galleryFocusEntryId("?entry=../x")).toBeNull();
  });

  it("opens the whole community wall over a remembered filter", () => {
    const stored = JSON.stringify({ attention: true, liked: true });
    const filters = resolveGalleryFilters("?entry=abc123", stored);
    expect(filters.attention).toBe(false);
    expect(filters.liked).toBe(false);
    expect(filters.view).toBe("gallery");
    // A link that also names a slice keeps that slice.
    expect(resolveGalleryFilters("?entry=abc123&liked=1", stored).liked).toBe(
      true,
    );
    // Without a linked circuit, the remembered filter still applies.
    expect(resolveGalleryFilters("", stored).attention).toBe(true);
  });

  it("pages until the circuit is loaded, and stops at the wall's end", () => {
    expect(galleryFocusStep(["a", "b"], "b", "c1", 0)).toBe("found");
    expect(galleryFocusStep(["a"], "b", "c1", 0)).toBe("load-more");
    expect(galleryFocusStep(["a"], "b", null, 3)).toBe("missing");
    expect(galleryFocusStep(["a"], "b", "c9", 5, 5)).toBe("missing");
  });

  it("drops only its own parameter from the address", () => {
    expect(withoutGalleryFocus("?entry=abc")).toBe("");
    expect(withoutGalleryFocus("?view=shelf&entry=abc")).toBe("?view=shelf");
  });
});
