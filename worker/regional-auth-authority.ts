import type { SessionUser } from "./auth-do";
import { regionalLoginPage } from "./regional-login-page";
import {
  answer,
  authenticated,
  cookie,
  digest,
  isRegionalAccountRoute,
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
  ) {
    sql.exec(`CREATE TABLE IF NOT EXISTS regional_codes (
      code_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL,
      challenge TEXT NOT NULL, audience TEXT NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`);
    sql.exec(`CREATE TABLE IF NOT EXISTS regional_grants (
      grant_hash TEXT PRIMARY KEY, session_hash TEXT NOT NULL,
      audience TEXT NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`);
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
    // AuthDO uses hex SHA-256 for its own session table.
    const bytes = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(token ?? ""),
    );
    const sessionHash = [...new Uint8Array(bytes)]
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (!token || !(await this.session(sessionHash)))
      return regionalLoginPage(url.pathname + url.search, this.providers);
    const code = nonce();
    this.sql.exec(
      "DELETE FROM regional_codes WHERE expires_at <= ?",
      this.now(),
    );
    this.sql.exec(
      "INSERT INTO regional_codes VALUES (?, ?, ?, ?, ?)",
      await digest(code),
      sessionHash,
      challenge,
      this.config.clientOrigin,
      this.now() + REGIONAL_HANDOFF_MS,
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
      .exec<{ session_hash: string }>(
        "DELETE FROM regional_codes WHERE code_hash = ? AND challenge = ? AND audience = ? AND expires_at > ? RETURNING session_hash",
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
      "INSERT INTO regional_grants VALUES (?, ?, ?, ?)",
      await digest(grant),
      row.session_hash,
      this.config.clientOrigin,
      this.now() + 30 * 86400_000,
    );
    return answer({ user, grant, expiresAt: this.now() + REGIONAL_LEASE_MS });
  }

  private async renew(body: Record<string, unknown>): Promise<Response> {
    if (!validNonce(body.grant))
      return answer({ error: "invalid-request" }, 400);
    const hash = await digest(body.grant);
    const row = this.sql
      .exec<{ session_hash: string }>(
        "SELECT session_hash FROM regional_grants WHERE grant_hash = ? AND audience = ? AND expires_at > ?",
        hash,
        this.config.clientOrigin,
        this.now(),
      )
      .toArray()[0];
    const user = row ? await this.session(row.session_hash) : null;
    if (!user) {
      this.sql.exec("DELETE FROM regional_grants WHERE grant_hash = ?", hash);
      return answer({ error: "invalid-grant" }, 401);
    }
    return answer({ user, expiresAt: this.now() + REGIONAL_LEASE_MS });
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
    const row = this.sql
      .exec<{ session_hash: string }>(
        "SELECT session_hash FROM regional_grants WHERE grant_hash = ? AND audience = ? AND expires_at > ?",
        await digest(body.grant),
        this.config.clientOrigin,
        this.now(),
      )
      .toArray()[0];
    const user = row ? await this.session(row.session_hash) : null;
    if (!row || !user) return answer({ error: "invalid-grant" }, 401);
    const response = await this.account(
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
      user,
    );
    const current = await this.session(row.session_hash);
    if (!current) return answer({ error: "invalid-grant" }, 401);
    return answer({
      // Existing account lists have no count cap. Keep their response contract;
      // the bounded reader above applies to untrusted incoming RPC bodies.
      result: {
        status: response.status,
        body: await response.json().catch(() => null),
      },
      user: current,
      expiresAt: this.now() + REGIONAL_LEASE_MS,
    });
  }
}
