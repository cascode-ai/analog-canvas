import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { libraryProjectExamples } from "../../examples/library-examples";
import { ExamplesPanel } from "./examples-panel";

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

describe("gallery-backed library", () => {
  it("lists the community gallery when available and falls back bundled", () => {
    const gallery = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        galleryExamples: [
          {
            id: "g-1",
            name: "StrongArm Comparator",
            author: "Zhishuai Zhang",
            description: "Clocked comparator",
          },
        ],
        onOpenGalleryExample: () => undefined,
        onOpenExample: () => undefined,
      }),
    );
    expect(gallery).toContain('data-testid="gallery-example-g-1"');
    expect(gallery).toContain("StrongArm Comparator");
    expect(gallery).toContain("Zhishuai Zhang");
    expect(gallery).not.toContain('data-testid="shapes-example-');

    const fallback = renderToStaticMarkup(
      createElement(ExamplesPanel, {
        open: true,
        galleryExamples: null,
        onOpenExample: () => undefined,
      }),
    );
    expect(fallback).toContain('data-testid="shapes-example-');
    expect(fallback).not.toContain('data-testid="gallery-example-');
  });
});

describe("user examples section", () => {
  it("previews each circuit and lets the reader choose the column count", () => {
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
    expect(markup).toContain('data-testid="gallery-column-slider"');
    expect(markup).toContain('aria-label="Gallery columns"');
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
