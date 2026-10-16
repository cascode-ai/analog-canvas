/**
 * Whether a 429 is one of the Worker's daily allowances (publishing, sign-in
 * codes, Gallery opens) rather than its per-address flood limit, which
 * answers `too-many-requests` and lifts within a minute.
 */
export async function isDailyAllowanceRefusal(
  response: Response,
): Promise<boolean> {
  if (response.status !== 429) return false;
  const body = (await response
    .clone()
    .json()
    .catch(() => null)) as { error?: unknown } | null;
  return body?.error !== "too-many-requests";
}
