import type { ReactNode } from "react";

import { galleryPreviewUrl } from "../gallery-client";
import { TilePreview } from "./tile-preview";

const STATUS_LABELS: Record<string, string> = {
  public: "Published",
  rejected: "Rejected",
  recycled: "Withdrawn",
};

/** One date format on every entry card: the day, and the time to the minute. */
export function entryCardDate(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      });
}

/**
 * A Gallery entry as a card, the same wherever entries are managed — an
 * account's own circuits and moderation alike: the drawing, which opens the
 * circuit; a status badge over the name; the date; one row of actions; and
 * last, any reason or error.
 */
export function EntryCard({
  entry,
  status,
  date,
  actions,
  notes,
  busy = false,
  testId,
  statusTestId,
  openTestId,
}: {
  entry: {
    id: string;
    name: string;
    previewRevision?: string | undefined;
    previewWidth?: number | undefined;
    previewHeight?: number | undefined;
  };
  status: string;
  date: string | null | undefined;
  actions: ReactNode;
  notes?: ReactNode;
  busy?: boolean;
  testId: string;
  statusTestId?: string;
  openTestId?: string;
}) {
  const shown = entryCardDate(date);
  return (
    <article className="entry-card" data-testid={testId} aria-busy={busy}>
      <a
        className="entry-card-open"
        href={`/g/${entry.id}`}
        title={`Open ${entry.name}`}
        {...(openTestId ? { "data-testid": openTestId } : {})}
      >
        <TilePreview
          src={galleryPreviewUrl(entry.id, entry.previewRevision)}
          alt={`Preview of ${entry.name}`}
          {...(entry.previewWidth === undefined
            ? {}
            : { width: entry.previewWidth })}
          {...(entry.previewHeight === undefined
            ? {}
            : { height: entry.previewHeight })}
        />
      </a>
      <div className="entry-card-copy">
        {/* A state, not an action: a badge over the name. */}
        <span
          className={`entry-status entry-status-${status}`}
          {...(statusTestId ? { "data-testid": statusTestId } : {})}
        >
          {STATUS_LABELS[status] ?? status}
        </span>
        <h3>{entry.name}</h3>
        {shown && date ? (
          <time className="entry-card-date" dateTime={date}>
            {shown}
          </time>
        ) : null}
        <div className="entry-card-actions">{actions}</div>
        {notes}
      </div>
    </article>
  );
}
