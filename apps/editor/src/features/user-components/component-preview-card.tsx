import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import type { SharedComponent } from "./component-library-contract";
import { LibraryPreview } from "./library-preview";

const capabilityLabel = (entry: ComponentLibrarySummary) =>
  entry.capability === "symbol-only"
    ? "Symbol only"
    : entry.capability === "needs-repair"
      ? "Needs repair"
      : "With circuit";

/**
 * A row is too small to read a 20-pin symbol, so the record's large preview
 * stands beside the panel while the row is pointed at or focused. Details pins
 * the same card and adds what only the full record holds.
 */
export function ComponentPreviewCard({
  summary,
  row,
  entry,
  onHold,
  onRelease,
  onClose,
  onFilterAuthor,
}: {
  summary: ComponentLibrarySummary;
  row: HTMLElement;
  /** Present once pinned by Details. */
  entry?: SharedComponent | undefined;
  onHold(): void;
  onRelease(): void;
  onClose(): void;
  onFilterAuthor(): void;
}) {
  const card = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  useLayoutEffect(() => {
    const node = card.current!;
    const place = () => {
      const box = row.getBoundingClientRect();
      const panel = row.closest(".shapes-panel")?.getBoundingClientRect();
      const height = node.offsetHeight;
      const width = node.offsetWidth;
      setPosition({
        left: Math.min(
          (panel?.right ?? box.right) + 8,
          window.innerWidth - width - 8,
        ),
        top: Math.max(8, Math.min(box.top, window.innerHeight - height - 8)),
      });
    };
    place();
    const resize = new ResizeObserver(place);
    resize.observe(node);
    return () => resize.disconnect();
  }, [row]);
  const pinned = Boolean(entry);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    // The row moved out from under an unpinned card.
    const scroll = (event: Event) => {
      if (!pinned && !card.current?.contains(event.target as Node)) onClose();
    };
    const pointer = (event: PointerEvent) => {
      if (pinned && !card.current?.contains(event.target as Node)) onClose();
    };
    window.addEventListener("keydown", key);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("pointerdown", pointer, true);
    return () => {
      window.removeEventListener("keydown", key);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("pointerdown", pointer, true);
    };
  }, [pinned, onClose]);
  const pins = entry
    ? (entry.circuit?.externalDefinition.terminals ??
      entry.definition.symbol.pins)
    : null;
  return createPortal(
    <div
      ref={card}
      className="component-preview-card"
      role="group"
      aria-label={`${summary.name} preview`}
      style={position}
      onPointerEnter={onHold}
      onPointerLeave={onRelease}
    >
      <LibraryPreview entry={summary} />
      <strong>{summary.name}</strong>
      <p>
        <button type="button" onClick={onFilterAuthor}>
          {summary.author.trim() || "Unknown author"}
        </button>
        {` · ${capabilityLabel(summary)} · ${summary.pinCount} pins · ${summary.parameterCount} parameters`}
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
