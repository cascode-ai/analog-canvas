import { useEffect, useState } from "react";

import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { libraryProjectExamples } from "../examples/library-examples";
import { GalleryChrome } from "./gallery-chrome";
import { Masonry } from "./masonry";

export interface GalleryFeedEntry {
  id: string;
  name: string;
  author: string;
  description: string;
  createdAt: string;
  schemaVersion: number;
}

export type GalleryFeedState =
  | { status: "loading" }
  | { status: "ready"; entries: GalleryFeedEntry[] }
  | { status: "unavailable" };

const resolver = new InMemorySymbolResolver(builtInSymbols);

function savedAtLabel(createdAt: string): string {
  const parsed = new Date(createdAt);
  return Number.isNaN(parsed.getTime())
    ? createdAt
    : parsed.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

/** Bundled examples double as never-empty starter tiles for the feed. */
function bundledTiles() {
  return libraryProjectExamples.map((example) => {
    const topDocument = example.project.documents.find(
      (document) => document.id === example.project.topDocumentId,
    )!;
    return {
      id: example.id,
      name: example.name,
      description: example.description,
      svg: renderDocumentSvg(topDocument, resolver),
    };
  });
}

export async function loadGalleryFeed(
  fetchLike: typeof fetch = fetch,
): Promise<GalleryFeedState> {
  try {
    const response = await fetchLike("/api/gallery", {
      credentials: "same-origin",
    });
    if (!response.ok) return { status: "unavailable" };
    const payload = (await response.json()) as {
      entries?: GalleryFeedEntry[];
    };
    return { status: "ready", entries: payload.entries ?? [] };
  } catch {
    return { status: "unavailable" };
  }
}

/**
 * Full-screen landing feed: every tile is one published circuit that opens
 * in the editor at `/g/<id>`. Bundled Library examples fill the wall while
 * the community gallery is empty or unreachable (development hosts have no
 * worker), so the landing page is never blank.
 */
export function GalleryFeed() {
  const [state, setState] = useState<GalleryFeedState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadGalleryFeed().then((next) => {
      if (!cancelled) setState(next);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const entries = state.status === "ready" ? state.entries : [];

  return (
    <main className="gallery-shell" data-testid="gallery-feed">
      <GalleryChrome subtitle="Community gallery" />

      {state.status === "loading" ? (
        <p className="gallery-status" data-testid="gallery-loading">
          Loading gallery…
        </p>
      ) : (
        <section className="gallery-wall">
          <Masonry
            aria-label="Published circuits"
            items={[
              ...entries.map((entry) => ({
                key: entry.id,
                node: (
                  <a
                    className="gallery-tile"
                    href={`/g/${entry.id}`}
                    data-testid={`gallery-tile-${entry.id}`}
                  >
                    <span className="gallery-tile-preview">
                      <img
                        src={`/api/gallery/${entry.id}/preview.svg`}
                        alt={`Preview of ${entry.name}`}
                        loading="lazy"
                      />
                    </span>
                    <span className="gallery-tile-copy">
                      <span className="gallery-tile-name">{entry.name}</span>
                      <span className="gallery-tile-meta">
                        {entry.author ? `${entry.author} · ` : ""}
                        {savedAtLabel(entry.createdAt)}
                      </span>
                      {entry.description ? (
                        <span className="gallery-tile-description">
                          {entry.description}
                        </span>
                      ) : null}
                    </span>
                  </a>
                ),
              })),
              ...(entries.length === 0
                ? bundledTiles().map((tile) => ({
                    key: `bundled-${tile.id}`,
                    node: (
                      <a
                        className="gallery-tile gallery-tile-bundled"
                        href={`/editor?example=${tile.id}`}
                        data-testid={`gallery-bundled-${tile.id}`}
                      >
                        <span
                          className="gallery-tile-preview"
                          // Server-free preview: our own renderer's escaped SVG output.
                          dangerouslySetInnerHTML={{ __html: tile.svg }}
                        />
                        <span className="gallery-tile-copy">
                          <span className="gallery-tile-kicker">
                            Built-in example
                          </span>
                          <span className="gallery-tile-name">{tile.name}</span>
                          <span className="gallery-tile-description">
                            {tile.description}
                          </span>
                        </span>
                      </a>
                    ),
                  }))
                : []),
            ]}
          />
        </section>
      )}
      <footer className="gallery-footnote">
        Browse freely; open any circuit and edit your own copy. Publishing joins
        in a later release with sign-in.
      </footer>
    </main>
  );
}
