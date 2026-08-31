import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { galleryEntryMatchesQuery } from "../../gallery-client";
import { libraryProjectExamples } from "../../examples/library-examples";
import { deriveGalleryPanelView, ExamplesPanel } from "./examples-panel";

function entry(
  overrides: Partial<Parameters<typeof galleryEntryMatchesQuery>[0]> & {
    id: string;
  },
) {
  return {
    name: "Ring Oscillator",
    author: "Mei Chen",
    description: "Three-stage inverter ring",
    createdAt: "2026-08-30T00:00:00.000Z",
    schemaVersion: 33,
    tags: ["clock"],
    ...overrides,
  } as never;
}

describe("ExamplesPanel", () => {
  it("presents every bundled example outside the Library device panel", () => {
    const markup = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        onOpenExample: () => undefined,
      }),
    );

    expect(markup).toContain('data-testid="examples-panel"');
    expect(markup).not.toContain('data-testid="shapes-fold-library"');
    expect(markup.match(/data-testid="shapes-example-/g)).toHaveLength(
      libraryProjectExamples.length,
    );
    for (const example of libraryProjectExamples) {
      expect(markup).toContain(`data-testid="shapes-example-${example.id}"`);
      expect(markup).toContain(example.name);
    }
  });
});

/**
 * The panel and the Gallery wall must answer the same question the same way.
 * These cases drive the panel's derivation with the SHARED matcher and count
 * wording, so a change that makes one surface disagree with the other has to
 * fail here rather than be discovered by a person who searched in both places.
 */
describe("gallery panel view", () => {
  const feed = {
    status: "ready" as const,
    entries: [
      entry({ id: "g-1" }),
      entry({ id: "g-2", name: "Bandgap", author: "Lin", tags: ["bias"] }),
    ],
    nextCursor: null,
    total: 120,
  };

  it("says the wall's size from the server, never a guess", () => {
    expect(
      deriveGalleryPanelView(feed, { searchQuery: "", selectedTags: [] })
        .countLabel,
    ).toBe("120 circuits");
    // A pre-totals API answers null; the panel then says nothing at all.
    expect(
      deriveGalleryPanelView(
        { ...feed, total: null },
        { searchQuery: "", selectedTags: [] },
      ).countLabel,
    ).toBeNull();
  });

  it("names a server-side narrowing as filtered, matching the wall", () => {
    expect(
      deriveGalleryPanelView(feed, {
        searchQuery: "",
        selectedTags: ["bias"],
      }).countLabel,
    ).toBe("120 filtered circuits");
  });

  it("counts text matches separately from the wall's size", () => {
    const view = deriveGalleryPanelView(feed, {
      searchQuery: "bandgap",
      selectedTags: [],
    });
    expect(view.visibleEntries.map((candidate) => candidate.id)).toEqual([
      "g-2",
    ]);
    expect(view.countLabel).toBe("120 circuits · 1 match");
  });

  it("searches the same fields the wall searches", () => {
    // name / author / description / tag — one case each, through the shared
    // matcher, so the panel cannot quietly narrow the search.
    for (const query of ["ring", "mei", "three-stage", "clock"]) {
      const view = deriveGalleryPanelView(feed, {
        searchQuery: query,
        selectedTags: [],
      });
      expect(view.visibleEntries.some((c) => c.id === "g-1")).toBe(true);
    }
  });

  it("does not deny a circuit it has not fetched yet", () => {
    const paging = { ...feed, nextCursor: "cursor-1" };
    const view = deriveGalleryPanelView(paging, {
      searchQuery: "zzz",
      selectedTags: [],
    });
    expect(view.emptyMessage).toBe(
      "No matches yet — searching older circuits…",
    );
    expect(view.countLabel).toBe("120 circuits · 0 matches so far");
  });

  it("says nothing matches only once the feed is exhausted", () => {
    const view = deriveGalleryPanelView(feed, {
      searchQuery: "zzz",
      selectedTags: [],
    });
    expect(view.emptyMessage).toBe("No circuits match “zzz”.");
    expect(view.countLabel).toBe("120 circuits · 0 matches");
  });

  it("stands the bundled circuits in while the feed is unavailable", () => {
    for (const status of ["loading", "unavailable"] as const) {
      const view = deriveGalleryPanelView(
        { status, entries: [], nextCursor: null, total: null },
        { searchQuery: "", selectedTags: [] },
      );
      expect(view.showGallery).toBe(false);
      expect(view.countLabel).toBeNull();
    }
  });
});

describe("user examples section", () => {
  it("previews each circuit rather than only naming it", () => {
    const markup = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        onOpenExample: () => undefined,
      }),
    );

    // A name and a sentence do not tell you whether a circuit is the one you
    // want to borrow from, so every card carries the circuit itself.
    expect(markup).toContain('class="shapes-example-preview"');
    expect(markup).toContain("<svg");
    // Columns follow the panel's dragged width rather than a second control
    // for the same thing.
    expect(markup).not.toContain('data-testid="gallery-column-slider"');
  });

  it("keeps the gallery as the only place circuits are stored", () => {
    const markup = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        onOpenExample: () => undefined,
      }),
    );

    expect(markup).not.toContain("My example");
    expect(markup).not.toContain("user-examples-section");
  });
});
