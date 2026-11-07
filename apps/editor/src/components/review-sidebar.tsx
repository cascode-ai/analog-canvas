import { COMPARISON_SOURCES } from "../gallery-sources";
import { SidebarFoldButton } from "./gallery-tag-sidebar";

const num = (value: number) => value.toLocaleString("en-US");

/**
 * The left column, in the Gallery sidebar's own markup and look: one list
 * of filters. Where the drawings come from (Random mixes them all; Random
 * again shuffles anew), then only those with a reference figure; each row
 * counts what it would show. It folds to a strip as that one does.
 */
export function ScopeSidebar({
  scope,
  choose,
  counts,
  referencesOnly,
  references,
  onReferencesOnly,
  collapsed,
  onToggle,
}: {
  scope: string;
  choose: (scope: string) => void;
  counts: Record<string, number>;
  referencesOnly: boolean;
  references: number | null;
  onReferencesOnly: () => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (collapsed)
    return (
      <div className="gallery-sidebar-slot" data-collapsed="true">
        <SidebarFoldButton
          collapsed
          onToggle={onToggle}
          testId="review-sidebar-fold"
        />
      </div>
    );
  const item = (key: string, label: string) => (
    <button
      key={key}
      type="button"
      className="gallery-sidebar-option"
      aria-pressed={scope === key}
      data-testid={`review-scope-${key}`}
      title={
        key === "random" && scope === "random" ? "Shuffle again" : undefined
      }
      onClick={() => choose(key)}
    >
      <span>{label}</span>
      <span className="gallery-sidebar-count">
        {counts[key] === undefined ? "" : num(counts[key])}
      </span>
    </button>
  );
  return (
    <div className="gallery-sidebar-slot">
      <div className="gallery-sidebar-search review-sidebar-top">
        <h2>Filter</h2>
        <SidebarFoldButton
          collapsed={false}
          onToggle={onToggle}
          testId="review-sidebar-fold"
        />
      </div>
      <aside className="gallery-tag-sidebar" aria-label="Filter">
        <div className="review-sidebar-list">
          {item("random", "Random")}
          {item("community", "Community")}
          {COMPARISON_SOURCES.map((source) => item(source.key, source.name))}
        </div>
        <div className="review-sidebar-list">
          <button
            type="button"
            className="gallery-sidebar-option"
            aria-pressed={referencesOnly}
            data-testid="review-references-only"
            title="Only drawings with an original figure or a reference image"
            onClick={onReferencesOnly}
          >
            <span>With a reference figure</span>
            <span className="gallery-sidebar-count">
              {references === null ? "" : num(references)}
            </span>
          </button>
        </div>
      </aside>
    </div>
  );
}
