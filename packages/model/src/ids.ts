const ID_PREFIX_PATTERN = /^[a-z][a-z0-9-]*$/;
const FNV_OFFSET_BASIS_64 = 0xcbf29ce484222325n;
const FNV_PRIME_64 = 0x100000001b3n;
const UINT64_MASK = 0xffffffffffffffffn;

function assertPrefix(prefix: string): void {
  if (!ID_PREFIX_PATTERN.test(prefix)) {
    throw new Error(`Invalid ID prefix: ${prefix}`);
  }
}

function fnv1a64(value: string): string {
  let hash = FNV_OFFSET_BASIS_64;
  for (const byte of new TextEncoder().encode(value)) {
    hash ^= BigInt(byte);
    hash = (hash * FNV_PRIME_64) & UINT64_MASK;
  }
  return hash.toString(16).padStart(16, "0");
}

export function deriveStableId(
  prefix: string,
  ...identityParts: string[]
): string {
  assertPrefix(prefix);
  if (identityParts.length === 0) {
    throw new Error("A stable ID requires at least one identity part");
  }
  const framed = identityParts
    .map((part) => `${part.length}:${part}`)
    .join("|");
  return `${prefix}-${fnv1a64(framed)}`;
}

/** The block symbol a Cell's callers draw by default, keyed by its name without case. */
export function hierarchicalSymbolId(cellName: string): string {
  return deriveStableId("hierarchical-symbol", cellName.toLowerCase());
}

export function createId(prefix: string, randomUuid?: () => string): string {
  assertPrefix(prefix);
  const uuidFactory = randomUuid ?? (() => globalThis.crypto.randomUUID());
  return `${prefix}-${uuidFactory()}`;
}
