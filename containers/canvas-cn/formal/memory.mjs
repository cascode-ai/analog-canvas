// Only the pinned standalone runtime enables --expose-gc. Cloudflare's hosted
// runtime owns its collection policy and never imports this regional entry.
let entriesSinceCollection = 0;
let lastCollectionAt = 0;
let collections = 0;

export function collectRegionalGarbage() {
  if (typeof globalThis.gc !== "function") return;
  const now = Date.now();
  if (!lastCollectionAt) lastCollectionAt = now;
  entriesSinceCollection++;
  if (entriesSinceCollection < 128 && now - lastCollectionAt < 30_000) return;
  // Collect unreachable wrappers before they retain unbounded native request
  // graphs. Live streams, transactions and object state remain reachable.
  globalThis.gc();
  entriesSinceCollection = 0;
  lastCollectionAt = now;
  collections++;
}

export function regionalMemoryStatus() {
  return {
    enabled: typeof globalThis.gc === "function",
    collections,
    lastCollectionAt,
  };
}
