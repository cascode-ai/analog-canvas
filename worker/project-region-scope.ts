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
