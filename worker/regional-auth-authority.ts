import { AUTH_OWNER_COOKIE, type SessionUser } from "./auth-do";
import { regionalLoginPage } from "./regional-login-page";
import {
  answer,
  authenticated,
  cookie,
  digest,
  isRegionalAccountRoute,
  isRegionalSecurityRoute,
  nonce,
  readBody,
  redirect,
  REGIONAL_HANDOFF_MS,
  REGIONAL_LEASE_MS,
  REGIONAL_PREFIX,
  validNonce,
  type RegionalConfig,
  type RegionalSql,
} from "./regional-auth-contract";

type GrantRow = {
  grant_hash: string;
  session_hash: string;
  subject_id: string | null;
  actor_session_hash: string | null;
};

/** AuthDO's own session table uses hex SHA-256, not the regional code digest. */
async function sourceSessionHash(token: string): Promise<string> {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(token),
  );
  return [...new Uint8Array(bytes)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export class RegionalAuthority {
  constructor(
    private readonly sql: RegionalSql,
    private readonly config: RegionalConfig,
    private readonly session: (hash: string) => Promise<SessionUser | null>,
    private readonly now: () => number,
    private readonly providers: {
      github: boolean;
      google: boolean;
      email: boolean;
    },
    private readonly identity: (id: string) => SessionUser | null,
    private readonly account: (
      request: Request,
      user: SessionUser,
    ) => Promise<Response>,
    private readonly ownerToken: (token: string) => Promise<SessionUser | null>,
    private readonly security: (request: Request) => Promise<Response>,
    private readonly relatedRestrictions: (
      id: string,
    ) => { id: string; blocked: boolean }[],
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS regional_codes (
      code_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL,
      challenge TEXT NOT NULL, audience TEXT NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`);
    sql.exec(`CREATE TABLE IF NOT EXISTS regional_grants (
      grant_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL,
      audience TEXT NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`);
    sql.exec(
      "CREATE TABLE IF NOT EXISTS regional_security_clock (id INTEGER PRIMARY KEY CHECK(id = 1), revision INTEGER NOT NULL)",
    );
    sql.exec("INSERT OR IGNORE INTO regional_security_clock VALUES (1, 0)");
    for (const table of ["regional_codes", "regional_grants"]) {
      const columns = sql
        .exec<{ name: string }>(`PRAGMA table_info(${table})`)
        .toArray();
      for (const column of ["actor_session_hash", "subject_id"])
        if (!columns.some(({ name }) => name === column))
          sql.exec(`ALTER TABLE ${table} ADD COLUMN ${column} TEXT`);
    }
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== this.config.origin)
      return answer({ error: "invalid-origin" }, 421);
    if (request.method === "POST") {
      if (!(await authenticated(request, this.config.secret)))
        return answer({ error: "unauthorized" }, 401);
      const body = await readBody(request);
      if (!body) return answer({ error: "invalid-request" }, 400);
      if (url.pathname === REGIONAL_PREFIX + "exchange")
        return this.exchange(body);
      if (url.pathname === REGIONAL_PREFIX + "renew") return this.renew(body);
      if (url.pathname === REGIONAL_PREFIX + "account")
        return this.accountOperation(body);
      if (url.pathname === REGIONAL_PREFIX + "security") {
        if (
          typeof body.path !== "string" ||
          !isRegionalSecurityRoute("POST", body.path)
        )
          return answer({ error: "not-found" }, 404);
        if (
          !body.body ||
          typeof body.body !== "object" ||
          Array.isArray(body.body)
        )
          return answer({ error: "invalid-request" }, 400);
        const response = await this.security(
          new Request("https://auth" + body.path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body.body),
          }),
        );
        const result = { status: response.status, body: await response.json() };
        return answer({
          result,
          ...(response.ok && body.path === "/internal/block-account"
            ? {
                restrictions: this.restrictions(
                  (body.body as Record<string, unknown>).userId,
                ),
              }
            : {}),
        });
      }
      if (url.pathname === REGIONAL_PREFIX + "owner-token") {
        const token = body.token;
        if (
          typeof token !== "string" ||
          !/^acot_[A-Za-z0-9_-]{1,128}$/u.test(token)
        )
          return answer({ user: null }, 401);
        const user = await this.ownerToken(token);
        return answer({ user }, user ? 200 : 401);
      }
      if (url.pathname === REGIONAL_PREFIX + "identities") {
        if (
          !Array.isArray(body.userIds) ||
          body.userIds.length > 100 ||
          !body.userIds.every(
            (id) => typeof id === "string" && id.length > 0 && id.length <= 256,
          )
        )
          return answer({ error: "invalid-request" }, 400);
        return answer({
          identities: body.userIds.map((id: string) => {
            const user = this.identity(id);
            return user
              ? { id, status: "found", user }
              : { id, status: "missing" };
          }),
        });
      }
    }
    if (
      request.method !== "GET" ||
      url.pathname !== REGIONAL_PREFIX + "authorize"
    )
      return answer({ error: "not-found" }, 404);
    const state = url.searchParams.get("state");
    const challenge = url.searchParams.get("challenge");
    if (!validNonce(state) || !validNonce(challenge))
      return answer({ error: "invalid-request" }, 400);
    const token = cookie(request, "icm_session");
    const sessionHash = await sourceSessionHash(token ?? "");
    const user = token ? await this.session(sessionHash) : null;
    if (!user)
      return regionalLoginPage(url.pathname + url.search, this.providers);
    let actorHash: string | null = null;
    if (user.seat) {
      const owner = cookie(request, AUTH_OWNER_COOKIE);
      actorHash = owner ? await sourceSessionHash(owner) : null;
      const actor = actorHash ? await this.session(actorHash) : null;
      if (!actor?.isAdmin || actor.seat)
        return answer({ error: "original-actor-required" }, 409);
    }
    const code = nonce();
    this.sql.exec(
      "DELETE FROM regional_codes WHERE expires_at <= ?",
      this.now(),
    );
    this.sql.exec(
      "INSERT INTO regional_codes (code_hash, session_hash, challenge, audience, expires_at, actor_session_hash, subject_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
      await digest(code),
      sessionHash,
      challenge,
      this.config.clientOrigin,
      this.now() + REGIONAL_HANDOFF_MS,
      actorHash,
      user.id,
    );
    const target = new URL(
      REGIONAL_PREFIX + "callback",
      this.config.clientOrigin,
    );
    target.search = new URLSearchParams({ code, state }).toString();
    return redirect(target.toString());
  }

  private async exchange(body: Record<string, unknown>): Promise<Response> {
    if (!validNonce(body.code) || !validNonce(body.verifier))
      return answer({ error: "invalid-request" }, 400);
    const codeHash = await digest(body.code);
    const challenge = await digest(body.verifier);
    // Delete and return in one statement: concurrent exchanges cannot both win.
    const row = this.sql
      .exec<
        Pick<GrantRow, "session_hash" | "actor_session_hash" | "subject_id">
      >(
        "DELETE FROM regional_codes WHERE code_hash = ? AND challenge = ? AND audience = ? AND expires_at > ? RETURNING session_hash, actor_session_hash, subject_id",
        codeHash,
        challenge,
        this.config.clientOrigin,
        this.now(),
      )
      .toArray()[0];
    const user = row ? await this.session(row.session_hash) : null;
    if (!row || !user) return answer({ error: "invalid-grant" }, 401);
    const grant = nonce();
    this.sql.exec(
      "DELETE FROM regional_grants WHERE expires_at <= ?",
      this.now(),
    );
    this.sql.exec(
      "INSERT INTO regional_grants (grant_hash, session_hash, audience, expires_at, actor_session_hash, subject_id) VALUES (?, ?, ?, ?, ?, ?)",
      await digest(grant),
      row.session_hash,
      this.config.clientOrigin,
      this.now() + 30 * 86400_000,
      row.actor_session_hash,
      row.subject_id,
    );
    const current = await this.currentGrant(grant);
    if (!current) {
      this.sql.exec(
        "DELETE FROM regional_grants WHERE grant_hash = ?",
        await digest(grant),
      );
      return answer({ error: "invalid-grant" }, 401);
    }
    return answer({
      user: current.user,
      restrictionRevision: current.restrictionRevision,
      grant,
      expiresAt: this.now() + REGIONAL_LEASE_MS,
    });
  }

  private async renew(body: Record<string, unknown>): Promise<Response> {
    if (!validNonce(body.grant))
      return answer({ error: "invalid-request" }, 400);
    const grant = await this.currentGrant(body.grant);
    if (!grant) {
      this.sql.exec(
        "DELETE FROM regional_grants WHERE grant_hash = ?",
        await digest(body.grant),
      );
      return answer({ error: "invalid-grant" }, 401);
    }
    return answer({
      user: grant.user,
      restrictionRevision: grant.restrictionRevision,
      expiresAt: this.now() + REGIONAL_LEASE_MS,
    });
  }

  private async currentGrant(value: string) {
    const row = this.sql
      .exec<GrantRow>(
        "SELECT * FROM regional_grants WHERE grant_hash = ? AND audience = ? AND expires_at > ?",
        await digest(value),
        this.config.clientOrigin,
        this.now(),
      )
      .toArray()[0];
    const anchor = row ? await this.session(row.session_hash) : null;
    if (!row || !anchor || (anchor.seat && !row.actor_session_hash))
      return null;
    const actor = row.actor_session_hash
      ? await this.session(row.actor_session_hash)
      : anchor;
    if (!actor) return null;
    const subject = row.subject_id ? this.identity(row.subject_id) : anchor;
    if (!subject) return null;
    const restrictionRevision = this.sql
      .exec<{ revision: number }>(
        "SELECT revision FROM regional_security_clock WHERE id = 1",
      )
      .one().revision;
    if (subject.id === actor.id)
      return { row, actor, user: subject, restrictionRevision };
    if (!actor.isAdmin || !subject.seat) return null;
    return {
      row,
      actor,
      restrictionRevision,
      user: {
        ...subject,
        switchedFrom: { id: actor.id, displayName: actor.displayName },
      },
    };
  }

  private restrictions(id: unknown) {
    const users = typeof id === "string" ? this.relatedRestrictions(id) : [];
    const revision = this.sql
      .exec<{ revision: number }>(
        "UPDATE regional_security_clock SET revision = revision + 1 WHERE id = 1 RETURNING revision",
      )
      .one().revision;
    return { revision, users };
  }

  private async accountOperation(
    body: Record<string, unknown>,
  ): Promise<Response> {
    if (!validNonce(body.grant)) return answer({ error: "invalid-grant" }, 401);
    if (
      typeof body.method !== "string" ||
      typeof body.path !== "string" ||
      !isRegionalAccountRoute(body.method, body.path)
    )
      return answer({ error: "not-found" }, 404);
    const grant = await this.currentGrant(body.grant);
    if (!grant) return answer({ error: "invalid-grant" }, 401);
    let response: Response;
    if (body.path === "/api/auth/ai-accounts/switch") {
      const target =
        body.body &&
        typeof body.body === "object" &&
        "userId" in body.body &&
        typeof body.body.userId === "string"
          ? this.identity(body.body.userId)
          : null;
      if (!grant.user.isAdmin)
        response = answer({ error: "unauthorized" }, 401);
      else if (!target?.seat)
        response = answer({ error: "no-such-ai-account" }, 404);
      else {
        this.sql.exec(
          "UPDATE regional_grants SET subject_id = ? WHERE grant_hash = ?",
          target.id,
          grant.row.grant_hash,
        );
        response = answer({ switched: true });
      }
    } else if (body.path === "/api/auth/ai-accounts/return") {
      if (!grant.user.seat && !grant.user.isAdmin)
        response = answer({ error: "not-switched" }, 409);
      else {
        this.sql.exec(
          "UPDATE regional_grants SET subject_id = ? WHERE grant_hash = ?",
          grant.actor.id,
          grant.row.grant_hash,
        );
        response = answer({ returned: true });
      }
    } else
      response = await this.account(
        new Request(this.config.origin + body.path, {
          method: body.method,
          headers: {
            origin: this.config.origin,
            "content-type": "application/json",
          },
          ...(body.method === "GET"
            ? {}
            : { body: JSON.stringify(body.body ?? {}) }),
        }),
        grant.user,
      );
    const result = {
      status: response.status,
      body: await response.json().catch(() => null),
    };
    const restrictions =
      body.path === "/api/auth/blocked/unblock" && response.ok
        ? this.restrictions(
            (body.body as Record<string, unknown> | undefined)?.userId,
          )
        : undefined;
    const current = await this.currentGrant(body.grant);
    if (!current) return answer({ error: "invalid-grant" }, 401);
    return answer({
      // Existing account lists have no count cap. Keep their response contract;
      // the bounded reader above applies to untrusted incoming RPC bodies.
      result,
      user: current.user,
      restrictionRevision: current.restrictionRevision,
      ...(restrictions ? { restrictions } : {}),
      expiresAt: this.now() + REGIONAL_LEASE_MS,
    });
  }
}
