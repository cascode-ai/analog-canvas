import { AccountMenu } from "./account";
import { BugReportLink } from "./bug-report-link";
import { SITE_REPOSITORY_URL } from "./site-resource-links";

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
          className="app-repository-link"
          data-testid="gallery-repository-link"
          href={SITE_REPOSITORY_URL}
          target="_blank"
          rel="noreferrer"
          aria-label="GitHub repository"
          title="GitHub repository"
        >
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              fill="currentColor"
              d="M12 2a10 10 0 0 0-3.16 19.49c.5.09.68-.22.68-.48v-1.87c-2.78.6-3.37-1.18-3.37-1.18-.45-1.16-1.11-1.47-1.11-1.47-.91-.62.07-.61.07-.61 1 .07 1.53 1.03 1.53 1.03.9 1.53 2.35 1.09 2.92.83.09-.65.35-1.09.64-1.34-2.22-.25-4.55-1.11-4.55-4.94 0-1.09.39-1.98 1.03-2.68-.1-.25-.45-1.27.1-2.64 0 0 .84-.27 2.75 1.02A9.6 9.6 0 0 1 12 6.82a9.6 9.6 0 0 1 2.5.34c1.91-1.29 2.75-1.02 2.75-1.02.55 1.37.2 2.39.1 2.64.64.7 1.03 1.59 1.03 2.68 0 3.84-2.34 4.68-4.56 4.93.36.31.68.92.68 1.85v2.77c0 .27.18.58.69.48A10 10 0 0 0 12 2Z"
            />
          </svg>
        </a>
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
