/**
 * The wall's order (#1615), left of the contributor count: random by
 * default, or by time or part count in either direction. Choosing Random
 * again reshuffles. On a narrow screen only the icon shows.
 */
import { useRef } from "react";

import type { GalleryOrder } from "../gallery-order";

const LABELS: Record<GalleryOrder, string> = {
  random: "Random",
  newest: "Newest",
  oldest: "Oldest",
  parts: "Most parts",
  fewest: "Fewest parts",
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
        {item("random", order === "random" ? "Shuffle again" : "Random")}
        <span className="gallery-order-group">Time</span>
        {item("newest", "Newest first")}
        {item("oldest", "Oldest first")}
        <span className="gallery-order-group">Parts</span>
        {item("parts", "Most first")}
        {item("fewest", "Fewest first")}
      </div>
    </details>
  );
}
