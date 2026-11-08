/** Undefined preserves the existing all-account opt-in mode. An explicit list is restrictive. */
export function projectExpansion(value?: string): "off" | "copy" | "all" {
  const mode = value?.trim();
  if (mode === undefined || mode === "off") return "off";
  if (mode === "copy" || mode === "all") return mode;
  throw new TypeError("Invalid regional Project expansion");
}

export function projectRegionUsers(
  value?: string,
  expansion?: string,
): string[] | null {
  const mode = projectExpansion(expansion);
  if (mode === "copy" && value === undefined)
    throw new TypeError("Project baseline needs a fixed trial account list");
  if (value === undefined) return null;
  const users: unknown = JSON.parse(value);
  if (
    !Array.isArray(users) ||
    users.length > 50 ||
    users.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/u.test(id),
    )
  )
    throw new TypeError("Invalid regional Project account list");
  return mode === "all" ? null : users;
}

export function includesProjectOwner(
  value: string | undefined,
  userId: string,
  expansion?: string,
): boolean {
  return projectRegionUsers(value, expansion)?.includes(userId) ?? true;
}

/** Background copies also require authority-coordinated deletion. */
export function coordinatesProjectDeletion(
  value: string | undefined,
  userId: string,
  expansion?: string,
): boolean {
  const users = projectRegionUsers(value, expansion);
  return (
    projectExpansion(expansion) === "copy" || (users?.includes(userId) ?? true)
  );
}

/** A trial may copy these source Projects, but cannot mutate their domestic copies. */
export function protectedProjectIds(value?: string): string[] {
  if (value === undefined) return [];
  const ids: unknown = JSON.parse(value);
  if (
    !Array.isArray(ids) ||
    ids.length > 1000 ||
    ids.some(
      (id) => typeof id !== "string" || !/^[a-zA-Z0-9:_-]{1,160}$/u.test(id),
    )
  )
    throw new TypeError("Invalid protected Project list");
  return ids;
}
