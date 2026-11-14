import { REGIONAL_ACTION_TIMEOUT_MS } from "./regional-action-budget";
import { AUTH_OWNER_COOKIE, type SessionUser } from "./auth-do";
import {
  ACCOUNT_DELETE_PATH,
  type AccountDeletions,
} from "./account-deletions";
import { regionalLoginPage } from "./regional-login-page";
import type { ProfileBylines } from "./profile-bylines";
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
    private readonly deletions: AccountDeletions,
    private readonly profileBylines?: ProfileBylines,
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS regional_codes (
      code_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL,
      challenge TEXT NOT NULL, audience TEXT NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`);
    sql.exec(`CREATE TABLE IF NOT EXISTS regional_grants (
      grant_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL,
      audience TEXT NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`);
    sql.exec(`CREATE TABLE IF NOT EXISTS regional_action_capabilities (
      token_hash TEXT PRIMARY KEY, binding TEXT NOT NULL, user_id TEXT NOT NULL,
      reference_kind TEXT NOT NULL, reference_hash TEXT NOT NULL,
      expires_at INTEGER NOT NULL) WITHOUT ROWID`);
    // Gallery blocks are retired, and with them the restriction revisions.
    sql.exec("DROP TABLE IF EXISTS regional_security_clock");
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
      if (url.pathname === REGIONAL_PREFIX + "action-authorize") {
        const grant = validNonce(body.grant)
          ? await this.currentGrant(body.grant)
          : null;
        if (!grant) return answer({ error: "invalid-grant" }, 401);
        return this.issueAction(
          body.binding,
          grant.user.id,
          "grant",
          await digest(String(body.grant)),
        );
      }
      if (url.pathname === REGIONAL_PREFIX + "owner-action-authorize")
        return this.authorizeOwnerAction(body.token, body.binding);
      if (url.pathname === REGIONAL_PREFIX + "action-verify")
        return this.verifyAction(body);
      if (url.pathname === REGIONAL_PREFIX + "providers")
        return answer({
          ...this.providers,
          ...(this.config.accountDeletion === true
            ? { accountDeletion: true }
            : {}),
        });
      if (url.pathname === REGIONAL_PREFIX + "deletions")
        return this.deletions.feed(body);
      if (url.pathname === REGIONAL_PREFIX + "bylines")
        return (
          this.profileBylines?.feed(body) ?? answer({ error: "not-found" }, 404)
        );
      if (url.pathname === REGIONAL_PREFIX + "exchange")
        return this.exchange(body);
      if (url.pathname === REGIONAL_PREFIX + "renew") return this.renew(body);
      if (url.pathname === REGIONAL_PREFIX + "revoke") {
        if (!validNonce(body.grant))
          return answer({ error: "invalid-request" }, 400);
        this.sql.exec(
          "DELETE FROM regional_grants WHERE grant_hash = ? AND audience = ?",
          await digest(body.grant),
          this.config.clientOrigin,
        );
        return answer({ revoked: true });
      }
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
        return answer({
          result: { status: response.status, body: await response.json() },
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
            if (this.deletions.has(id)) return { id, status: "deleted" };
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
    const provider = url.searchParams.get("provider");
    if (
      provider !== null &&
      provider !== "github" &&
      provider !== "google" &&
      provider !== "email"
    )
      return answer({ error: "invalid-provider" }, 400);
    if (provider && !this.providers[provider])
      return answer({ error: "provider-disabled" }, 404);
    const returnPath =
      REGIONAL_PREFIX +
      "authorize?" +
      new URLSearchParams({ state, challenge });
    if (provider === "github" || provider === "google")
      return redirect(
        new URL(
          `/api/auth/${provider}/start?` +
            new URLSearchParams({ return: returnPath }),
          this.config.origin,
        ).toString(),
      );
    if (provider === "email" || url.searchParams.get("select") === "true")
      return regionalLoginPage(
        returnPath,
        provider === "email"
          ? { github: false, google: false, email: true }
          : this.providers,
        Boolean(user),
      );
    if (!user) return regionalLoginPage(returnPath, this.providers);
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
      expiresAt: this.now() + REGIONAL_LEASE_MS,
    });
  }

  private async currentGrant(value: string) {
    return this.currentGrantHash(await digest(value));
  }

  private async currentGrantHash(hash: string) {
    const row = this.sql
      .exec<GrantRow>(
        "SELECT * FROM regional_grants WHERE grant_hash = ? AND audience = ? AND expires_at > ?",
        hash,
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
    if (subject.id === actor.id) return { row, actor, user: subject };
    if (!actor.isAdmin || !subject.seat) return null;
    return {
      row,
      actor,
      user: {
        ...subject,
        switchedFrom: { id: actor.id, displayName: actor.displayName },
      },
    };
  }

  /** Called only through the trusted AUTH binding, after normal cookie resolution. */
  async authorizeSourceAction(request: Request): Promise<Response> {
    const body = await readBody(request);
    const bearer = /^Bearer (acot_[A-Za-z0-9_-]{1,128})$/.exec(
      request.headers.get("authorization") ?? "",
    );
    if (bearer) return this.authorizeOwnerAction(bearer[1], body?.binding);
    const hash = await sourceSessionHash(cookie(request, "icm_session") ?? "");
    const user = await this.session(hash);
    if (!user) return answer({ error: "unauthorized" }, 401);
    return this.issueAction(body?.binding, user.id, "session", hash);
  }

  private async authorizeOwnerAction(
    token: unknown,
    binding: unknown,
  ): Promise<Response> {
    if (typeof token !== "string" || !/^acot_[A-Za-z0-9_-]{1,128}$/.test(token))
      return answer({ error: "unauthorized" }, 401);
    const user = await this.ownerToken(token);
    if (!user?.isOwner) return answer({ error: "unauthorized" }, 401);
    return this.issueAction(
      binding,
      user.id,
      "owner-token",
      await sourceSessionHash(token),
    );
  }

  private async issueAction(
    binding: unknown,
    userId: string,
    kind: string,
    reference: string,
  ): Promise<Response> {
    if (!validNonce(binding)) return answer({ error: "invalid-binding" }, 400);
    this.sql.exec(
      "DELETE FROM regional_action_capabilities WHERE expires_at<=?",
      this.now(),
    );
    const count = this.sql
      .exec<{ n: number }>(
        "SELECT COUNT(*) AS n FROM regional_action_capabilities",
      )
      .toArray()[0]!.n;
    if (count >= 5000) return answer({ error: "authorization-busy" }, 503);
    const token = nonce();
    this.sql.exec(
      "INSERT INTO regional_action_capabilities VALUES (?,?,?,?,?,?)",
      await digest(token),
      binding,
      userId,
      kind,
      reference,
      this.now() + REGIONAL_ACTION_TIMEOUT_MS,
    );
    return answer({ token });
  }

  /** A capability names one command; a fresh session/grant check still decides its actor. */
  async verifyAction(body: Record<string, unknown>): Promise<Response> {
    if (!validNonce(body.token) || !validNonce(body.binding))
      return answer({ error: "unauthorized" }, 401);
    const row = this.sql
      .exec<{
        user_id: string;
        reference_kind: string;
        reference_hash: string;
      }>(
        "SELECT * FROM regional_action_capabilities WHERE token_hash=? AND binding=? AND expires_at>?",
        await digest(body.token),
        body.binding,
        this.now(),
      )
      .toArray()[0];
    const user =
      row?.reference_kind === "owner-token"
        ? this.ownerActionIdentity(row.reference_hash)
        : row?.reference_kind === "grant"
          ? (await this.currentGrantHash(row.reference_hash))?.user
          : row
            ? await this.session(row.reference_hash)
            : null;
    if (!user || user.id !== row?.user_id)
      return answer({ error: "unauthorized" }, 401);
    return answer({ user });
  }

  private ownerActionIdentity(hash: string): SessionUser | null {
    const row = this.sql
      .exec<{ user_id: string }>(
        "SELECT user_id FROM owner_tokens WHERE token_hash=?",
        hash,
      )
      .toArray()[0];
    const user = row ? this.identity(row.user_id) : null;
    return user?.isOwner ? user : null;
  }

  private async deleteAccount(
    body: Record<string, unknown>,
  ): Promise<Response> {
    const input = body.body as Record<string, unknown> | undefined;
    const wrap = async (response: Response, revokedUserId?: string) =>
      answer({
        result: { status: response.status, body: await response.json() },
        ...(revokedUserId ? { revokedUserId } : {}),
      });
    if (input?.statusOnly === true || input?.confirm === "delete-account") {
      const previous = await this.deletions.status(input.requestId);
      if (previous) return wrap(previous);
      if (input.statusOnly === true)
        return wrap(answer({ error: "unknown-deletion" }, 404));
    }
    if (this.config.accountDeletion !== true)
      return answer({ error: "not-found" }, 404);
    const grant = validNonce(body.grant)
      ? await this.currentGrant(body.grant)
      : null;
    if (!grant) return answer({ error: "invalid-grant" }, 401);
    const response = await this.account(
      new Request(this.config.origin + ACCOUNT_DELETE_PATH, {
        method: "POST",
        headers: {
          origin: this.config.origin,
          "content-type": "application/json",
        },
        body: JSON.stringify(input ?? {}),
      }),
      grant.user,
    );
    return wrap(
      response,
      response.ok && this.deletions.has(grant.user.id)
        ? grant.user.id
        : undefined,
    );
  }

  private async accountOperation(
    body: Record<string, unknown>,
  ): Promise<Response> {
    if (
      typeof body.method !== "string" ||
      typeof body.path !== "string" ||
      !isRegionalAccountRoute(body.method, body.path)
    )
      return answer({ error: "not-found" }, 404);
    if (body.path === ACCOUNT_DELETE_PATH) return this.deleteAccount(body);
    if (!validNonce(body.grant)) return answer({ error: "invalid-grant" }, 401);
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
    const current = await this.currentGrant(body.grant);
    if (!current) return answer({ error: "invalid-grant" }, 401);
    return answer({
      // Existing account lists have no count cap. Keep their response contract;
      // the bounded reader above applies to untrusted incoming RPC bodies.
      result,
      ...(body.path === "/api/auth/profile" && response.ok
        ? { byline: this.profileBylines?.current(current.user.id) }
        : {}),
      user: current.user,
      expiresAt: this.now() + REGIONAL_LEASE_MS,
    });
  }
}
