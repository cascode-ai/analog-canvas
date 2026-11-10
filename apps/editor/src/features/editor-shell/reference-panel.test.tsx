// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

import type { GalleryEntryContext } from "./gallery-example-commands";
import type { ReferenceWindowProps } from "./reference-panel";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let unmount: (() => Promise<void>) | null = null;
afterEach(async () => {
  await unmount?.();
  unmount = null;
  document.body.replaceChildren();
});

/** The editor page around the window: its canvas, and Properties open. */
function editorPage() {
  const canvas = document.createElement("div");
  canvas.dataset.testid = "schematic-canvas";
  canvas.getBoundingClientRect = () => new DOMRect(0, 60, 1440, 800);
  const properties = document.createElement("aside");
  properties.dataset.canvasOverlay = "true";
  properties.getBoundingClientRect = () => new DOMRect(1080, 60, 360, 800);
  document.body.append(canvas, properties);
}

/** A fresh page: the window's remembered place and folding start over. */
async function show(props: Partial<ReferenceWindowProps> = {}) {
  vi.resetModules();
  const { ReferenceWindow } = await import("./reference-panel");
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const render = (next: Partial<ReferenceWindowProps>) =>
    act(async () =>
      root.render(
        createElement(ReferenceWindow, {
          open: true,
          onClose: () => {},
          entry: null,
          session: null,
          draft: { name: "RC filter", description: "" },
          image: null,
          onImage: () => {},
          takesPaste: () => false,
          onSaved: () => {},
          fetchLike: vi.fn(),
          ...props,
          ...next,
        }),
      ),
    );
  await render({});
  unmount = () => act(async () => root.unmount());
  const panel = () => host.querySelector<HTMLElement>(".reference-panel")!;
  return { panel, render };
}

it("starts as its title bar without a picture, clear of Properties (#2158)", async () => {
  editorPage();
  const { panel, render } = await show();
  expect(panel().classList).toContain("folded");
  expect(panel().querySelector(".reference-name")).toBeNull();
  // Fit View measures it only open.
  expect(panel().dataset.floatingWindow).toBeUndefined();
  // Left of the Properties dock, not over it.
  const left = Number.parseFloat(panel().style.left);
  const width = Number.parseFloat(panel().style.width);
  expect(left + width).toBeLessThanOrEqual(1080 - 12);

  // Asked for by name, it shows the details.
  await render({ openings: 1 });
  expect(panel().classList).not.toContain("folded");
  expect(panel().querySelector(".reference-name")).not.toBeNull();
  expect(panel().dataset.floatingWindow).toBe("project-info");
});

it("opens with a review's details, as with a picture", async () => {
  editorPage();
  const { panel } = await show({
    reviewFeedback: {
      identity: "review-1",
      label: "Review of RC filter",
      copy: async () => {},
    },
  });
  expect(panel().classList).not.toContain("folded");
  expect(panel().textContent).toContain("Review feedback");
});

it("keeps the person's own folding", async () => {
  editorPage();
  const { panel, render } = await show({ openings: 1 });
  const fold = () =>
    act(async () =>
      panel().querySelector<HTMLButtonElement>('[aria-label="Fold"]')!.click(),
    );
  await fold();
  expect(panel().classList).toContain("folded");
  // A review arriving later does not unfold what the person folded.
  await render({
    openings: 1,
    reviewFeedback: {
      identity: "review-1",
      label: "Review of RC filter",
      copy: async () => {},
    },
  });
  expect(panel().classList).toContain("folded");
});

it("is a sheet along the bottom at phone widths, its details editable (#2151)", async () => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: media === "(max-width: 640px)",
    media,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  try {
    editorPage();
    const { panel } = await show({ openings: 1 });
    expect(panel().classList).toContain("sheet");
    expect(panel().classList).not.toContain("folded");
    // Laid out by the sheet's own rules, not a floating box.
    expect(panel().getAttribute("style")).toBeNull();
    expect(panel().querySelector(".reference-resize")).toBeNull();
    expect(panel().dataset.floatingWindow).toBeUndefined();
    expect(panel().querySelector(".reference-name")).not.toBeNull();
    expect(panel().querySelector(".reference-description")).not.toBeNull();
    expect(panel().textContent).toContain("Reference picture");
  } finally {
    vi.unstubAllGlobals();
  }
});

it("moves a window off docks that open beside it", async () => {
  const { clearOfDocks } = await import("./reference-panel");
  const box = { left: 1048, top: 400, width: 380, height: 420 };
  expect(clearOfDocks(box, { left: 0, right: 1440 })).toEqual({
    ...box,
    left: 1440 - 12 - 380,
  });
  expect(clearOfDocks(box, { left: 0, right: 1080 })).toEqual({
    ...box,
    left: 1080 - 12 - 380,
  });
  // Already clear: left where the person put it.
  const placed = { ...box, left: 200 };
  expect(clearOfDocks(placed, { left: 0, right: 1080 })).toBe(placed);
  // A narrow canvas narrows it, down to its smallest.
  expect(clearOfDocks(box, { left: 0, right: 300 }).width).toBe(300 - 24);
  expect(clearOfDocks(box, { left: 0, right: 200 }).width).toBe(240);
});

it("asks for a community entry's picture only when the entry says it has one (#2163)", async () => {
  const asked = async (hasReference?: boolean) => {
    const urls: string[] = [];
    const entry: GalleryEntryContext = {
      id: "a1b2c3d4e5",
      name: "Bandgap",
      projectId: "p1",
      ownerUserId: "u1",
      author: "Carol",
      description: "",
      tags: [],
      ...(hasReference === undefined ? {} : { hasReference }),
    };
    await show({
      entry,
      fetchLike: (async (input: string) => {
        urls.push(String(input));
        return Response.json({ error: "not-found" }, { status: 404 });
      }) as typeof fetch,
    });
    await act(async () => {});
    await unmount?.();
    unmount = null;
    return urls;
  };
  expect(await asked(false)).toEqual([]);
  expect(await asked(true)).toEqual(["/api/gallery/a1b2c3d4e5/reference"]);
  // A context kept from before the entry said so still asks.
  expect(await asked()).toEqual(["/api/gallery/a1b2c3d4e5/reference"]);
});
