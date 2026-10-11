import { useEffect, useRef, useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import type { SymbolDefinition } from "@icm/symbols";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import { readSharedComponentPreview } from "./component-library-client";
import { LibraryCache } from "./library-cache";

const previews = new LibraryCache<SymbolDefinition>(100, 2 * 1024 * 1024);

export function LibraryPreview({ entry }: { entry: ComponentLibrarySummary }) {
  const container = useRef<HTMLSpanElement>(null);
  const key = `${entry.id}:${entry.revision}`;
  const [symbol, setSymbol] = useState(() =>
    entry.status !== "deleted" ? previews.get(key) : undefined,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    if (symbol || entry.capability === "needs-repair") return;
    const controller = new AbortController();
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
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
      },
      { rootMargin: "100px" },
    );
    if (container.current) observer.observe(container.current);
    return () => {
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
