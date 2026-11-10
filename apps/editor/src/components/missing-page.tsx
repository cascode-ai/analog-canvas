/**
 * What a link to nothing shows (#2159): a Gallery circuit that was
 * withdrawn or never existed, on a computer as on a phone, and a path no
 * page serves, which the Worker answers with 404 before this page loads.
 */
import "../styles/gallery-entry.css";
import "../styles/phone-circuit.css";

import { usePageTitle } from "../app/use-page-title";
import { GalleryChrome } from "./gallery-chrome";

type VisitStats = { pv: number; uv: number } | null | undefined;

function MissingPage({
  title,
  heading,
  note,
  testId,
  visitStats,
  editorLink = false,
}: {
  title: string;
  heading: string;
  note: string;
  testId: string;
  visitStats: VisitStats;
  /** Whether to offer the editor, whose tabs this window may hold. */
  editorLink?: boolean;
}) {
  usePageTitle(title);
  return (
    <div className="review-shell">
      <GalleryChrome subtitle={title} visitStats={visitStats} />
      <main className="phone-circuit missing-page" data-testid={testId}>
        <h1>{heading}</h1>
        <p className="phone-circuit-note">{note}</p>
        <div className="phone-circuit-actions">
          <a href="/">Back to the Gallery</a>
          {editorLink ? (
            <a href="/editor?resume=1" data-testid="missing-open-editor">
              Open the editor
            </a>
          ) : null}
        </div>
      </main>
    </div>
  );
}

/** `/g/<id>` for a circuit the Gallery does not hold. */
export function GalleryEntryMissing({
  visitStats,
}: {
  visitStats?: VisitStats;
}) {
  return (
    <MissingPage
      title="Not in the Gallery"
      heading="This circuit is not in the Gallery."
      note="It was withdrawn, or the link is wrong."
      testId="gallery-entry-missing"
      visitStats={visitStats}
      editorLink
    />
  );
}

/** A path no page serves. */
export function PageNotFound({ visitStats }: { visitStats?: VisitStats }) {
  return (
    <MissingPage
      title="Page not found"
      heading="There is no page here."
      note="Check the link, or start from the Gallery."
      testId="page-not-found"
      visitStats={visitStats}
    />
  );
}
