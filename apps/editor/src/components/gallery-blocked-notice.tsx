import { SITE_USAGE_CONTACT } from "../usage-policy-note";
import "./gallery-blocked-notice.css";

/**
 * What an account blocked from the Gallery sees in place of the wall
 * (docs/specs/community-gallery.md#crawlers-ai-and-floods): why, how to
 * report a mistake, and what still works. Never how the check works.
 */
export function GalleryBlockedNotice({
  compact = false,
}: {
  compact?: boolean;
}) {
  return (
    <section
      className={`gallery-blocked-notice${compact ? " is-compact" : ""}`}
      role="alert"
      data-testid="gallery-blocked"
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path
          d="M12 3 2 20h20L12 3Z"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        <path
          d="M12 10v4.5"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="12" cy="17.25" r="1.25" fill="currentColor" />
      </svg>
      <div>
        <h2>This account can’t open the Gallery right now</h2>
        <p>
          It read Gallery circuits the way a program collecting them in bulk
          does, so its Gallery access is paused.
        </p>
        <p>
          This check is still being tested. If it caught you by mistake, reply
          to the email we sent you or write to{" "}
          <a href={`mailto:${SITE_USAGE_CONTACT}`}>{SITE_USAGE_CONTACT}</a>, and
          we’ll restore your access after checking. Sorry for the trouble.
        </p>
        <p>Your Cloud Projects and the editor work as usual.</p>
      </div>
    </section>
  );
}
