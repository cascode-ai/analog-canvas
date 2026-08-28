import { AccountMenu } from "./account";
import { BugReportLink } from "./bug-report-link";

/**
 * The one gallery site header, shared by the feed and every gallery
 * subpage (/mine) in all their states, so no page ever renders
 * as a bare paragraph without navigation. Markup mirrors the feed's
 * original header exactly (test ids included).
 */
export function GalleryChrome({
  subtitle,
  visitStats,
}: {
  subtitle: string;
  visitStats?: { pv: number; uv: number } | null | undefined;
}) {
  return (
    <header className="gallery-chrome">
      <div className="app-brand">
        <a
          className="gallery-home-link"
          href="/editor"
          aria-label="Open the editor"
          title="Open the editor"
          data-testid="gallery-editor-link"
        >
          <span className="app-brand-mark" aria-hidden="true" />
          <h1>Analog Canvas</h1>
        </a>
        <div className="app-brand-copy">
          <p>{subtitle}</p>
        </div>
      </div>
      <div className="gallery-credit-group">
        <div className="tokenzhang-credit">
          <span className="tokenzhang-credit-kicker">Presented by</span>
          <a
            className="tokenzhang-link"
            href="https://tokenzhang.com"
            target="_blank"
            rel="noreferrer"
            aria-label="TokenZhang"
            title="TokenZhang"
          >
            <img
              className="tokenzhang-link-icon"
              src="/tokenzhang-favicon.png"
              alt=""
              width={16}
              height={16}
            />
            <span className="tokenzhang-link-label">TokenZhang</span>
          </a>
        </div>
        {visitStats ? (
          <a
            className="analytics-link gallery-analytics-link"
            href="/analytics"
            data-testid="gallery-analytics"
            title="Open visitor analytics"
          >
            {visitStats.uv.toLocaleString()} visitors ·{" "}
            {visitStats.pv.toLocaleString()} views
          </a>
        ) : null}
      </div>
      <nav className="gallery-actions">
        <AccountMenu />
        <BugReportLink testId="gallery-report-bug" surface={subtitle} />
        <a
          className="gallery-open-editor"
          href="/editor?new=1"
          data-testid="gallery-new-circuit"
        >
          New Circuit
        </a>
      </nav>
    </header>
  );
}
