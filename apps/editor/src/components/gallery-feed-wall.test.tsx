// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import { useGalleryWall } from "./gallery-feed-wall";
import { OPEN_SIGN_IN_EVENT, takeSignInRequest } from "./sign-in-request";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

afterEach(() => vi.unstubAllGlobals());

it("opens the page's sign-in choices when a signed-out reader likes a circuit (#2157)", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({ error: "unauthorized" }, { status: 401 }),
    ),
  );
  let toggleLike: ((id: string) => Promise<void>) | null = null;
  function Probe() {
    ({ toggleLike } = useGalleryWall({
      active: false,
      preload: undefined,
      feedQuery: {},
      searchQuery: "",
      serverSearch: "",
      likedOnly: false,
    }));
    return null;
  }
  const root = createRoot(window.document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  const opened = new Promise<void>((resolve) =>
    window.addEventListener(OPEN_SIGN_IN_EVENT, () => resolve(), {
      once: true,
    }),
  );
  const before = window.location.href;
  await act(async () => toggleLike!("a1b2c3"));
  await opened;
  expect(takeSignInRequest()).toBe(true);
  // The page stays where it was: no provider is chosen for the reader.
  expect(window.location.href).toBe(before);
  await act(async () => root.unmount());
});
