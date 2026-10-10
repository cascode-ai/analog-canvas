/**
 * AnalogArena's mark, two crossed swords, drawn as AnalogArena's own header
 * draws it. The headers' icon rule fills an svg, so the strokes sit in a group
 * that turns the fill off.
 */
export function CrossedSwordsIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M13.5 2.5 5.5 10.5M4 9l3 3M5.5 10.5l-2 2" />
        <path d="M2.5 2.5l8 8M12 9l-3 3M10.5 10.5l2 2" />
        <circle cx="2.7" cy="13.3" r=".7" />
        <circle cx="13.3" cy="13.3" r=".7" />
      </g>
    </svg>
  );
}
