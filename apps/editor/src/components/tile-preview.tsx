import { useState } from "react";

/**
 * A gallery/shelf thumbnail that degrades gracefully: when the preview
 * request fails (a shelf saved before previews existed and not yet
 * backfilled, or a drawing the renderer cannot handle), the tile shows a
 * quiet schematic placeholder instead of the browser's broken-image glyph.
 */
export function TilePreview({
  src,
  alt,
  width,
  height,
}: {
  src: string;
  alt: string;
  width?: number;
  height?: number;
}) {
  const [failed, setFailed] = useState(false);
  const hasIntrinsicSize =
    typeof width === "number" &&
    Number.isFinite(width) &&
    width > 0 &&
    typeof height === "number" &&
    Number.isFinite(height) &&
    height > 0;
  return (
    <span
      className={
        failed
          ? "gallery-tile-preview gallery-tile-preview-missing"
          : "gallery-tile-preview"
      }
    >
      {failed ? (
        <svg
          className="gallery-tile-placeholder"
          viewBox="0 0 96 64"
          role="img"
          aria-label={alt}
        >
          <path
            d="M8 40h14l4-10 6 20 6-24 6 20 4-6h14"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="70" cy="40" r="3" fill="currentColor" />
          <path
            d="M73 40h15"
            stroke="currentColor"
            strokeWidth="2.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <img
          src={src}
          alt={alt}
          loading="lazy"
          decoding="async"
          {...(hasIntrinsicSize ? { width, height } : {})}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}
