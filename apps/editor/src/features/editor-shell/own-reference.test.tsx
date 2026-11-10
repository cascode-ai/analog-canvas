// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// The dialog's mark lives in sessionStorage.
afterEach(() => window.sessionStorage.clear());

/** A fresh page at `address`: the reference window's state, and its opener. */
async function page(address: string) {
  vi.resetModules();
  window.history.replaceState(null, "", address);
  const { openOwnReference, useOwnReferenceOpen } =
    await import("./own-reference");
  const seen: boolean[] = [];
  function Probe() {
    seen.push(useOwnReferenceOpen());
    return null;
  }
  const root = createRoot(window.document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
  return { seen, open: () => act(async () => openOwnReference()), root };
}

it("opens beside a drawing", async () => {
  const { seen, root } = await page("/editor");
  expect(seen.at(-1)).toBe(true);
  root.unmount();
});

it("starts closed on a phone, and opens there on request (#2151)", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(max-width: 640px)",
  }));
  try {
    const { seen, open, root } = await page("/editor");
    expect(seen.at(-1)).toBe(false);
    await open();
    expect(seen.at(-1)).toBe(true);
    root.unmount();
  } finally {
    vi.unstubAllGlobals();
  }
});

it("starts closed in the PowerPoint dialog, and opens there on request", async () => {
  const { seen, open, root } = await page("/editor?office=dialog");
  expect(seen.at(-1)).toBe(false);
  await open();
  expect(seen.at(-1)).toBe(true);
  root.unmount();
});
