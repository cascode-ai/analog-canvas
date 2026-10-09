/**
 * The wall's size: the count panel with its contributor leaderboard, and how
 * far a search has read through the wall.
 */
import { useRef, useState } from "react";

import { galleryCountLabel, type GalleryAuthorOption } from "../gallery-client";
import {
  CONTRIBUTOR_ORDER_KEY,
  orderContributors,
  type ContributorOrder,
} from "../gallery-contributor-order";

/**
 * One search string against one circuit. The query arrives normalized
 * (trimmed, lowercased); fields answer case-insensitively. A tag counts as
 * content, so a query matching a tag matches the circuits that carry it.
 */
/**
 * The wall's size, said only when the server has said it: a pre-totals API
 * or a still-loading feed renders nothing rather than a guess. "Filtered"
 * names the server-side narrowing; "match" belongs to the text query, whose
 * clause counts VISIBLE tiles (true at every instant by construction) and
 * says "so far" until the feed is exhausted.
 */
function contributionLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "circuit" : "circuits"}`;
}

function GalleryContributorRow({
  option,
  rank,
  partial,
  onSelectAuthor,
}: {
  option: GalleryAuthorOption;
  rank: number;
  partial: boolean;
  onSelectAuthor: (option: GalleryAuthorOption) => void;
}) {
  return (
    <li
      className="gallery-contributor-row"
      data-testid={`gallery-contributor-row-${rank}`}
    >
      <span className="gallery-contributor-rank">{rank}</span>
      <button
        type="button"
        className="gallery-contributor-author"
        data-testid={`gallery-contributor-author-${rank}`}
        aria-label={`View ${option.author}'s gallery`}
        onClick={() => onSelectAuthor(option)}
      >
        {option.author}
      </button>
      <span className="gallery-contributor-count">
        {contributionLabel(option.count)}
        {partial ? " so far" : ""}
      </span>
    </li>
  );
}

/**
 * A search reads the wall page by page in this browser; this says how far it
 * has read, so a short list is never mistaken for the answer.
 */
export function GallerySearchProgress({
  checked,
  total,
  matches,
  settled,
}: {
  checked: number;
  total: number | null;
  matches: number;
  settled: boolean;
}) {
  const of = total ?? checked;
  const found = `${matches.toLocaleString()} ${matches === 1 ? "match" : "matches"}`;
  return (
    <div
      className="gallery-search-progress"
      role="status"
      data-testid="gallery-search-progress"
      data-settled={settled}
    >
      <span>
        {settled
          ? `Searched all ${of.toLocaleString()} circuits · ${found}`
          : `Searching… ${checked.toLocaleString()} / ${of.toLocaleString()} circuits checked · ${found} so far`}
      </span>
      {settled ? null : (
        <progress value={checked} max={Math.max(of, checked, 1)} />
      )}
    </div>
  );
}

export function GalleryCountPanel({
  total,
  filtered = false,
  searched = false,
  search = null,
  authors = [],
  partial = false,
  author = null,
  onSelectAuthor = () => undefined,
  onShowAllAuthors = () => undefined,
}: {
  total: number | null;
  filtered?: boolean;
  searched?: boolean;
  search?: { visible: number; settled: boolean } | null;
  authors?: GalleryAuthorOption[];
  partial?: boolean;
  /** The byline the wall is narrowed to, if any. */
  author?: string | null;
  onSelectAuthor?: (option: GalleryAuthorOption) => void;
  onShowAllAuthors?: () => void;
}) {
  const label = galleryCountLabel(total, { filtered, search, searched });
  const rootRef = useRef<HTMLDetailsElement | null>(null);
  // By circuits or by name (#1502), remembered in this browser.
  const [order, setOrder] = useState<ContributorOrder>(() => {
    try {
      return localStorage.getItem(CONTRIBUTOR_ORDER_KEY) === "name"
        ? "name"
        : "count";
    } catch {
      return "count";
    }
  });
  const chooseOrder = (next: ContributorOrder) => {
    setOrder(next);
    try {
      localStorage.setItem(CONTRIBUTOR_ORDER_KEY, next);
    } catch {
      // The list still sorts; only the memory of it is lost.
    }
  };
  if (label === null) return null;
  return (
    <details
      ref={rootRef}
      className="gallery-contributor-menu"
      data-testid="gallery-contributor-menu"
    >
      <summary
        className="gallery-count-panel"
        data-testid="gallery-count-panel"
        aria-label={`${label}. Show contributor leaderboard`}
      >
        <span className="gallery-count-label">{label}</span>
      </summary>
      <div
        className="gallery-contributor-popover"
        data-testid="gallery-contributor-popover"
      >
        <div className="gallery-contributor-heading">
          <strong>Contributors</strong>
          <span>
            {authors.length.toLocaleString()}{" "}
            {authors.length === 1 ? "author" : "authors"}
            {partial ? " so far" : ""}
          </span>
        </div>
        <div
          className="gallery-contributor-order"
          role="group"
          aria-label="Sort contributors"
        >
          {(
            [
              ["count", "Circuits"],
              ["name", "A to Z"],
            ] as const
          ).map(([value, text]) => (
            <button
              key={value}
              type="button"
              data-testid={`gallery-contributor-order-${value}`}
              aria-pressed={order === value}
              onClick={() => chooseOrder(value)}
            >
              {text}
            </button>
          ))}
        </div>
        {author ? (
          // Narrowed to one byline, the board lists only that author; the
          // way back to everyone sits where readers look for the others.
          <div className="gallery-contributor-status">
            <p>Circuits by {author}</p>
            <button
              type="button"
              data-testid="gallery-contributor-all"
              onClick={() => {
                rootRef.current?.removeAttribute("open");
                onShowAllAuthors();
              }}
            >
              All authors
            </button>
          </div>
        ) : null}
        {authors.length === 0 ? (
          <p className="gallery-contributor-status">
            {partial
              ? "No matching contributors in circuits loaded so far."
              : "No contributors match the current filters."}
          </p>
        ) : (
          <ol className="gallery-contributor-list">
            {orderContributors(authors, order).map((option, index) => (
              <GalleryContributorRow
                key={`${option.ownerUserId ?? "legacy"}:${option.author}`}
                option={option}
                rank={index + 1}
                partial={partial}
                onSelectAuthor={(option) => {
                  rootRef.current?.removeAttribute("open");
                  onSelectAuthor(option);
                }}
              />
            ))}
          </ol>
        )}
      </div>
    </details>
  );
}
