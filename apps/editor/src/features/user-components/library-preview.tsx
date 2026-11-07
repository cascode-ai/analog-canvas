import { useEffect, useRef, useState } from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import type { SymbolDefinition } from "@icm/symbols";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import {
  readSharedComponentPreview,
  readSharedComponentPreviews,
} from "./component-library-client";
import { COMPONENT_PREVIEW_BATCH_LIMIT } from "./component-library-contract";
import { LibraryCache } from "./library-cache";

/** A revision's preview never changes, so it stays for the session. */
const previews = new LibraryCache<SymbolDefinition>(
  400,
  4 * 1024 * 1024,
  Infinity,
);
/** Rows that come into view together wait this long to share one read. */
const GATHER_MS = 40;

type Delivery = (symbol: SymbolDefinition | null) => void;
const wanted = new Map<
  string,
  { entry: ComponentLibrarySummary; deliveries: Set<Delivery>; sent: boolean }
>();
let gathering: ReturnType<typeof setTimeout> | undefined;
const keyOf = (entry: ComponentLibrarySummary) =>
  `${entry.id}:${entry.revision}`;

/** Asks for a row's preview; returns how to stop waiting for it. */
function requestPreview(
  entry: ComponentLibrarySummary,
  deliver: Delivery,
): () => void {
  const key = keyOf(entry);
  let item = wanted.get(key);
  if (!item) {
    item = { entry, deliveries: new Set(), sent: false };
    wanted.set(key, item);
  }
  item.deliveries.add(deliver);
  if (!item.sent) gathering ??= setTimeout(readGathered, GATHER_MS);
  const asked = item;
  return () => {
    asked.deliveries.delete(deliver);
    // A row scrolled past before its read began costs nothing.
    if (!asked.sent && !asked.deliveries.size && wanted.get(key) === asked)
      wanted.delete(key);
  };
}

function readGathered() {
  gathering = undefined;
  const batch = [...wanted.values()].filter((item) => !item.sent);
  for (const item of batch) item.sent = true;
  for (let at = 0; at < batch.length; at += COMPONENT_PREVIEW_BATCH_LIMIT)
    void readBatch(batch.slice(at, at + COMPONENT_PREVIEW_BATCH_LIMIT));
}

async function readBatch(
  batch: { entry: ComponentLibrarySummary; deliveries: Set<Delivery> }[],
) {
  const settle = (
    item: (typeof batch)[number],
    symbol: SymbolDefinition | null,
  ) => {
    const key = keyOf(item.entry);
    if (symbol && item.entry.status !== "deleted") previews.set(key, symbol);
    wanted.delete(key);
    for (const deliver of item.deliveries) deliver(symbol);
  };
  let symbols: Map<string, SymbolDefinition> | null;
  try {
    symbols = await readSharedComponentPreviews(
      batch.map((item) => item.entry),
    );
  } catch {
    for (const item of batch) settle(item, null);
    return;
  }
  if (symbols) {
    for (const item of batch)
      settle(item, symbols.get(keyOf(item.entry)) ?? null);
    return;
  }
  // A service from before batched previews answers one record at a time.
  await Promise.all(
    batch.map((item) =>
      readSharedComponentPreview(item.entry).then(
        (symbol) => settle(item, symbol),
        () => settle(item, null),
      ),
    ),
  );
}

export function LibraryPreview({
  entry,
  onPreviewWarning,
}: {
  entry: ComponentLibrarySummary;
  onPreviewWarning?: ((warning: string | null) => void) | undefined;
}) {
  const container = useRef<HTMLSpanElement>(null);
  const key = keyOf(entry);
  const [symbol, setSymbol] = useState(() =>
    entry.status !== "deleted" ? previews.get(key) : undefined,
  );
  const [error, setError] = useState(false);
  useEffect(() => {
    if (symbol || entry.capability === "needs-repair") return;
    let active = true;
    let done = false;
    let release: (() => void) | undefined;
    const observer = new IntersectionObserver(
      (records) => {
        const visible = records.some((record) => record.isIntersecting);
        if (visible && !release && !done)
          release = requestPreview(entry, (next) => {
            done = true;
            if (!active) return;
            if (next) setSymbol(next);
            else setError(true);
          });
        else if (!visible && release) {
          release();
          release = undefined;
        }
      },
      { rootMargin: "200px" },
    );
    if (container.current) observer.observe(container.current);
    return () => {
      active = false;
      release?.();
      observer.disconnect();
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
