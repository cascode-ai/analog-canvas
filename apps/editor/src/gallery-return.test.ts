import { describe, expect, it } from "vitest";
import {
  forgetGalleryReturn,
  galleryReturnStep,
  galleryReturnTo,
  rememberGalleryReturn,
} from "./gallery-return";

function memoryStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, value),
    removeItem: (key: string) => void store.delete(key),
  };
}

describe("coming back to the Gallery wall", () => {
  it("finds the circuit opened from the same wall, once", () => {
    const storage = memoryStorage();
    rememberGalleryReturn(
      { wall: "order=random&seed=abc", entryId: "e85", loaded: 96 },
      storage,
    );
    // Another filter, order or shuffle is another wall.
    expect(galleryReturnTo("order=newest", storage)).toBeNull();
    expect(galleryReturnTo("order=random&seed=abc", storage)).toEqual({
      wall: "order=random&seed=abc",
      entryId: "e85",
      loaded: 96,
    });
    forgetGalleryReturn(storage);
    expect(galleryReturnTo("order=random&seed=abc", storage)).toBeNull();
  });

  it("pages down to the circuit, and stops past where the reader had paged", () => {
    const target = { wall: "w", entryId: "e85", loaded: 96 };
    const ids = (count: number) =>
      Array.from({ length: count }, (_, index) => `e${index}`);
    expect(galleryReturnStep(target, ids(48), true)).toBe("page");
    expect(galleryReturnStep(target, ids(96), true)).toBe("found");
    // Gone from the wall: the end, or far past where it was.
    const gone = { ...target, entryId: "withdrawn" };
    expect(galleryReturnStep(gone, ids(96), false)).toBe("stop");
    expect(galleryReturnStep(gone, ids(240), true)).toBe("stop");
  });

  it("ignores a record it cannot read", () => {
    const storage = memoryStorage();
    storage.setItem("icm.gallery.return", "{not json");
    expect(galleryReturnTo("w", storage)).toBeNull();
    storage.setItem(
      "icm.gallery.return",
      JSON.stringify({ wall: "w", entryId: "../x", loaded: 1 }),
    );
    expect(galleryReturnTo("w", storage)).toBeNull();
  });
});
