type JsonRecord = Record<string, unknown>;

/**
 * Semantic equality for JSON-compatible model values without serializing to
 * strings. Matches JSON object semantics by ignoring keys whose value is
 * `undefined`, while remaining independent of object property insertion order.
 */
export function equalJsonValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftArray = Array.isArray(left);
  if (leftArray !== Array.isArray(right)) return false;
  if (leftArray) {
    const a = left as readonly unknown[];
    const b = right as readonly unknown[];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!equalJsonValue(a[i], b[i])) return false;
    }
    return true;
  }
  const a = left as JsonRecord;
  const b = right as JsonRecord;
  let leftDefinedCount = 0;
  for (const key of Object.keys(a)) {
    const value = a[key];
    if (value === undefined) continue;
    leftDefinedCount += 1;
    if (!Object.hasOwn(b, key)) return false;
    const other = b[key];
    if (other === undefined || !equalJsonValue(value, other)) return false;
  }
  let rightDefinedCount = 0;
  for (const key of Object.keys(b)) {
    if (b[key] !== undefined) rightDefinedCount += 1;
  }
  return leftDefinedCount === rightDefinedCount;
}

/**
 * Serialization-level equality for JSON-compatible model values, preserving
 * object key order and ignoring keys whose value is `undefined`, without
 * allocating serialized strings.
 */
export function equalJsonKeyOrder(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  ) {
    return false;
  }
  const leftArray = Array.isArray(left);
  if (leftArray !== Array.isArray(right)) return false;
  if (leftArray) {
    const a = left as readonly unknown[];
    const b = right as readonly unknown[];
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!equalJsonKeyOrder(a[i], b[i])) return false;
    }
    return true;
  }
  const a = left as JsonRecord;
  const b = right as JsonRecord;
  const leftKeys = Object.keys(a);
  const rightKeys = Object.keys(b);
  let li = 0;
  let ri = 0;
  while (true) {
    while (li < leftKeys.length && a[leftKeys[li]!] === undefined) li += 1;
    while (ri < rightKeys.length && b[rightKeys[ri]!] === undefined) ri += 1;
    if (li === leftKeys.length || ri === rightKeys.length) {
      return li === leftKeys.length && ri === rightKeys.length;
    }
    const key = leftKeys[li]!;
    if (key !== rightKeys[ri]!) return false;
    if (!equalJsonKeyOrder(a[key], b[key])) return false;
    li += 1;
    ri += 1;
  }
}
