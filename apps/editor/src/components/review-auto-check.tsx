import { useEffect, useState } from "react";

import type { LayoutCheckKind, LayoutFinding } from "../layout-check";

/** Each layout check's name for one finding and for several. */
const AUTO_LABELS: Record<LayoutCheckKind, [string, string]> = {
  jog: ["step in a wire", "steps in wires"],
  "near-row": ["pair off one row", "pairs off one row"],
  "near-column": ["pair off one column", "pairs off one column"],
  "dots-misaligned": ["node pair out of line", "node pairs out of line"],
  "asymmetric-pair": ["twin pair not mirrored", "twin pairs not mirrored"],
  "close-dots": ["doubled node", "doubled nodes"],
  "wire-loop": ["wire drawn twice", "wires drawn twice"],
  "overlapping-wires": ["overlapping wire", "overlapping wires"],
};

/**
 * Under the pictures, what the layout checks found in our drawing, by kind.
 * Pointing at a kind boxes its findings on our picture; a click keeps them.
 */
export function AutoCheck({
  findings,
  onShow,
}: {
  findings: readonly LayoutFinding[] | null;
  onShow: (kind: LayoutCheckKind | null) => void;
}) {
  const [pinned, setPinned] = useState<LayoutCheckKind | null>(null);
  const [hovered, setHovered] = useState<LayoutCheckKind | null>(null);
  useEffect(() => onShow(hovered ?? pinned), [hovered, pinned, onShow]);
  if (!findings) return null;
  const counts = new Map<LayoutCheckKind, LayoutFinding[]>();
  for (const finding of findings)
    counts.set(finding.kind, [...(counts.get(finding.kind) ?? []), finding]);
  return (
    <div className="review-auto" data-testid="review-auto-check">
      <span className="label">Auto check</span>
      {counts.size === 0 ? (
        <span className="clean">✓ nothing found</span>
      ) : (
        [...counts].map(([kind, list]) => (
          <button
            key={kind}
            type="button"
            className={`review-auto-chip${pinned === kind ? " on" : ""}`}
            aria-pressed={pinned === kind}
            title={list.map((finding) => finding.message).join("\n")}
            onMouseEnter={() => setHovered(kind)}
            onMouseLeave={() => setHovered(null)}
            onClick={() =>
              setPinned((current) => (current === kind ? null : kind))
            }
          >
            {list.length} {AUTO_LABELS[kind][list.length === 1 ? 0 : 1]}
          </button>
        ))
      )}
    </div>
  );
}
