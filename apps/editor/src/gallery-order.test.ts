import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { GalleryOrderMenu } from "./components/gallery-order-menu";
import {
  GALLERY_ORDER_KEY,
  GALLERY_SEED_GLOBAL,
  galleryOrderPreference,
  GALLERY_SEED_KEY,
  galleryShuffleSeed,
  keepGallerySeed,
  rememberGalleryOrder,
} from "./gallery-order";

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL];
});

describe("the Gallery's order (#1615)", () => {
  it("opens shuffled unless the reader kept another order", () => {
    expect(galleryOrderPreference(() => null)).toBe("random");
    expect(galleryOrderPreference(() => "oldest")).toBe("oldest");
    expect(galleryOrderPreference(() => "fewest")).toBe("fewest");
    // A retired order a reader kept opens shuffled.
    expect(galleryOrderPreference(() => "name")).toBe("random");
    expect(galleryOrderPreference(() => "likes")).toBe("likes");
    expect(galleryOrderPreference(() => "random")).toBe("random");
    expect(galleryOrderPreference(() => "sideways")).toBe("random");
    expect(
      galleryOrderPreference(() => {
        throw new Error("storage blocked");
      }),
    ).toBe("random");
  });

  it("keeps a chosen order and forgets Random, so each visit reshuffles", () => {
    const store = new Map<string, string>();
    const storage = {
      setItem: (key: string, value: string) => store.set(key, value),
      removeItem: (key: string) => store.delete(key),
    };
    rememberGalleryOrder("parts", storage);
    expect(store.get(GALLERY_ORDER_KEY)).toBe("parts");
    rememberGalleryOrder("random", storage);
    expect(store.has(GALLERY_ORDER_KEY)).toBe(false);
  });

  it("shuffles by index.html's seed when it made one", () => {
    (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL] = "abc123";
    expect(galleryShuffleSeed()).toBe("abc123");
    (globalThis as Record<string, unknown>)[GALLERY_SEED_GLOBAL] =
      "Not a seed!";
    const own = galleryShuffleSeed();
    expect(own).toMatch(/^[a-z0-9]{1,16}$/u);
    expect(galleryShuffleSeed()).toBe(own);
  });

  it("keeps the tab's shuffle, so coming back finds the same wall", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => void store.set(key, value),
    };
    keepGallerySeed("kept42", storage);
    expect(store.get(GALLERY_SEED_KEY)).toBe("kept42");
    expect(galleryShuffleSeed(storage)).toBe("kept42");
  });

  it("names the order on its button and checks it in the menu", () => {
    const html = renderToStaticMarkup(
      createElement(GalleryOrderMenu, { order: "random", onChoose: () => {} }),
    );
    expect(html).toContain('aria-label="Order: Random"');
    // A shuffled wall shuffles again from a button beside the menu.
    expect(html).toMatch(
      /data-testid="gallery-reshuffle" aria-label="Shuffle again"/u,
    );
    expect(html).toMatch(
      /aria-checked="true" data-testid="gallery-order-random"/u,
    );
    const parts = renderToStaticMarkup(
      createElement(GalleryOrderMenu, { order: "parts", onChoose: () => {} }),
    );
    expect(parts).toContain('aria-label="Order: Most parts"');
    expect(parts).not.toContain("gallery-reshuffle");
    expect(parts).toMatch(
      /aria-checked="true" data-testid="gallery-order-parts"/u,
    );
    // By likes, most first.
    const liked = renderToStaticMarkup(
      createElement(GalleryOrderMenu, { order: "likes", onChoose: () => {} }),
    );
    expect(liked).toContain('aria-label="Order: Most liked"');
    expect(liked).toMatch(
      /aria-checked="true" data-testid="gallery-order-likes"/u,
    );
    expect(liked).not.toContain("gallery-order-name");
  });
});
