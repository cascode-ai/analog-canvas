// The account Analog Canvas vouches for to AnalogArena
// (docs/specs/analog-arena.md#forwarded-identity), and the one request this
// side sends Arena itself: unlinking an account it deletes
// (docs/specs/analog-arena.md#account-deletion). Forwarding (arena.ts) and
// the account store (auth-do.ts) both build the account here, so Arena
// always reads one shape.

import type { SessionUser } from "./auth-do";

/** The forwarded account, as one JSON object; absent when signed out. */
export const ARENA_ACCOUNT_HEADER = "x-arena-account";

/**
 * Arena's account deletion. It lies outside /arena… and /api/arena/…, the
 * only paths this Worker forwards, so no browser request ever reaches it.
 */
const ARENA_ACCOUNT_DELETION_PATH = "/api/canvas/account-deletion";

/** The service binding to `analog-arena`; Production alone holds it. */
export type ArenaService = {
  fetch(request: Request): Promise<Response>;
};

/**
 * The header value: the contract's fields, nothing else from the session.
 * A header carries bytes, so every character outside printable ASCII
 * travels as a JSON `\u` escape; the value is still one JSON object and
 * parses to the name.
 */
export function arenaAccount(user: SessionUser): string {
  const account = JSON.stringify({
    id: user.id,
    displayName: user.displayName,
    isOwner: user.isOwner === true,
    isAdmin: user.isAdmin,
    role: user.role === "moderator" ? "moderator" : "user",
    seat: user.seat ?? null,
  });
  // UTF-16 units, not code points: an emoji travels as its surrogate pair.
  return account.replace(
    /[\u007f-\uffff]/g,
    (unit) => `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`,
  );
}

/**
 * Asks Arena to unlink `user`, whose account is being deleted, from its
 * Voter. True once Arena has done it, which it answers alike however often
 * it is asked, or when no Arena is bound: only Production binds it, and a
 * Worker without the binding never forwarded an account to Arena. False
 * when the call threw or Arena did not answer success, so the deletion
 * stops with the account still signed in.
 */
export async function unlinkArenaVoter(
  arena: ArenaService | undefined,
  user: SessionUser,
  origin: string,
): Promise<boolean> {
  if (!arena) return true;
  try {
    const response = await arena.fetch(
      new Request(new URL(ARENA_ACCOUNT_DELETION_PATH, origin), {
        method: "POST",
        headers: { [ARENA_ACCOUNT_HEADER]: arenaAccount(user) },
      }),
    );
    if (response.ok) return true;
    console.error("Arena did not unlink a deleted account", response.status);
  } catch (error) {
    console.error("Arena unreachable while deleting an account", error);
  }
  return false;
}
