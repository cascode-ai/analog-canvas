// The startup recovery offers this browser turned down (Ignore) or took
// (Restore), by recovery record. A record is offered once: a reload or a new
// window never asks about it again, and File → Recover Unsaved Work still
// lists it. A newer snapshot of the same working copy is a new record.

const KEY = "icm-startup-recovery-dismissed";
/** Enough for every working copy a browser keeps; the oldest go first. */
const LIMIT = 50;

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

export function readDismissedStartupRecoveries(
  store: Pick<Storage, "getItem"> | null = storage(),
): ReadonlySet<string> {
  try {
    const value: unknown = JSON.parse(store?.getItem(KEY) ?? "[]");
    return new Set(
      Array.isArray(value)
        ? value.filter((id): id is string => typeof id === "string")
        : [],
    );
  } catch {
    return new Set();
  }
}

export function rememberDismissedStartupRecovery(
  recordId: string,
  store: Pick<Storage, "getItem" | "setItem"> | null = storage(),
): ReadonlySet<string> {
  const ids = [
    ...[...readDismissedStartupRecoveries(store)].filter(
      (id) => id !== recordId,
    ),
    recordId,
  ].slice(-LIMIT);
  try {
    store?.setItem(KEY, JSON.stringify(ids));
  } catch {
    // A full or blocked storage only means the offer may come back.
  }
  return new Set(ids);
}
