import { deriveStableId } from "@icm/model";

function ordered(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(ordered);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, ordered(item)]),
    );
  return value;
}

/**
 * A saved Symbol's content signature, independent of key order: a repair
 * recognizes exactly the built-in snapshot it replaces by it.
 */
export function symbolSignature(prefix: string, symbol: unknown): string {
  return deriveStableId(prefix, JSON.stringify(ordered(symbol)));
}
