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
