// The hierarchy panel's line icons, on a 16-unit grid.

export type HierarchyIconName =
  "add" | "child" | "place" | "properties" | "collapse";

export function HierarchyIcon({ name }: { name: HierarchyIconName }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.5,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      {name === "child" ? (
        <>
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" {...stroke} />
          <path d="M8 5.5v5M5.5 8h5" {...stroke} />
        </>
      ) : null}
      {name === "place" ? (
        <path d="M8 2.5v7M5 6.5l3 3 3-3M3 10.5v3h10v-3" {...stroke} />
      ) : null}
      {name === "properties" ? (
        <>
          <path d="M2.5 5h11M2.5 11h11" {...stroke} />
          <circle cx="6" cy="5" r="1.7" {...stroke} fill="var(--icm-surface)" />
          <circle
            cx="10"
            cy="11"
            r="1.7"
            {...stroke}
            fill="var(--icm-surface)"
          />
        </>
      ) : null}
      {name === "add" ? <path d="M8 3v10M3 8h10" {...stroke} /> : null}
      {name === "collapse" ? (
        <>
          <rect x="5" y="5" width="8.5" height="8.5" rx="1.5" {...stroke} />
          <path
            d="M2.5 10.5V4a1.5 1.5 0 0 1 1.5-1.5h6.5M7.2 9.25h4"
            {...stroke}
          />
        </>
      ) : null}
    </svg>
  );
}
