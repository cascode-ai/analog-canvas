import type { MouseEvent } from "react";

import {
  dailyOpenResetTime,
  type GalleryDailyOpenLimit,
} from "../../gallery-client";

/**
 * Shown in the middle of the canvas when a Gallery circuit cannot open
 * because the account has opened its share for the day: an empty canvas
 * alone looks like a broken link. It does not hold the canvas; the editor
 * clears it on the next open or tab change.
 */
export function GalleryDailyLimitCard({
  limit,
  onBackToGallery,
  onClose,
}: {
  limit: GalleryDailyOpenLimit;
  /** Leaves through the editor's guard for unsaved work, as the header does. */
  onBackToGallery: () => void;
  onClose: () => void;
}) {
  // A modified click opens the Gallery in another tab, as any link would.
  const backToGallery = (event: MouseEvent<HTMLAnchorElement>): void => {
    if (
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey
    )
      return;
    event.preventDefault();
    onBackToGallery();
  };
  return (
    <div
      className="gallery-daily-limit-card"
      role="status"
      aria-labelledby="gallery-daily-limit-title"
      aria-describedby="gallery-daily-limit-when"
      data-testid="gallery-daily-limit-card"
    >
      <h2 id="gallery-daily-limit-title">
        You’ve opened {limit.limit} Gallery circuits today
      </h2>
      <p id="gallery-daily-limit-when">
        You can open more after {dailyOpenResetTime(limit)}.
      </p>
      <div className="gallery-daily-limit-actions">
        <a
          className="gallery-daily-limit-primary"
          href="/"
          onClick={backToGallery}
        >
          Back to Gallery
        </a>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
