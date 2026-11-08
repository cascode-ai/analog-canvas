import type { GalleryEnv } from "./gallery-store";
import { readSyncJson } from "./project-sync-http";
import { regionalConfig, REGIONAL_PREFIX } from "./regional-auth-contract";
import { validAccountId } from "./retired-accounts";

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
export type AccountLookup = { missing: number; deleted: string[] };
export const unknownSyncOwner = () =>
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
): Promise<AccountLookup | Response> {
  if (!userIds.length) return { missing: 0, deleted: [] };
  let missing = 0;
  const deleted: string[] = [];
  try {
    for (let i = 0; i < userIds.length; i += IDENTITY_BATCH) {
      const batch = userIds.slice(i, i + IDENTITY_BATCH);
      const identity = await requestAuthority(
        env,
        "identities",
        { userIds: batch },
        ownsAuthority,
      );
      if (!identity.ok) throw new Error("Identity unavailable");
      const result = (await readSyncJson(identity, 16384 * batch.length)) as {
        identities?: { id: string; status: string; user?: { id: string } }[];
      };
      for (const id of batch) {
        const found = result.identities?.find((item) => item.id === id);
        if (found?.status === "missing") missing++;
        else if (found?.status === "deleted") deleted.push(id);
        else if (found?.status !== "found" || found.user?.id !== id)
          return unknownSyncOwner();
      }
    }
  } catch {
    return unavailable();
  }
  return { missing, deleted };
}

/** Private Project imports require every owner to exist (409 otherwise). */
export async function requireKnownAccounts(
  env: IdentityEnv,
  userIds: readonly string[],
  ownsAuthority: boolean,
): Promise<Response | null> {
  const result = await lookupAccounts(env, userIds, ownsAuthority);
  if (result instanceof Response) return result;
  if (result.deleted.length)
    return Response.json({ error: "account-deleted" }, { status: 409 });
  return result.missing ? unknownSyncOwner() : null;
}

/** Replay a retired owner into an isolated restore without acknowledging the live job. */
export async function readDeletionForRecovery(
  env: IdentityEnv,
  after: number,
): Promise<{ sequence: number; userId: string } | null | Response> {
  try {
    const response = await requestAuthority(env, "deletions", { after }, false);
    if (!response.ok) return response.status === 409 ? response : unavailable();
    const result = (await readSyncJson(response, 4096)) as {
      version?: unknown;
      job?: { sequence?: unknown; userId?: unknown } | null;
    };
    if (result?.version !== 1) return unavailable();
    if (result.job === null) return null;
    const job = result.job;
    return job && job.sequence === after + 1 && validAccountId(job.userId)
      ? { sequence: job.sequence, userId: job.userId }
      : unavailable();
  } catch {
    return unavailable();
  }
}

async function requestAuthority(
  env: IdentityEnv,
  action: "identities" | "deletions",
  body: unknown,
  ownsAuthority: boolean,
): Promise<Response> {
  if (!env.PROJECT_IDENTITY_URL || !env.PROJECT_IDENTITY_TOKEN)
    return unavailable();
  const identityUrl = new URL(env.PROJECT_IDENTITY_URL);
  if (
    identityUrl.protocol !== "https:" ||
    identityUrl.username ||
    identityUrl.password
  )
    return unavailable();
  const config = regionalConfig(env.AUTH_REGIONAL_AUTHORITY);
  const local =
    ownsAuthority &&
    env.AUTH &&
    config &&
    identityUrl.href === `${config.origin}${REGIONAL_PREFIX}identities`;
  const url =
    action === "identities"
      ? identityUrl
      : new URL(REGIONAL_PREFIX + action, identityUrl);
  const init: RequestInit = {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(10_000),
    headers: {
      Authorization: `Bearer ${env.PROJECT_IDENTITY_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };
  return local && env.AUTH
    ? env.AUTH.getByName("auth").fetch(url.href, init)
    : fetch(url, init);
}
