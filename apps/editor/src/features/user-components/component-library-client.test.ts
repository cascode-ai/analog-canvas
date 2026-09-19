import { afterEach, describe, expect, it, vi } from "vitest";
import { newComponentDefinition } from "./component-definition-edit";
import {
  loadSharedComponents,
  saveSharedComponent,
} from "./component-library-client";

afterEach(() => vi.unstubAllGlobals());

describe("public component library responses", () => {
  it.each([
    () => new Response("<!doctype html><html></html>"),
    () => Response.json({}),
    () => Response.json({ entries: [null], nextCursor: null }),
  ])(
    "rejects an unavailable or malformed service without passing broken state to the library",
    async (response) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => response()),
      );
      await expect(loadSharedComponents("", null)).rejects.toThrow(
        "Component library unavailable",
      );
    },
  );

  it("accepts an empty public library", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ entries: [], nextCursor: null })),
    );
    await expect(loadSharedComponents("", null)).resolves.toEqual({
      entries: [],
      nextCursor: null,
    });
  });

  it("never treats a malformed successful save as a publicly saved definition", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ entry: {} })),
    );
    await expect(
      saveSharedComponent("test-component", 0, newComponentDefinition()),
    ).rejects.toThrow("invalid entry");
  });

  it("preserves the server's useful save failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ error: "Sign in to save" }, { status: 401 }),
      ),
    );
    await expect(
      saveSharedComponent("test-component", 0, newComponentDefinition()),
    ).rejects.toThrow("Sign in to save");
  });
});
