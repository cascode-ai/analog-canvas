import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import type { SharedComponent } from "./component-library-contract";

const capabilityLabel = (entry: ComponentLibrarySummary) =>
  entry.capability === "symbol-only"
    ? "Symbol only"
    : entry.capability === "needs-repair"
      ? "Needs repair"
      : "With circuit";

/**
 * A row is too small to read a 20-pin symbol, so Details stands the record's
 * large preview beside the panel with what only the full record holds. It
 * closes on Escape, a press elsewhere or a scroll of the list it came from.
 */
export function ComponentDetailsCard({
  summary,
  row,
  artwork,
  entry,
  onClose,
  authorImplied = false,
}: {
  summary: ComponentLibrarySummary;
  row: HTMLElement;
  /** The record's artwork, reporting geometry far from its declared box. */
  artwork(
    entry: ComponentLibrarySummary,
    onPreviewWarning: (warning: string | null) => void,
  ): ReactNode;
  /** The full record; absent for one that needs repair. */
  entry?: SharedComponent | undefined;
  onClose(): void;
  /** Every record in the list is this author's, as on the desktop. */
  authorImplied?: boolean;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const [warning, setWarning] = useState<string | null>(null);
  useLayoutEffect(() => {
    const node = card.current!;
    const place = () => {
      const box = row.getBoundingClientRect();
      const panel = row.closest(".shapes-panel")?.getBoundingClientRect();
      const own = node.getBoundingClientRect();
      // Measured boxes include page zoom; the card's own offsets do not.
      const scale = node.offsetWidth ? own.width / node.offsetWidth : 1;
      setPosition({
        left:
          Math.min(
            (panel?.right ?? box.right) + 8,
            window.innerWidth - own.width - 8,
          ) / scale,
        top:
          Math.max(8, Math.min(box.top, window.innerHeight - own.height - 8)) /
          scale,
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(node);
    return () => resize.disconnect();
  }, [row]);
  useEffect(() => {
    const outside = (event: Event) =>
      !card.current?.contains(event.target as Node);
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const scroll = (event: Event) => {
      if (outside(event)) onClose();
    };
    const pointer = (event: PointerEvent) => {
      if (outside(event)) onClose();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, [onClose]);
  const pins = entry
    ? (entry.circuit?.externalDefinition.terminals ??
      entry.definition.symbol.pins)
    : null;
  return createPortal(
    <div
      ref={card}
      className="component-details-card"
      role="group"
      aria-label={`${summary.name} details`}
      style={position}
    >
      {artwork(summary, setWarning)}
      {warning ? <p role="status">{warning}</p> : null}
      <strong>{summary.name}</strong>
      <p>
        {authorImplied ? "" : `${summary.author.trim() || "Unknown author"} · `}
        {`${capabilityLabel(summary)} · ${summary.pinCount} pins · ${summary.parameterCount} parameters · Revision ${summary.revision}`}
      </p>
      {summary.capability === "symbol-only" ? (
        <p>No circuit model yet: add one before exporting a netlist.</p>
      ) : null}
      {summary.capability === "needs-repair" && summary.diagnostic ? (
        <p>{summary.diagnostic}</p>
      ) : null}
      {pins?.length ? <p>{pins.map((pin) => pin.name).join(" · ")}</p> : null}
      {entry ? (
        <details>
          <summary>Definition</summary>
          <pre>
            {JSON.stringify(
              {
                definition: entry.definition,
                ...(entry.circuit ? { circuit: entry.circuit } : {}),
              },
              null,
              2,
            )}
          </pre>
        </details>
      ) : null}
    </div>,
    document.body,
  );
}
