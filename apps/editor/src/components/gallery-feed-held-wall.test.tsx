// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { GalleryFeedEntry } from "../gallery-client";
import { GalleryFeed } from "./gallery-feed";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => {
  vi.unstubAllGlobals();
  window.sessionStorage.clear();
});

const entry = (id: string, name: string): GalleryFeedEntry => ({
  id,
  name,
  author: "Maker",
  ownerUserId: "maker",
  description: "",
  createdAt: "2026-10-09T08:00:00.000Z",
  previewRevision: "a".repeat(64),
  schemaVersion: 1,
  tags: ["amplifier"],
  netlistable: true,
  likes: 0,
  likedByViewer: false,
});

/** A first page as the Worker sends it. */
const page = (entries: GalleryFeedEntry[], search?: string) => ({
  entries,
  nextCursor: null,
  total: entries.length,
  filterCounts: {
    attention: 0,
    netlistable: entries.length,
    withoutNetlist: 0,
    ai: 0,
    human: entries.length,
    liked: 0,
    withoutReference: entries.length,
    componentRanges: {},
  },
  authors: [{ author: "Maker", ownerUserId: "maker", count: entries.length }],
  sources: {},
  ...(search === undefined ? {} : { search }),
});

it("keeps the wall on screen while a search no loaded circuit matches is answered (#2160)", async () => {
  window.history.replaceState(null, "", "/");
  // jsdom lays nothing out; the sidebar and the wall only watch sizes.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  let answer: ((response: Response) => void) | null = null;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = new URL(String(input), "https://canvas.test");
      if (url.pathname === "/api/auth/me") return Response.json({ user: null });
      if (url.pathname === "/api/gallery/tags")
        return Response.json({ tags: [], groups: [] });
      if (url.pathname === "/api/gallery/sources")
        return Response.json({ sources: [] });
      if (url.pathname === "/api/gallery") {
        if (url.searchParams.get("q") === "bandgap")
          return new Promise<Response>((resolve) => (answer = resolve));
        return Response.json(
          page([entry("m1", "Current mirror"), entry("f1", "Folded cascode")]),
        );
      }
      return Response.json({ error: "not-found" }, { status: 404 });
    }),
  );
  const host = window.document.createElement("div");
  window.document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(GalleryFeed, {})));
  const tile = (id: string) =>
    host.querySelector(`[data-testid="gallery-tile-${id}"]`);
  await vi.waitFor(() => expect(tile("m1")).not.toBeNull());

  // Words no loaded circuit matches: the wall stays, dimmed, while they are
  // typed and while the server answers them.
  const search = host.querySelector<HTMLInputElement>(
    '[data-testid="gallery-search"]',
  )!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )!.set!.call(search, "bandgap");
    search.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const wall = () => host.querySelector("section.gallery-wall");
  expect(tile("m1")).not.toBeNull();
  expect(wall()?.getAttribute("aria-busy")).toBe("true");
  await vi.waitFor(() => expect(answer).not.toBeNull(), { timeout: 2000 });
  expect(host.querySelector('[data-testid="gallery-loading"]')).toBeNull();
  expect(tile("m1")).not.toBeNull();
  expect(tile("f1")).not.toBeNull();
  expect(wall()?.getAttribute("aria-busy")).toBe("true");

  // The answer replaces it.
  await act(async () =>
    answer!(Response.json(page([entry("b1", "Bandgap")], "bandgap"))),
  );
  await vi.waitFor(() => expect(tile("b1")).not.toBeNull());
  expect(tile("m1")).toBeNull();
  expect(wall()?.getAttribute("aria-busy")).toBe("false");
  await act(async () => root.unmount());
  host.remove();
});
