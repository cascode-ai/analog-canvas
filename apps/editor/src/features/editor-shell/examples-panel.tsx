import { useMemo } from "react";

import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import {
  libraryProjectExamples,
  type LibraryProjectExample,
} from "../../examples/library-examples";

export interface GalleryExampleSummary {
  id: string;
  name: string;
  author: string;
  description: string;
}

export interface ExamplesPanelProps {
  open: boolean;
  /**
   * The community gallery — the same source as the landing feed. Null or
   * empty falls back to the bundled starter circuits (offline dev).
   */
  galleryExamples?: readonly GalleryExampleSummary[] | null;
  onOpenGalleryExample?(id: string): void;
  onOpenExample(example: LibraryProjectExample): void;
}

const resolver = new InMemorySymbolResolver(builtInSymbols);

/**
 * The circuit gallery, docked beside the canvas. Every card carries a preview
 * of the circuit itself: a name and a sentence do not tell you whether a
 * circuit is the one you want to borrow from.
 */
export function ExamplesPanel({
  open,
  galleryExamples = null,
  onOpenGalleryExample,
  onOpenExample,
}: ExamplesPanelProps) {
  const showGallery = galleryExamples !== null && galleryExamples.length > 0;

  // Bundled circuits render from the same renderer the feed uses; the work is
  // per circuit, not per relayout, so it is memoized rather than repeated.
  const bundledPreviews = useMemo(
    () =>
      new Map(
        libraryProjectExamples.map((example) => {
          const topDocument = example.project.documents.find(
            (candidate) => candidate.id === example.project.topDocumentId,
          )!;
          return [example.id, renderDocumentSvg(topDocument, resolver)];
        }),
      ),
    [],
  );

  return (
    <aside
      id="examples-panel"
      className={
        open ? "shapes-panel examples-panel" : "shapes-panel collapsed"
      }
      aria-label="Gallery"
      aria-hidden={!open}
      inert={!open ? true : undefined}
      data-testid="examples-panel"
      data-open={open ? "true" : "false"}
    >
      <div className="shapes-panel-body">
        {/* Columns follow the panel's dragged width, the same way the Library
            tiles do; a separate control for the same thing is one knob too
            many. */}
        <div className="shapes-example-list">
          {showGallery
            ? galleryExamples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  className="shapes-example-card"
                  data-testid={`gallery-example-${example.id}`}
                  aria-label={`Insert gallery circuit ${example.name}`}
                  title={`Insert ${example.name}`}
                  onClick={() => onOpenGalleryExample?.(example.id)}
                >
                  <span className="shapes-example-preview">
                    <img
                      src={`/api/gallery/${example.id}/preview.svg`}
                      alt=""
                      loading="lazy"
                    />
                  </span>
                  <span className="shapes-example-copy">
                    <span className="shapes-example-kicker">
                      {example.author || "Gallery"}
                    </span>
                    <span className="shapes-example-name">{example.name}</span>
                  </span>
                </button>
              ))
            : libraryProjectExamples.map((example) => (
                <button
                  key={example.id}
                  type="button"
                  className="shapes-example-card"
                  data-testid={`shapes-example-${example.id}`}
                  aria-label={`Insert example ${example.name}`}
                  title={`Insert ${example.name}`}
                  onClick={() => onOpenExample(example)}
                >
                  <span
                    className="shapes-example-preview"
                    // Server-free preview: our own renderer's escaped output.
                    dangerouslySetInnerHTML={{
                      __html: bundledPreviews.get(example.id) ?? "",
                    }}
                  />
                  <span className="shapes-example-copy">
                    <span className="shapes-example-kicker">Example</span>
                    <span className="shapes-example-name">{example.name}</span>
                  </span>
                </button>
              ))}
        </div>
      </div>
    </aside>
  );
}
