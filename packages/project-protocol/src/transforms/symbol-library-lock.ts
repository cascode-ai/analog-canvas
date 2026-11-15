import { CURRENT_SYMBOL_LIBRARY_LOCK } from "@icm/model";

/**
 * The development lock early Projects carried. Nothing ever resolved symbols
 * by it: those Projects always drew from the current catalog, so the Owner
 * unified them with the current lock rather than keep a second identity that
 * copy and Cell import refuse as incompatible.
 */
const RETIRED_LOCK = {
  id: "builtin-analog",
  version: "0.0.0",
  hash: "development",
};

function isRetiredLock(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
  const lock = value as Record<string, unknown>;
  return (
    Object.keys(lock).length === 3 &&
    lock.id === RETIRED_LOCK.id &&
    lock.version === RETIRED_LOCK.version &&
    lock.hash === RETIRED_LOCK.hash
  );
}

/** Reads the retired development lock as the current Symbol Library lock. */
export function upgradeRetiredSymbolLibraryLock(
  project: Record<string, unknown>,
): Record<string, unknown> {
  if (!isRetiredLock(project.symbolLibrary)) return project;
  return { ...project, symbolLibrary: { ...CURRENT_SYMBOL_LIBRARY_LOCK } };
}
