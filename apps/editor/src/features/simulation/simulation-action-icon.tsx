/** Small monochrome controls matching the source toolbar's file icons. */
export function SimulationActionIcon({
  kind,
}: {
  kind: "save" | "run" | "stop" | "saving" | "saved" | "failed";
}) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {kind === "save" ? (
        <>
          <path d="M4 3h10l3 3v11H3V3h1Z" />
          <path d="M6 3v5h7V3M6 17v-6h8v6" />
        </>
      ) : kind === "run" ? (
        <path d="m6 3 10 7-10 7V3Z" />
      ) : kind === "stop" ? (
        <rect x="5" y="5" width="10" height="10" rx="1" />
      ) : kind === "saved" ? (
        <path d="m4 10 4 4 8-8" />
      ) : kind === "saving" ? (
        <path d="M16 10a6 6 0 1 1-6-6" />
      ) : (
        <>
          <circle cx="10" cy="10" r="7" />
          <path d="M10 6v5m0 3h.01" />
        </>
      )}
    </svg>
  );
}
