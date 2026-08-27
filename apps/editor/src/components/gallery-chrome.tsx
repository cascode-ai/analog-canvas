import { AccountMenu } from "./account";

/**
 * The one gallery site header, shared by the feed and every gallery
 * subpage (/mine) in all their states, so no page ever renders
 * as a bare paragraph without navigation. Markup mirrors the feed's
 * original header exactly (test ids included).
 */
export function GalleryChrome({ subtitle }: { subtitle: string }) {
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
      <div className="tokenzhang-credit">
        <span className="tokenzhang-credit-kicker">Provided by</span>
        <a
          className="tokenzhang-link"
          href="https://tokenzhang.com"
          target="_blank"
          rel="noreferrer"
          aria-label="tokenzhang.com"
          title="tokenzhang.com"
        >
          <img
            className="tokenzhang-link-icon"
            src="/tokenzhang-favicon.png"
            alt=""
            width={16}
            height={16}
          />
          <span className="tokenzhang-link-label">tokenzhang.com</span>
        </a>
      </div>
      <nav className="gallery-actions">
        <AccountMenu />
        <a
          className="gallery-open-editor"
          href="/editor"
          data-testid="gallery-new-circuit"
        >
          New Circuit
        </a>
      </nav>
    </header>
  );
}
