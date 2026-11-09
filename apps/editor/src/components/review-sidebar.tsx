import { useState } from "react";

import { COMPARISON_SOURCES } from "../gallery-sources";
import { MINE_FILTERS, type MineFilter } from "../review-queue";
import { SidebarFoldButton } from "./gallery-tag-sidebar";

const num = (value: number) => value.toLocaleString("en-US");
/** Authors the list shows before "+ N more". */
const FOLDED_AUTHORS = 12;

/**
 * The left column, in the Gallery sidebar's own markup and look: a search
 * over names, authors and ids (a pasted link opens its drawing), then where
 * the drawings come from (Random mixes them all; Random again shuffles
 * anew), only those with a reference figure, the reader's own drawings by
 * what others' reviews of them say or whether they lack a figure (#2129),
 * and one author's. Each row counts what it would show. It folds to a strip
 * as that one does.
 */
export function ScopeSidebar({
  scope,
  choose,
  counts,
  referencesOnly,
  references,
  onReferencesOnly,
  search,
  onSearch,
  onSearchEnter,
  authors,
  author,
  onAuthor,
  mine,
  mineCounts,
  onMine,
  collapsed,
  onToggle,
}: {
  scope: string;
  choose: (scope: string) => void;
  counts: Record<string, number>;
  referencesOnly: boolean;
  references: number | null;
  onReferencesOnly: () => void;
  search: string;
  onSearch: (text: string) => void;
  /** Enter in the search: a link or id opens its drawing wherever it is. */
  onSearchEnter: (text: string) => void;
  authors: readonly { author: string; count: number }[];
  author: string | null;
  onAuthor: (author: string | null) => void;
  mine: MineFilter | null;
  /** Each row's count; null when the list holds none of the reader's own. */
  mineCounts: Record<MineFilter, number> | null;
  onMine: (filter: MineFilter | null) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const [allAuthors, setAllAuthors] = useState(false);
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
  // The chosen author stays listed when the folded list would hide them.
  const shownAuthors = allAuthors
    ? authors
    : authors.filter(
        (each, at) => at < FOLDED_AUTHORS || each.author === author,
      );
  return (
    <div className="gallery-sidebar-slot">
      <div className="gallery-sidebar-search review-sidebar-top">
        <label className="gallery-search-field review-search">
          <svg
            className="gallery-search-icon"
            viewBox="0 0 16 16"
            aria-hidden="true"
          >
            <circle
              cx="6.75"
              cy="6.75"
              r="4.75"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.6"
            />
            <path
              d="m10.3 10.3 3.7 3.7"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
          <input
            className="gallery-search-input"
            autoComplete="off"
            type="search"
            value={search}
            placeholder="Search name, author, id or link"
            aria-label="Search the drawings to review"
            title="Filters as you type; Enter on a link or id opens that drawing"
            data-testid="review-search"
            onChange={(event) => onSearch(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                onSearchEnter(event.currentTarget.value);
              } else if (event.key === "Escape" && search) {
                event.preventDefault();
                onSearch("");
              }
            }}
          />
        </label>
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
        {mineCounts ? (
          <>
            <div className="gallery-sidebar-heading">
              <h2>My drawings</h2>
              {mine ? (
                <button
                  type="button"
                  className="gallery-sidebar-clear"
                  data-testid="review-mine-clear"
                  onClick={() => onMine(null)}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="review-sidebar-list" data-testid="review-mine">
              {MINE_FILTERS.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  className="gallery-sidebar-option"
                  aria-pressed={mine === key}
                  data-testid={`review-mine-${key}`}
                  onClick={() => onMine(mine === key ? null : key)}
                >
                  <span>{label}</span>
                  <span className="gallery-sidebar-count">
                    {num(mineCounts[key])}
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : null}
        {authors.length ? (
          <>
            <div className="gallery-sidebar-heading">
              <h2>Authors</h2>
              {author ? (
                <button
                  type="button"
                  className="gallery-sidebar-clear"
                  data-testid="review-author-clear"
                  onClick={() => onAuthor(null)}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="review-sidebar-list" data-testid="review-authors">
              {shownAuthors.map(({ author: name, count }) => (
                <button
                  key={name}
                  type="button"
                  className="gallery-sidebar-option"
                  aria-pressed={author === name}
                  title={name}
                  onClick={() => onAuthor(author === name ? null : name)}
                >
                  <span>{name}</span>
                  <span className="gallery-sidebar-count">{num(count)}</span>
                </button>
              ))}
              {authors.length > FOLDED_AUTHORS ? (
                <button
                  type="button"
                  className="gallery-sidebar-option review-authors-more"
                  data-testid="review-authors-more"
                  onClick={() => setAllAuthors((open) => !open)}
                >
                  <span>
                    {allAuthors
                      ? "Fewer"
                      : `+ ${num(authors.length - FOLDED_AUTHORS)} more`}
                  </span>
                </button>
              ) : null}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );
}
