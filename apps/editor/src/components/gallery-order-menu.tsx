/**
 * The wall's order (#1615), left of the contributor count: random by
 * default, by time or part count in either direction, or most liked
 * first. A shuffled wall has a button left of it that shuffles again in
 * place, as choosing Random again does. On a narrow screen only the icons
 * show.
 */
import { useRef } from "react";

import { useDismissDetails } from "./dismiss-details";

import type { GalleryOrder } from "../gallery-order";

const LABELS: Record<GalleryOrder, string> = {
  random: "Random",
  newest: "Newest",
  oldest: "Oldest",
  parts: "Most parts",
  fewest: "Fewest parts",
  likes: "Most liked",
};

function OrderIcon({ order }: { order: GalleryOrder }) {
  const common = {
    viewBox: "0 0 16 16",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (order === "random")
    return (
      <svg {...common}>
        <path d="M2 4h2.5c2.5 0 4.5 8 7 8H14M12 10l2 2-2 2" />
        <path d="M2 12h2.5c1 0 1.8-1.2 2.5-2.7M9 6.7C9.7 5.2 10.5 4 11.5 4H14M12 2l2 2-2 2" />
      </svg>
    );
  if (order === "likes")
    return (
      <svg {...common}>
        <path d="M5 2.5v11M2.5 11 5 13.5 7.5 11" />
        <path d="M11 13s-3.5-2.2-3.5-4.6c0-1 .8-1.9 1.8-1.9.7 0 1.3.4 1.7 1 .4-.6 1-1 1.7-1 1 0 1.8.9 1.8 1.9 0 2.4-3.5 4.6-3.5 4.6Z" />
      </svg>
    );
  const down = order === "newest" || order === "parts";
  return (
    <svg {...common}>
      {down ? (
        <path d="M5 2.5v11M2.5 11 5 13.5 7.5 11" />
      ) : (
        <path d="M5 13.5v-11M2.5 5 5 2.5 7.5 5" />
      )}
      <path d="M9.5 4h4M9.5 8h3M9.5 12h2" />
    </svg>
  );
}

export function GalleryOrderMenu({
  order,
  onChoose,
}: {
  order: GalleryOrder;
  onChoose: (order: GalleryOrder) => void;
}) {
  const rootRef = useRef<HTMLDetailsElement | null>(null);
  useDismissDetails(rootRef);
  const choose = (next: GalleryOrder) => {
    rootRef.current?.removeAttribute("open");
    onChoose(next);
  };
  const item = (value: GalleryOrder, text: string) => (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={order === value}
      data-testid={`gallery-order-${value}`}
      onClick={() => choose(value)}
    >
      <OrderIcon order={value} />
      {text}
    </button>
  );
  return (
    <>
      {order === "random" ? (
        <button
          type="button"
          className="gallery-reshuffle"
          data-testid="gallery-reshuffle"
          aria-label="Shuffle again"
          title="Shuffle again"
          onClick={() => choose("random")}
        >
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3" />
          </svg>
        </button>
      ) : null}
      <details
        ref={rootRef}
        className="gallery-order-menu"
        data-testid="gallery-order-menu"
      >
        <summary
          className="gallery-order-button"
          data-testid="gallery-order-button"
          aria-label={`Order: ${LABELS[order]}`}
          title={`Order: ${LABELS[order]}`}
        >
          <OrderIcon order={order} />
          <span className="gallery-order-label">{LABELS[order]}</span>
        </summary>
        <div className="gallery-order-popover" role="menu">
          {item("random", "Random")}
          <span className="gallery-order-group">Time</span>
          {item("newest", "Newest first")}
          {item("oldest", "Oldest first")}
          <span className="gallery-order-group">Parts</span>
          {item("parts", "Most first")}
          {item("fewest", "Fewest first")}
          <span className="gallery-order-group">Likes</span>
          {item("likes", "Most first")}
        </div>
      </details>
    </>
  );
}
