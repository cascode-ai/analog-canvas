/** Page-local elapsed clock: changing the computer's wall clock cannot expire a Claim. */
export function claimNow(): number {
  return performance.timeOrigin + performance.now();
}

/** Translate the relay's expiry into the page clock without another handshake. */
export function claimDeadline(
  expiresAt: number,
  responseDate: string | null,
  requestStartedAt: number,
): number {
  const serverTime = Date.parse(responseDate ?? "");
  // HTTP Date has one-second precision. Deduct its uncertainty and the whole
  // request interval rather than presenting a code beyond its server lifetime.
  // Older/local relays without Date retain their former wall-clock estimate.
  const remaining = Number.isFinite(serverTime)
    ? expiresAt - serverTime - 1_000
    : expiresAt - Date.now();
  return requestStartedAt + Math.max(0, remaining);
}
