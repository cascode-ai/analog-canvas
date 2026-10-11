import { useMemo } from "react";
import "../styles/gallery-entry.css";
import { loadBundledGalleryTiles } from "./gallery-bundled-fallback";
import { GalleryBundledTile } from "./gallery-feed-tile";
import { GalleryChrome } from "./gallery-chrome";
import { Masonry } from "./masonry";

/** Loopback landing page: no remote feed, tags, preview or refresh subscription. */
export default function LocalExamplesPage({
  visitStats,
}: {
  visitStats?: { pv: number; uv: number } | null | undefined;
}) {
  const tiles = useMemo(loadBundledGalleryTiles, []);
  return (
    <main className="gallery-shell" data-testid="local-examples-page">
      <GalleryChrome subtitle="Built-in examples" visitStats={visitStats} />
      <div className="gallery-main">
        <section className="gallery-wall">
          <Masonry
            aria-label="Built-in examples"
            items={tiles.map((tile) => ({
              key: tile.id,
              node: <GalleryBundledTile tile={tile} />,
            }))}
          />
        </section>
      </div>
    </main>
  );
}
