/**
 * Review sits between the Gallery's two walls: Community gallery, Review,
 * My shelf. Its pages keep that row with Review chosen, and switch between
 * reviewing (the default) and the read-only statistics of the comparisons.
 */
export function GalleryReviewTabs() {
  const tabs = [
    ["/", "Community gallery", false],
    ["/review", "Review", true],
    ["/?view=shelf", "My shelf", false],
  ] as const;
  return (
    <div className="gallery-view-tabs">
      <div
        className="gallery-view-tablist"
        role="tablist"
        aria-label="Circuits"
      >
        {tabs.map(([href, label, selected]) => (
          <a
            key={href}
            role="tab"
            className="gallery-view-tab"
            href={href}
            aria-selected={selected}
          >
            {label}
          </a>
        ))}
      </div>
    </div>
  );
}

/** Review (Pass or flag, the default) or Statistics (look only). */
export function ReviewModeSwitch({
  mode,
  scope,
}: {
  mode: "review" | "statistics";
  scope: string | null;
}) {
  const dataset = scope && scope !== "community" ? scope : null;
  return (
    <nav className="review-mode-switch" aria-label="Mode">
      <a
        href={`/review${dataset ? `?scope=${dataset}` : ""}`}
        aria-current={mode === "review" ? "page" : undefined}
        data-testid="review-mode-review"
      >
        Review
      </a>
      <a
        href={`/datasets${dataset ? `?source=${dataset}` : ""}`}
        aria-current={mode === "statistics" ? "page" : undefined}
        data-testid="review-mode-statistics"
      >
        Statistics
      </a>
    </nav>
  );
}
