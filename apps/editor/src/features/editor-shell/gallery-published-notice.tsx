import { useEffect, useRef } from "react";

export interface GalleryPublishedNoticeState {
  id: string;
  name: string;
  updated: boolean;
}

/**
 * Says that a publish or an update reached the Gallery, and links to the
 * circuit there. The dialog closes on success, and a line in the status bar
 * alone was easy to miss.
 */
export function GalleryPublishedNotice({
  notice,
  onDismiss,
}: {
  notice: GalleryPublishedNoticeState;
  onDismiss: () => void;
}) {
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  useEffect(() => {
    const timer = setTimeout(() => dismiss.current(), 10_000);
    return () => clearTimeout(timer);
  }, [notice]);
  return (
    <aside
      className="gallery-published-notice"
      data-testid="gallery-published-notice"
      aria-label="Gallery publication"
    >
      <span role="status">
        <span className="gallery-published-notice-mark" aria-hidden="true">
          ✓
        </span>{" "}
        {notice.updated
          ? `Updated “${notice.name}” in the Gallery`
          : `Published “${notice.name}” to the Gallery`}
      </span>
      <a href={`/g/${notice.id}`} target="_blank" rel="noreferrer">
        View in Gallery
      </a>
      <button
        type="button"
        aria-label="Dismiss publication notice"
        onClick={() => dismiss.current()}
      >
        ×
      </button>
    </aside>
  );
}
