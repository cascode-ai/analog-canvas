export type ToolIconName =
  | "insert"
  | "library"
  | "examples"
  | "wire"
  | "text"
  | "arrow"
  | "line"
  | "rectangle"
  | "style"
  | "rotate"
  | "mirror-horizontal"
  | "mirror-vertical"
  | "lock"
  | "zoom-in"
  | "zoom-out"
  | "fit"
  | "grid"
  | "inspect"
  | "undo"
  | "redo"
  | "delete";

export function ToolIcon({ name }: { name: ToolIconName }) {
  const common = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.7,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };

  return (
    <svg className="tool-icon" viewBox="0 0 20 20" aria-hidden="true">
      {name === "insert" ? (
        <>
          <rect x="4" y="4" width="12" height="12" rx="1.5" {...common} />
          <path d="M10 7v6M7 10h6" {...common} />
        </>
      ) : null}
      {name === "library" ? (
        <>
          {/* 2x2 tile grid = one clear library / catalog mark */}
          <rect x="3" y="3.5" width="6" height="6" rx="1" {...common} />
          <rect x="11" y="3.5" width="6" height="6" rx="1" {...common} />
          <rect x="3" y="10.5" width="6" height="6" rx="1" {...common} />
          <rect x="11" y="10.5" width="6" height="6" rx="1" {...common} />
        </>
      ) : null}
      {name === "examples" ? (
        <>
          <rect x="3" y="4" width="10" height="11" rx="1" {...common} />
          <path d="M6 7h4M6 10h4M6 13h3" {...common} />
          <rect x="8" y="6" width="9" height="10" rx="1" {...common} />
        </>
      ) : null}
      {name === "wire" ? (
        <>
          <path d="M3 5h6v10h8" {...common} />
          <circle cx="3" cy="5" r="1.5" {...common} />
          <circle cx="17" cy="15" r="1.5" {...common} />
        </>
      ) : null}
      {name === "text" ? (
        <path d="M4 5V3h12v2M10 3v14M7 17h6" {...common} />
      ) : null}
      {name === "arrow" ? (
        <>
          <path d="M3 15L16 4" {...common} />
          <path d="M10 4h6v6" {...common} />
        </>
      ) : null}
      {name === "line" ? <path d="M3 15L17 5" {...common} /> : null}
      {name === "rectangle" ? (
        <rect x="3" y="5" width="14" height="10" rx="1" {...common} />
      ) : null}
      {name === "style" ? (
        <>
          {/* Two labelled sliders: presentation settings, not a drawing tool. */}
          <path d="M3 7h14M3 13h14" {...common} />
          <circle cx="7.5" cy="7" r="2" fill="currentColor" />
          <circle cx="12.5" cy="13" r="2" fill="currentColor" />
        </>
      ) : null}
      {name === "rotate" ? (
        <>
          <path d="M15.5 7A6 6 0 1 0 16 12" {...common} />
          <path d="M12.5 3.5H16v3.5" {...common} />
        </>
      ) : null}
      {name === "mirror-horizontal" ? (
        <>
          <path d="M10 3v14" strokeDasharray="1.6 2" {...common} />
          <path d="M3.5 6.5L8 4.5v11l-4.5-2z" {...common} />
          <path d="M16.5 6.5L12 4.5v11l4.5-2z" {...common} />
        </>
      ) : null}
      {name === "mirror-vertical" ? (
        <>
          <path d="M3 10h14" strokeDasharray="1.6 2" {...common} />
          <path d="M6.5 3.5L4.5 8h11l-2-4.5z" {...common} />
          <path d="M6.5 16.5L4.5 12h11l-2 4.5z" {...common} />
        </>
      ) : null}
      {name === "lock" ? (
        <>
          <rect x="4.5" y="8.5" width="11" height="8" rx="1.5" {...common} />
          <path d="M7 8.5V6a3 3 0 0 1 6 0v2.5" {...common} />
        </>
      ) : null}
      {name === "zoom-in" || name === "zoom-out" ? (
        <>
          <circle cx="8.5" cy="8.5" r="5" {...common} />
          <path d="M12.5 12.5L17 17M6 8.5h5" {...common} />
          {name === "zoom-in" ? <path d="M8.5 6v5" {...common} /> : null}
        </>
      ) : null}
      {name === "fit" ? (
        <>
          <path d="M7 3H3v4M13 3h4v4M17 13v4h-4M7 17H3v-4" {...common} />
          <rect x="6" y="6" width="8" height="8" {...common} />
        </>
      ) : null}
      {name === "grid" ? (
        <>
          {/* 3x3 dot field = background-dots toggle; the 0.9-radius dots
              collapsed to ~1.4px at the 16px icon and read as noise, so the
              dots are calibrated to r=1.4 (~2.2px, still clearly spaced). */}
          <circle cx="5" cy="5" r="1.4" fill="currentColor" />
          <circle cx="10" cy="5" r="1.4" fill="currentColor" />
          <circle cx="15" cy="5" r="1.4" fill="currentColor" />
          <circle cx="5" cy="10" r="1.4" fill="currentColor" />
          <circle cx="10" cy="10" r="1.4" fill="currentColor" />
          <circle cx="15" cy="10" r="1.4" fill="currentColor" />
          <circle cx="5" cy="15" r="1.4" fill="currentColor" />
          <circle cx="10" cy="15" r="1.4" fill="currentColor" />
          <circle cx="15" cy="15" r="1.4" fill="currentColor" />
        </>
      ) : null}
      {name === "inspect" ? (
        <>
          <path d="M4 3h12v14H4z" {...common} />
          <path d="M7 7h6M7 10h6M7 13h4" {...common} />
        </>
      ) : null}
      {name === "undo" ? (
        <>
          <path d="M4 9h8a4 4 0 1 1 0 8H8" {...common} />
          <path d="M7 5L3 9l4 4" {...common} />
        </>
      ) : null}
      {name === "redo" ? (
        <>
          <path d="M16 9H8a4 4 0 1 0 0 8h4" {...common} />
          <path d="M13 5l4 4-4 4" {...common} />
        </>
      ) : null}
      {name === "delete" ? (
        <>
          <path d="M4 6h12M8 6V4h4v2M7 6l.6 10h4.8L13 6" {...common} />
        </>
      ) : null}
    </svg>
  );
}
