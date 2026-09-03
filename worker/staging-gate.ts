/**
 * The staging environment's front door.
 *
 * Staging exists to be looked at before production is, which means it must
 * not be findable. An unlisted hostname is not privacy: search engines index
 * what they are linked to, and a half-built product answering to the public
 * is worse than no staging at all.
 *
 * So the gate FAILS CLOSED. With no shared secret configured, staging serves
 * nothing to anyone — including on its very first deploy, before a person has
 * had the chance to provision anything. The failure mode of a missing
 * configuration is "nobody gets in", never "everybody does".
 *
 * Production has no gate: `stagingAccessGate` is only consulted when the
 * deployment declares itself staging, so this code cannot lock the live site
 * out by accident.
 */
export interface StagingEnv {
  /** Set only in the staging environment; production leaves it unset. */
  ICM_ENVIRONMENT?: string;
  /** The shared secret that opens staging. Absent means nobody enters. */
  STAGING_ACCESS_KEY?: string;
}

const COOKIE_NAME = "icm_staging_access";

function unauthorized(message: string): Response {
  return new Response(message, {
    status: 401,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      // Nothing here should be cached, indexed, or followed.
      "cache-control": "no-store",
      "x-robots-tag": "noindex, nofollow, noarchive",
    },
  });
}

/**
 * Returns a refusal when the request may not see staging, or null to let it
 * through. Accepts the key as a cookie, a header, or a one-time query
 * parameter that sets the cookie, so a person can open the site by pasting
 * one link and stay in afterwards.
 */
export function stagingAccessGate(
  request: Request,
  env: StagingEnv,
): Response | null {
  if (env.ICM_ENVIRONMENT !== "staging") return null;

  const key = env.STAGING_ACCESS_KEY;
  if (!key) {
    return unauthorized(
      "This staging deployment has no access key configured, so it serves nobody.",
    );
  }

  const url = new URL(request.url);
  const fromQuery = url.searchParams.get("key");
  if (fromQuery && fromQuery === key) {
    // Redirect so the secret leaves the address bar and the browsing history.
    url.searchParams.delete("key");
    return new Response(null, {
      status: 302,
      headers: {
        location: url.toString(),
        "set-cookie": `${COOKIE_NAME}=${key}; Path=/; HttpOnly; Secure; SameSite=Lax`,
        "cache-control": "no-store",
      },
    });
  }

  const header = request.headers.get("x-staging-access-key");
  if (header && header === key) return null;

  const cookies = request.headers.get("cookie") ?? "";
  const match = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${COOKIE_NAME}=`));
  if (match && match.slice(COOKIE_NAME.length + 1) === key) return null;

  return unauthorized("Staging is not public.");
}
