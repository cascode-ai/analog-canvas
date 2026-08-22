import { useMemo, useState } from "react";

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

const COLUMN_STORAGE_KEY = "icm.gallery-panel-columns.v1";
const MIN_COLUMNS = 1;
const MAX_COLUMNS = 4;

const resolver = new InMemorySymbolResolver(builtInSymbols);

function initialColumns(): number {
  if (typeof window === "undefined") return 1;
  const stored = Number(window.localStorage.getItem(COLUMN_STORAGE_KEY));
  return Number.isFinite(stored) &&
    stored >= MIN_COLUMNS &&
    stored <= MAX_COLUMNS
    ? stored
    : 1;
}

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
  const [columns, setColumns] = useState(initialColumns);
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

  const changeColumns = (next: number): void => {
    setColumns(next);
    try {
      window.localStorage.setItem(COLUMN_STORAGE_KEY, String(next));
    } catch {
      // Column count stays usable when browser storage is unavailable.
    }
  };

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
        <label className="gallery-column-control">
          <span>Columns</span>
          <input
            type="range"
            min={MIN_COLUMNS}
            max={MAX_COLUMNS}
            step={1}
            value={columns}
            aria-label="Gallery columns"
            data-testid="gallery-column-slider"
            onChange={(event) =>
              changeColumns(Number(event.currentTarget.value))
            }
          />
          <output>{columns}</output>
        </label>
        <div
          className="shapes-example-list"
          data-columns={columns}
          style={{ "--icm-gallery-columns": columns } as React.CSSProperties}
        >
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
