/** One upright sword, tip up, centred on the origin of a 24-unit box. */
function Sword() {
  return (
    <g stroke="#1f2328" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M0-13 2.3-10.2V3H-2.3V-10.2Z" fill="#eef2f7" />
      <path d="M0-10V1.6" strokeWidth=".8" strokeLinecap="round" opacity=".3" />
      <rect x="-5" y="2.9" width="10" height="2.8" rx="1.4" fill="#f4b400" />
      <rect x="-1.45" y="5.6" width="2.9" height="4.4" rx=".9" fill="#9a5b2d" />
      <circle cx="0" cy="11.5" r="1.9" fill="#f4b400" />
    </g>
  );
}

/**
 * Chip Arena's mark, two chubby crossed swords in their own colours, as Chip
 * Arena's header draws them. Each part names its fill, so the headers' icon
 * rule, which fills an svg with the text colour, leaves them as they are.
 */
export function CrossedSwordsIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g transform="translate(12 12.4) scale(.84)">
        <g transform="rotate(-45)">
          <Sword />
        </g>
        <g transform="rotate(45)">
          <Sword />
        </g>
      </g>
    </svg>
  );
}
