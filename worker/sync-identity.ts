import type { GalleryEnv } from "./gallery-store";
import { readSyncJson } from "./project-sync-http";
import { regionalConfig, REGIONAL_PREFIX } from "./regional-auth-contract";

export type IdentityEnv = Pick<
  GalleryEnv,
  | "PROJECT_IDENTITY_URL"
  | "PROJECT_IDENTITY_TOKEN"
  | "AUTH"
  | "AUTH_REGIONAL_AUTHORITY"
>;
/** The identities endpoint answers at most this many IDs per request. */
const IDENTITY_BATCH = 100;
const unavailable = () =>
  Response.json({ error: "identity-unavailable" }, { status: 503 });
const unknown = () =>
  Response.json({ error: "unknown-owner" }, { status: 409 });

/**
 * Look up existing account IDs at the identity authority: how many it
 * reports missing, 409 for an answer that names another account, or 503
 * while it is unavailable. `ownsAuthority` is true in the overseas region,
 * which serves the authority itself.
 */
export async function lookupAccounts(
  env: IdentityEnv,
  userIds: readonly string[],
  ownsAuthority: boolean,
): Promise<{ missing: number } | Response> {
  if (!userIds.length) return { missing: 0 };
  if (!env.PROJECT_IDENTITY_URL || !env.PROJECT_IDENTITY_TOKEN)
    return unavailable();
  let missing = 0;
  try {
    const identityUrl = new URL(env.PROJECT_IDENTITY_URL);
    if (
      identityUrl.protocol !== "https:" ||
      identityUrl.username ||
      identityUrl.password
    )
      throw new Error("Invalid identity endpoint");
    const authority = regionalConfig(env.AUTH_REGIONAL_AUTHORITY);
    for (let i = 0; i < userIds.length; i += IDENTITY_BATCH) {
      const batch = userIds.slice(i, i + IDENTITY_BATCH);
      const identityRequest: RequestInit = {
        method: "POST",
        redirect: "manual",
        signal: AbortSignal.timeout(10000),
        headers: {
          Authorization: `Bearer ${env.PROJECT_IDENTITY_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ userIds: batch }),
      };
      // The source owns this authority. Keep its authenticated request inside
      // the AUTH binding instead of depending on public routing back to itself.
      const identity =
        ownsAuthority &&
        env.AUTH &&
        authority &&
        identityUrl.href === `${authority.origin}${REGIONAL_PREFIX}identities`
          ? await env.AUTH.getByName("auth").fetch(
              identityUrl.href,
              identityRequest,
            )
          : await fetch(identityUrl, identityRequest);
      if (!identity.ok) throw new Error("Identity unavailable");
      const result = (await readSyncJson(identity, 16384 * batch.length)) as {
        identities?: { id: string; status: string; user?: { id: string } }[];
      };
      for (const id of batch) {
        const found = result.identities?.find((item) => item.id === id);
        if (found?.status === "missing") missing++;
        else if (found?.status !== "found" || found.user?.id !== id)
          return unknown();
      }
    }
  } catch {
    return unavailable();
  }
  return { missing };
}

/** Private Project imports require every owner to exist (409 otherwise). */
export async function requireKnownAccounts(
  env: IdentityEnv,
  userIds: readonly string[],
  ownsAuthority: boolean,
): Promise<Response | null> {
  const result = await lookupAccounts(env, userIds, ownsAuthority);
  if (result instanceof Response) return result;
  return result.missing ? unknown() : null;
}
