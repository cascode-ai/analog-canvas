// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";

import { GalleryEntryGate, galleryEntryPresence } from "./gallery-entry-gate";
import { GalleryEntryMissing } from "./missing-page";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const answering = (status: number | "offline") =>
  (async (input: string) => {
    if (status === "offline") throw new TypeError("Failed to fetch");
    expect(input).toBe("/api/gallery/zzzzzzzzzz?summary=1");
    return Response.json(
      status === 404 ? { error: "not-found" } : { entry: { id: "zzzzzzzzzz" } },
      { status },
    );
  }) as typeof fetch;

it("calls an entry gone only when the Gallery says 404 (#2159)", async () => {
  expect(await galleryEntryPresence(answering(404), "zzzzzzzzzz")).toBe(false);
  expect(await galleryEntryPresence(answering(200), "zzzzzzzzzz")).toBe(true);
  // An outage leaves the editor to say what failed.
  expect(await galleryEntryPresence(answering(503), "zzzzzzzzzz")).toBe(true);
  expect(await galleryEntryPresence(answering("offline"), "zzzzzzzzzz")).toBe(
    true,
  );
});

it("opens no editor for a circuit the Gallery does not hold", async () => {
  const shown = async (presence: Promise<boolean> | null) => {
    const host = window.document.createElement("div");
    const root = createRoot(host);
    await act(async () =>
      root.render(
        createElement(GalleryEntryGate, {
          presence,
          missing: "missing page",
          children: "the editor",
        }),
      ),
    );
    const text = host.textContent;
    await act(async () => root.unmount());
    return text;
  };
  expect(await shown(Promise.resolve(false))).toBe("missing page");
  expect(await shown(Promise.resolve(true))).toBe("the editor");
  expect(await shown(null)).toBe("the editor");
  expect(await shown(new Promise(() => undefined))).toBe("Loading editor…");
});

it("says the circuit is not in the Gallery, with the way back", () => {
  const page = renderToStaticMarkup(createElement(GalleryEntryMissing, {}));
  expect(page).toContain("This circuit is not in the Gallery.");
  expect(page).toContain("It was withdrawn, or the link is wrong.");
  expect(page).toContain('<a href="/">Back to the Gallery</a>');
});
