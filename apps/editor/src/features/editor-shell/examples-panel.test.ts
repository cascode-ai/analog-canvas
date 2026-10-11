import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { galleryEntryMatchesQuery } from "../../gallery-search";
import { libraryProjectExamples } from "../../examples/library-examples";
import { deriveGalleryPanelView, ExamplesPanel } from "./examples-panel";
import { LocalExamplesCards } from "./local-examples-cards";

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
  it("does not resolve or render example projects while closed", () => {
    const reads = libraryProjectExamples.map((example) =>
      vi.spyOn(example, "project", "get").mockImplementation(() => {
        throw new Error("closed panel read a project");
      }),
    );
    try {
      const markup = renderToStaticMarkup(
        createElement(ExamplesPanel, {
          open: false,
          onOpenExample: () => undefined,
        }),
      );
      expect(markup).not.toContain("<svg");
      for (const read of reads) expect(read).not.toHaveBeenCalled();
    } finally {
      reads.forEach((read) => read.mockRestore());
    }
  });
  it("presents every bundled example outside the Library device panel", () => {
    const markup = renderToStaticMarkup(
      createElement(LocalExamplesCards, {
        onOpenExample: () => undefined,
      }),
    );

    expect(markup).toContain("<svg");
    expect(markup).not.toContain('data-testid="shapes-fold-library"');
    expect(markup).not.toContain('data-testid="gallery-topology-check"');
    expect(markup).not.toContain("Check current topology");
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
    expect(deriveGalleryPanelView(feed, { searchQuery: "" }).countLabel).toBe(
      "120 circuits",
    );
    // A pre-totals API answers null; the panel then says nothing at all.
    expect(
      deriveGalleryPanelView({ ...feed, total: null }, { searchQuery: "" })
        .countLabel,
    ).toBeNull();
  });

  it("counts text matches separately from the wall's size", () => {
    const view = deriveGalleryPanelView(feed, {
      searchQuery: "bandgap",
    });
    expect(view.visibleEntries.map((candidate) => candidate.id)).toEqual([
      "g-2",
    ]);
    expect(view.countLabel).toBe("120 circuits · 1 match");
  });

  it("searches the same fields the wall searches", () => {
    // name / author / description / tag — one case each, through the shared
    // matcher, so the panel cannot quietly narrow the search.
    for (const query of ["ring", "mei", "three-stage", "stgae", "clock"]) {
      const view = deriveGalleryPanelView(feed, {
        searchQuery: query,
      });
      expect(view.visibleEntries.some((c) => c.id === "g-1")).toBe(true);
    }
  });

  it("does not deny a circuit it has not fetched yet", () => {
    const paging = { ...feed, nextCursor: "cursor-1" };
    const view = deriveGalleryPanelView(paging, {
      searchQuery: "zzz",
    });
    expect(view.emptyMessage).toBe(
      "No matches yet — searching older circuits…",
    );
    expect(view.countLabel).toBe("120 circuits · 0 matches so far");
  });

  it("takes the server's answer to a search as the whole answer", () => {
    // What the server found for "bandgap": its total is the matches, and an
    // unread cursor holds more matches, not circuits still to check.
    const answered = {
      ...feed,
      entries: [feed.entries[1]!],
      total: 7,
      nextCursor: "cursor-1",
      search: "bandgap",
    };
    const view = deriveGalleryPanelView(answered, { searchQuery: "bandgap" });
    expect(view.visibleEntries.map((candidate) => candidate.id)).toEqual([
      "g-2",
    ]);
    expect(view.countLabel).toBe("7 matching circuits");
    expect(view.emptyMessage).toBeNull();
    // Nothing found is a verdict at once, with no older pages to search.
    const none = deriveGalleryPanelView(
      { ...feed, entries: [], total: 0, search: "zzz" },
      { searchQuery: "zzz" },
    );
    expect(none.showGallery).toBe(true);
    expect(none.emptyMessage).toBe("No circuits match “zzz”.");
    expect(none.countLabel).toBe("0 matching circuits");
    // Still typing: the loaded answer is for other words, so narrow it.
    expect(
      deriveGalleryPanelView(answered, { searchQuery: "bandgap x" })
        .emptyMessage,
    ).toBe("Searching…");
  });

  it("does not present an old search count as the next query's answer during debounce", () => {
    const answered = {
      ...feed,
      entries: [feed.entries[1]!],
      total: 1,
      search: "bandgap",
    };
    for (const searchQuery of ["clock", ""]) {
      const view = deriveGalleryPanelView(answered, { searchQuery });
      expect(view.countLabel).toBeNull();
      expect(view.emptyMessage).toBe(searchQuery ? "Searching…" : null);
    }
  });

  it("does not call the entire Gallery empty when leaving an empty search", () => {
    const emptySearch = { ...feed, entries: [], total: 0, search: "amp" };
    for (const searchQuery of ["clock", ""]) {
      const view = deriveGalleryPanelView(emptySearch, { searchQuery });
      expect(view.showGallery).toBe(true);
      expect(view.countLabel).toBeNull();
      expect(view.emptyMessage).toBe("Searching…");
    }
  });

  it("says nothing matches only once the feed is exhausted", () => {
    const view = deriveGalleryPanelView(feed, {
      searchQuery: "zzz",
    });
    expect(view.emptyMessage).toBe("No circuits match “zzz”.");
    expect(view.countLabel).toBe("120 circuits · 0 matches");
  });

  it("combines multi-tag OR selection with text search without duplicating circuits", () => {
    expect(
      deriveGalleryPanelView(feed, {
        searchQuery: "",
        selectedTags: ["clock", "bias"],
      }).visibleEntries.map((e) => e.id),
    ).toEqual(["g-1", "g-2"]);
    const view = deriveGalleryPanelView(feed, {
      searchQuery: "lin",
      selectedTags: ["clock", "bias"],
    });
    expect(view.visibleEntries.map((e) => e.id)).toEqual(["g-2"]);
    expect(view.countLabel).toBe("120 circuits · 1 match");
  });

  it("keeps filtered zero results in the Gallery and searches remaining pages", () => {
    const filters = { searchQuery: "", selectedTags: ["adc"] };
    const pending = deriveGalleryPanelView(
      { ...feed, nextCursor: "later" },
      filters,
    );
    expect(pending.showGallery).toBe(true);
    expect(pending.visibleEntries).toHaveLength(0);
    expect(pending.emptyMessage).toBe(
      "No matches yet — searching older circuits…",
    );
    const done = deriveGalleryPanelView(feed, filters);
    expect(done.showGallery).toBe(true);
    expect(done.emptyMessage).toBe("No circuits match these filters.");
    expect(done.countLabel).toBe("120 circuits · 0 matches");
  });

  it("stands the bundled circuits in while the feed is unavailable", () => {
    for (const status of ["loading", "unavailable"] as const) {
      const view = deriveGalleryPanelView(
        { status, entries: [], nextCursor: null, total: null },
        { searchQuery: "" },
      );
      expect(view.showGallery).toBe(false);
      expect(view.countLabel).toBeNull();
    }
  });
});

describe("user examples section", () => {
  it("previews each circuit rather than only naming it", () => {
    const markup = renderToStaticMarkup(
      createElement(LocalExamplesCards, {
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

  it("does not offer bundled examples on a non-loopback host", () => {
    const markup = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        onOpenExample: () => undefined,
      }),
    );
    expect(markup).not.toContain('data-testid="shapes-example-');
    expect(markup).toContain("Loading gallery…");
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
