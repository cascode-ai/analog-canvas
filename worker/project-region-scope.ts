/** Undefined preserves the existing all-account opt-in mode. An explicit list is restrictive. */
export function projectRegionUsers(value?: string): string[] | null {
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
  return users;
}

export function includesProjectOwner(
  value: string | undefined,
  userId: string,
): boolean {
  return projectRegionUsers(value)?.includes(userId) ?? true;
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
