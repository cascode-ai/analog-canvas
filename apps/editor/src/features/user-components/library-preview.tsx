import { useEffect, useRef, useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import type { SymbolDefinition } from "@icm/symbols";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import { readSharedComponentPreview } from "./component-library-client";
import { LibraryCache } from "./library-cache";

const previews = new LibraryCache<SymbolDefinition>(100, 2 * 1024 * 1024);
const DWELL_MS = 120;

export function LibraryPreview({
  entry,
  onPreviewWarning,
}: {
  entry: ComponentLibrarySummary;
  onPreviewWarning?: ((warning: string | null) => void) | undefined;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const key = `${entry.id}:${entry.revision}`;
  const [symbol, setSymbol] = useState(() =>
    entry.status !== "deleted" ? previews.get(key) : undefined,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    if (symbol || entry.capability === "needs-repair") return;
    const controller = new AbortController();
    let dwell: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(
      (entries) => {
        clearTimeout(dwell);
        if (!entries.some((entry) => entry.isIntersecting)) return;
        // Only a row that stays in view is worth one request for each record.
        dwell = setTimeout(() => {
          observer.disconnect();
          void readSharedComponentPreview(entry, controller.signal)
            .then((next) => {
              if (controller.signal.aborted) return;
              if (entry.status !== "deleted") previews.set(key, next);
              setSymbol(next);
            })
            .catch(() => {
              if (!controller.signal.aborted) setError(true);
            });
        }, DWELL_MS);
      },
      { rootMargin: "100px" },
    );
    if (container.current) observer.observe(container.current);
    return () => {
      clearTimeout(dwell);
      observer.disconnect();
      controller.abort();
    };
  }, [entry, key, symbol]);
  return (
    <span ref={container} className="user-component-preview">
      {symbol ? (
        <SymbolArtwork
          symbol={symbol}
          fitContent
          className="user-component-art"
          {...(onPreviewWarning ? { onPreviewWarning } : {})}
        />
      ) : (
        <small className="component-definition-note">
          {entry.capability === "needs-repair"
            ? "Needs repair"
            : error
              ? "Preview unavailable"
              : "…"}
        </small>
      )}
    </span>
  );
}
