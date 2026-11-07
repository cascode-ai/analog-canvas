import type { GalleryEnv } from "./gallery-store";
import { readSyncJson } from "./project-sync-http";
import { regionalConfig, REGIONAL_PREFIX } from "./regional-auth-contract";

type IdentityEnv = Pick<
  GalleryEnv,
  | "PROJECT_IDENTITY_URL"
  | "PROJECT_IDENTITY_TOKEN"
  | "AUTH"
  | "AUTH_REGIONAL_AUTHORITY"
>;
/** The identities endpoint answers at most this many IDs per request. */
const IDENTITY_BATCH = 100;

/**
 * Peer imports keep existing account IDs: each must already exist at the
 * identity authority. Unknown accounts block (409); an unavailable
 * authority is retried (503). `ownsAuthority` is true in the overseas region,
 * which serves the authority itself.
 */
export async function requireKnownAccounts(
  env: IdentityEnv,
  userIds: readonly string[],
  ownsAuthority: boolean,
): Promise<Response | null> {
  if (!userIds.length) return null;
  if (!env.PROJECT_IDENTITY_URL || !env.PROJECT_IDENTITY_TOKEN)
    return Response.json({ error: "identity-unavailable" }, { status: 503 });
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
        if (found?.status !== "found" || found.user?.id !== id)
          return Response.json({ error: "unknown-owner" }, { status: 409 });
      }
    }
  } catch {
    return Response.json({ error: "identity-unavailable" }, { status: 503 });
  }
  return null;
}
