import { deriveStableId, isFrozenSnapshot } from "@icm/model";

const canonicalCache = new WeakMap<object, string>();

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    let out = "[";
    for (let i = 0; i < value.length; i += 1) {
      if (i > 0) out += ",";
      const item = value[i];
      out += item === undefined ? "null" : canonicalJson(item);
    }
    return `${out}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    let out = "{";
    let first = true;
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i]!;
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) continue;
      if (!first) out += ",";
      first = false;
      out += `${JSON.stringify(key)}:${canonicalJson(item)}`;
    }
    return `${out}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/**
 * A saved Symbol's content signature, independent of key order: a repair
 * recognizes exactly the built-in snapshot it replaces by it.
 */
export function symbolSignature(prefix: string, symbol: unknown): string {
  let serialized: string;
  if (symbol && typeof symbol === "object" && isFrozenSnapshot(symbol)) {
    const cached = canonicalCache.get(symbol);
    if (cached !== undefined) {
      serialized = cached;
    } else {
      serialized = canonicalJson(symbol);
      canonicalCache.set(symbol, serialized);
    }
  } else {
    serialized = canonicalJson(symbol);
  }
  return deriveStableId(prefix, serialized);
}
