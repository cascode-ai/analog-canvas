import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { GalleryOrderMenu } from "./components/gallery-order-menu";
import {
  GALLERY_ORDER_KEY,
  GALLERY_SEED_GLOBAL,
  galleryOrderPreference,
  galleryShuffleSeed,
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

  it("names the order on its button and checks it in the menu", () => {
    const html = renderToStaticMarkup(
      createElement(GalleryOrderMenu, { order: "random", onChoose: () => {} }),
    );
    expect(html).toContain('aria-label="Order: Random"');
    expect(html).toContain("Shuffle again");
    expect(html).toMatch(
      /aria-checked="true" data-testid="gallery-order-random"/u,
    );
    const parts = renderToStaticMarkup(
      createElement(GalleryOrderMenu, { order: "parts", onChoose: () => {} }),
    );
    expect(parts).toContain('aria-label="Order: Most parts"');
    expect(parts).toMatch(
      /aria-checked="true" data-testid="gallery-order-parts"/u,
    );
  });
});
