import type { SessionUser } from "./auth-do";
import {
  applyProfileByline,
  isProfileByline,
  PROFILE_BYLINE_TICK,
  type ProfileByline,
} from "./profile-bylines";
import { coordinatesProjectDeletion } from "./project-region-scope";
import { withHostedSimulation } from "./hosted-simulation-access";
import {
  ACCOUNT_DELETE_PATH,
  ACCOUNT_DELETION_TICK,
  purgeAccountResources,
  type AccountResourceBindings,
} from "./account-deletions";
import {
  installRetiredAccounts,
  retireAccount,
  retiredAccount,
  validAccountId,
} from "./retired-accounts";
import {
  answer,
  cookie,
  digest,
  isRegionalAccountRoute,
  isRegionalSecurityRoute,
  nonce,
  readBody,
  redirect,
  regionalConfig,
  REGIONAL_LEASE_MS,
  REGIONAL_PREFIX,
  REGIONAL_REFRESH_MS,
  REGIONAL_SESSION_COOKIE,
  sessionIdentity,
  setCookie,
  validNonce,
  type RegionalConfig,
  type RegionalSql,
} from "./regional-auth-contract";

type State = {
  storage: {
    sql: RegionalSql;
    setAlarm(time: number): Promise<void>;
    transactionSync<T>(callback: () => T): T;
  };
};
type SessionRow = {
  token_hash: string;
  user_json: string;
  grant: string;
  lease_until: number;
  expires_at: number;
  refresh_at: number;
  generation: number;
  actor_id: string | null;
};
const SESSION_SECONDS = 30 * 86400;
const LOGIN_SECONDS = 600;

/** Bind this store as AUTH in an isolated region; it never allocates users. */
export class RegionalSessionDO {
  private readonly config: RegionalConfig | null;
  private readonly sql: RegionalSql;
  private readonly accountOperations = new Map<string, Promise<void>>();
  fetchLike: typeof fetch = (input, init) => fetch(input, init);
  now: () => number = () => Date.now();

  constructor(
    private readonly state: State,
    private readonly env: AccountResourceBindings & {
      AUTH_REGIONAL_CLIENT?: string;
    },
  ) {
    this.config = regionalConfig(env.AUTH_REGIONAL_CLIENT);
    this.sql = state.storage.sql;
    if (!this.config) return;
    installRetiredAccounts(this.sql);
    this.sql.exec(`CREATE TABLE IF NOT EXISTS regional_deletion_cursor (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), sequence INTEGER NOT NULL
    )`);
    this.sql.exec(
      "INSERT OR IGNORE INTO regional_deletion_cursor VALUES (1, 0)",
    );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS regional_byline_cursor (
      singleton INTEGER PRIMARY KEY CHECK(singleton=1), sequence INTEGER NOT NULL
    )`);
    this.sql.exec("INSERT OR IGNORE INTO regional_byline_cursor VALUES (1,0)");
    this.sql.exec(`CREATE TABLE IF NOT EXISTS regional_pending (
      state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, expires_at INTEGER NOT NULL) WITHOUT ROWID`);
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(regional_pending)")
        .toArray()
        .some((column) => column.name === "return_path")
    )
      this.sql.exec(
        "ALTER TABLE regional_pending ADD COLUMN return_path TEXT NOT NULL DEFAULT '/'",
      );
    this.sql.exec(`CREATE TABLE IF NOT EXISTS regional_sessions (
      token_hash TEXT PRIMARY KEY, user_json TEXT NOT NULL, grant TEXT NOT NULL,
      lease_until INTEGER NOT NULL, expires_at INTEGER NOT NULL, refresh_at INTEGER NOT NULL,
      login_state_hash TEXT NOT NULL UNIQUE) WITHOUT ROWID`);
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(regional_sessions)")
        .toArray()
        .some((column) => column.name === "generation")
    )
      this.sql.exec(
        "ALTER TABLE regional_sessions ADD COLUMN generation INTEGER NOT NULL DEFAULT 0",
      );
    if (
      !this.sql
        .exec<{ name: string }>("PRAGMA table_info(regional_sessions)")
        .toArray()
        .some((column) => column.name === "actor_id")
    )
      this.sql.exec("ALTER TABLE regional_sessions ADD COLUMN actor_id TEXT");
    // Gallery blocks are retired, and with them the restriction snapshots.
    this.sql.exec("DROP TABLE IF EXISTS regional_restrictions");
  }

  async fetch(request: Request): Promise<Response> {
    if (!this.config) return answer({ error: "not-found" }, 404);
    const url = new URL(request.url);
    if (
      url.origin === "https://auth" &&
      request.method === "POST" &&
      [
        "/internal/resource-action-authorize",
        "/internal/resource-action-verify",
      ].includes(url.pathname)
    ) {
      const body = await readBody(request);
      if (!body) return answer({ error: "invalid-request" }, 400);
      const ownerToken = /^Bearer (acot_[A-Za-z0-9_-]{1,128})$/.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (url.pathname.endsWith("authorize") && ownerToken) {
        const result = await this.authority("owner-action-authorize", {
          token: ownerToken,
          binding: body.binding,
        });
        return answer(
          result.body ?? { error: "authorization-unavailable" },
          result.status || 503,
        );
      }
      let grant: string | undefined;
      if (url.pathname.endsWith("authorize")) {
        const token = cookie(request, REGIONAL_SESSION_COOKIE);
        if (!validNonce(token)) return answer({ error: "unauthorized" }, 401);
        const row = this.sql
          .exec<SessionRow>(
            "SELECT * FROM regional_sessions WHERE token_hash=? AND expires_at>? AND lease_until>?",
            await digest(token),
            this.now(),
            this.now(),
          )
          .toArray()[0];
        if (!row) return answer({ error: "unauthorized" }, 401);
        grant = row.grant;
      }
      const result = await this.authority(
        grant ? "action-authorize" : "action-verify",
        {
          binding: body.binding,
          ...(grant ? { grant } : { token: body.token }),
        },
      );
      return answer(
        result.body ?? { error: "authorization-unavailable" },
        result.status || 503,
      );
    }
    if (
      url.origin === "https://auth" &&
      url.pathname === PROFILE_BYLINE_TICK &&
      request.method === "POST"
    )
      return this.tickBylines(true);
    if (
      url.origin === "https://auth" &&
      url.pathname === ACCOUNT_DELETION_TICK &&
      request.method === "POST"
    ) {
      const deletion = await this.tickAccountDeletion(this.config);
      const bylines = await this.tickBylines();
      return bylines.ok ? deletion : bylines;
    }
    if (
      url.origin === "https://auth" &&
      isRegionalSecurityRoute(request.method, url.pathname)
    ) {
      const body = request.body ? await readBody(request) : {};
      if (!body) return answer({ error: "invalid-request" }, 400);
      const result = await this.authority("security", {
        path: url.pathname,
        body,
      });
      const operation = operationResult(result.body);
      if (!operation) return answer({ error: "authority-unavailable" }, 503);
      return answer(operation.body, operation.status);
    }
    if (
      url.origin === "https://auth" &&
      url.pathname === "/internal/session-user" &&
      request.method === "GET"
    )
      return answer({ user: (await this.localUser(request)).user });
    if (
      url.origin === "https://auth" &&
      url.pathname === "/internal/owner-token-user" &&
      request.method === "GET"
    ) {
      const token = /^Bearer (acot_[A-Za-z0-9_-]{1,128})$/u.exec(
        request.headers.get("authorization") ?? "",
      )?.[1];
      if (!token) return answer({ user: null }, 401);
      const result = await this.authority("owner-token", { token });
      const user = sessionIdentity(result.body?.user);
      return answer({ user }, user ? 200 : result.status === 401 ? 401 : 503);
    }
    if (url.origin !== this.config.clientOrigin)
      return answer({ error: "invalid-origin" }, 421);
    if (request.method === "POST" && url.pathname === ACCOUNT_DELETE_PATH)
      return this.deleteAccount(request, this.config);
    if (isRegionalAccountRoute(request.method, url.pathname))
      return this.accountOperation(request, url);
    if (request.method === "GET") {
      if (url.pathname === REGIONAL_PREFIX + "start") return this.start(url);
      if (url.pathname === REGIONAL_PREFIX + "callback")
        return this.complete(request, url);
      if (url.pathname === "/api/auth/providers") {
        const result = await this.authority("providers", {});
        return answer({
          github: result.body?.github === true,
          google: result.body?.google === true,
          email: result.body?.email === true,
          central: true,
          loginUrl: REGIONAL_PREFIX + "start",
          ...(this.config.accountDeletion === true &&
          result.body?.accountDeletion === true &&
          this.canCoordinateDeletion((await this.localUser(request)).user)
            ? { accountDeletion: true }
            : {}),
        });
      }
      if (url.pathname === "/api/auth/me") {
        const local = await this.localUser(request);
        return answer({ ...local, user: withHostedSimulation(local.user) });
      }
    }
    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      if (request.headers.get("origin") !== this.config.clientOrigin)
        return answer({ error: "forbidden" }, 403);
      const token = cookie(request, REGIONAL_SESSION_COOKIE);
      if (token)
        this.sql.exec(
          "DELETE FROM regional_sessions WHERE token_hash = ?",
          await digest(token),
        );
      const pending = cookie(request, "icm_regional_login");
      if (validNonce(pending)) {
        const hash = await digest(pending);
        this.sql.exec(
          "DELETE FROM regional_pending WHERE state_hash = ?",
          hash,
        );
        this.sql.exec(
          "DELETE FROM regional_sessions WHERE login_state_hash = ?",
          hash,
        );
      }
      const response = answer({ ok: true });
      response.headers.append(
        "set-cookie",
        setCookie(REGIONAL_SESSION_COOKIE, "", this.config.clientOrigin, 0),
      );
      response.headers.append(
        "set-cookie",
        setCookie("icm_regional_login", "", this.config.clientOrigin, 0),
      );
      return response;
    }
    return answer({ error: "not-found" }, 404);
  }

  private async localUser(request: Request): Promise<{
    user: SessionUser | null;
    authorization: "active" | "expired" | "anonymous";
  }> {
    const token = cookie(request, REGIONAL_SESSION_COOKIE);
    if (!validNonce(token)) return { user: null, authorization: "anonymous" };
    const row = this.sql
      .exec<SessionRow>(
        "SELECT * FROM regional_sessions WHERE token_hash = ?",
        await digest(token),
      )
      .toArray()[0];
    if (!row) return { user: null, authorization: "anonymous" };
    if (row.expires_at <= this.now() || row.lease_until <= this.now())
      return { user: null, authorization: "expired" };
    return {
      user: this.projectedUser(row),
      authorization: "active",
    };
  }

  private async start(url: URL): Promise<Response> {
    const provider = url.searchParams.get("provider");
    if (provider !== null && !["github", "google", "email"].includes(provider))
      return answer({ error: "invalid-provider" }, 400);
    const config = this.config!;
    const state = nonce(),
      verifier = nonce();
    this.sql.exec(
      "DELETE FROM regional_pending WHERE expires_at <= ?",
      this.now(),
    );
    const count = this.sql
      .exec<{ count: number }>("SELECT COUNT(*) AS count FROM regional_pending")
      .one().count;
    if (count >= 1000) return answer({ error: "login-busy" }, 429);
    this.sql.exec(
      "INSERT INTO regional_pending (state_hash, verifier, expires_at, return_path) VALUES (?, ?, ?, ?)",
      await digest(state),
      verifier,
      this.now() + LOGIN_SECONDS * 1000,
      returnPath(url.searchParams.get("return"), config.clientOrigin),
    );
    const target = new URL(REGIONAL_PREFIX + "authorize", config.origin);
    target.search = new URLSearchParams({
      state,
      challenge: await digest(verifier),
    }).toString();
    if (provider) target.searchParams.set("provider", provider);
    if (url.searchParams.get("select") === "true")
      target.searchParams.set("select", "true");
    const response = redirect(target.toString());
    response.headers.append(
      "set-cookie",
      setCookie(
        "icm_regional_login",
        state,
        config.clientOrigin,
        LOGIN_SECONDS,
      ),
    );
    return response;
  }

  private async complete(request: Request, url: URL): Promise<Response> {
    const config = this.config!;
    const state = url.searchParams.get("state"),
      code = url.searchParams.get("code");
    if (
      !validNonce(state) ||
      !validNonce(code) ||
      cookie(request, "icm_regional_login") !== state
    )
      return answer({ error: "invalid-callback" }, 400);
    const stateHash = await digest(state);
    const row = this.sql
      .exec<{ verifier: string; return_path: string }>(
        "SELECT verifier, return_path FROM regional_pending WHERE state_hash = ? AND expires_at > ?",
        stateHash,
        this.now(),
      )
      .toArray()[0];
    if (!row) return answer({ error: "expired-callback" }, 400);
    const result = await this.authority("exchange", {
      code,
      verifier: row.verifier,
    });
    const lease = this.lease(result.body);
    if (!lease || !validNonce(result.body?.grant))
      return answer({ error: "login-unavailable" }, 503);
    const token = nonce();
    const tokenHash = await digest(token);
    const grant = result.body.grant;
    const installed = this.state.storage.transactionSync(() => {
      // Logout can cancel this handoff while the authority exchange is in flight.
      const pending = this.sql
        .exec<{ verifier: string }>(
          "DELETE FROM regional_pending WHERE state_hash = ? AND expires_at > ? RETURNING verifier",
          stateHash,
          this.now(),
        )
        .toArray()[0];
      if (
        !pending ||
        retiredAccount(this.sql, lease.user.id) ||
        retiredAccount(this.sql, lease.user.switchedFrom?.id)
      )
        return false;
      this.sql.exec(
        "INSERT INTO regional_sessions (token_hash, user_json, grant, lease_until, expires_at, refresh_at, login_state_hash, actor_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        tokenHash,
        JSON.stringify(lease.user),
        grant,
        lease.expiresAt,
        this.now() + SESSION_SECONDS * 1000,
        this.now() + REGIONAL_REFRESH_MS,
        stateHash,
        lease.user.switchedFrom?.id ?? lease.user.id,
      );
      return true;
    });
    if (!installed) return answer({ error: "cancelled-callback" }, 400);
    await this.schedule();
    // A logout carrying the pending cookie also cancels an installed response
    // whose cookie has not reached the browser yet.
    if (
      !this.sql
        .exec(
          "SELECT token_hash FROM regional_sessions WHERE token_hash = ?",
          tokenHash,
        )
        .toArray()[0]
    )
      return answer({ error: "cancelled-callback" }, 400);
    const response = redirect(
      config.clientOrigin + returnPath(row.return_path, config.clientOrigin),
    );
    response.headers.append(
      "set-cookie",
      setCookie(
        REGIONAL_SESSION_COOKIE,
        token,
        config.clientOrigin,
        SESSION_SECONDS,
      ),
    );
    response.headers.append(
      "set-cookie",
      setCookie("icm_regional_login", "", config.clientOrigin, 0),
    );
    return response;
  }

  private lease(body: Record<string, unknown> | null): {
    user: SessionUser;
    expiresAt: number;
  } | null {
    const user = sessionIdentity(body?.user),
      expiresAt = body?.expiresAt;
    if (
      !user ||
      typeof expiresAt !== "number" ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= this.now()
    )
      return null;
    return {
      user,
      expiresAt: Math.min(expiresAt, this.now() + REGIONAL_LEASE_MS),
    };
  }

  private async authority(
    action:
      | "exchange"
      | "renew"
      | "account"
      | "deletions"
      | "bylines"
      | "owner-token"
      | "security"
      | "providers"
      | "owner-action-authorize"
      | "action-authorize"
      | "action-verify",
    body: unknown,
  ): Promise<{ status: number; body: Record<string, unknown> | null }> {
    const config = this.config;
    if (!config) return { status: 0, body: null };
    try {
      const response = await this.fetchLike(
        (config.transportOrigin ?? config.origin) + REGIONAL_PREFIX + action,
        {
          method: "POST",
          redirect: "manual",
          signal: AbortSignal.timeout(5000),
          headers: {
            authorization: "Bearer " + config.secret,
            "content-type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );
      const payload: unknown = response.ok
        ? action === "account" || action === "security"
          ? await response.json()
          : await readBody(response)
        : null;
      return {
        status: response.status,
        body:
          payload && typeof payload === "object" && !Array.isArray(payload)
            ? (payload as Record<string, unknown>)
            : null,
      };
    } catch {
      return { status: 0, body: null };
    }
  }

  private revokeAccount(userId: string) {
    this.state.storage.transactionSync(() => {
      retireAccount(this.sql, userId);
      this.sql.exec(
        `DELETE FROM regional_sessions
        WHERE actor_id=? OR json_extract(user_json, '$.id')=?`,
        userId,
        userId,
      );
    });
  }

  private async tickAccountDeletion(config: RegionalConfig): Promise<Response> {
    const after = this.sql
      .exec<{ sequence: number }>(
        "SELECT sequence FROM regional_deletion_cursor WHERE singleton=1",
      )
      .one().sequence;
    const result = await this.authority("deletions", { after });
    // Compatible with the authority release before this endpoint was added.
    if (result.status === 404 && config.accountDeletion !== true)
      return answer({ status: "disabled" });
    const job = result.body?.job as
      { sequence?: unknown; userId?: unknown } | null | undefined;
    if (result.body?.version !== 1) return answer({ status: "retry" }, 503);
    if (job === null) return answer({ status: "caught-up" });
    if (!job || !validAccountId(job.userId) || job.sequence !== after + 1)
      return answer({ status: "retry" }, 503);
    this.revokeAccount(job.userId);
    if (
      !(await purgeAccountResources(this.env, job.userId, {
        site: config.clientOrigin,
      }))
    )
      return answer({ status: "retry" }, 503);
    const acknowledgement = await this.authority("deletions", {
      acknowledge: job.sequence,
    });
    if (acknowledgement.body?.acknowledged !== job.sequence)
      return answer({ status: "retry" }, 503);
    this.sql.exec(
      "UPDATE regional_deletion_cursor SET sequence=MAX(sequence,?)",
      job.sequence,
    );
    return answer({ status: "sent" });
  }

  private async applyByline(job: ProfileByline): Promise<boolean> {
    if (job.deleted || retiredAccount(this.sql, job.ownerUserId)) return true;
    return applyProfileByline(this.env.GALLERY, job);
  }

  private async tickBylines(required = false): Promise<Response> {
    const after = this.sql
      .exec<{ sequence: number }>(
        "SELECT sequence FROM regional_byline_cursor WHERE singleton=1",
      )
      .one().sequence;
    const result = await this.authority("bylines", { after });
    // During a rolling upgrade the older authority has no byline feed yet.
    if (result.status === 404)
      return answer({ status: "disabled" }, required ? 503 : 200);
    const jobs = result.body?.jobs;
    if (
      result.body?.version !== 1 ||
      !Array.isArray(jobs) ||
      jobs.length > 50 ||
      !Number.isSafeInteger(result.body.head) ||
      Number(result.body.head) < after
    )
      return answer({ status: "byline-retry" }, 503);
    let previous = after;
    for (const job of jobs) {
      if (
        !isProfileByline(job) ||
        job.sequence <= previous ||
        job.sequence > Number(result.body.head)
      )
        return answer({ status: "byline-retry" }, 503);
      previous = job.sequence;
    }
    const head = Number(result.body.head);
    let sent = 0;
    const progress = () => {
      const cursor = this.sql
        .exec<{ sequence: number }>(
          "SELECT sequence FROM regional_byline_cursor WHERE singleton=1",
        )
        .one().sequence;
      return { head, cursor, sent, caughtUp: cursor >= head };
    };
    for (const job of jobs as ProfileByline[]) {
      if (!(await this.applyByline(job)))
        return answer(
          { status: "byline-retry", ...progress(), caughtUp: false },
          503,
        );
      this.sql.exec(
        "UPDATE regional_byline_cursor SET sequence=MAX(sequence,?) WHERE singleton=1",
        job.sequence,
      );
      sent++;
    }
    return answer({
      status: jobs.length ? "sent" : "caught-up",
      ...progress(),
    });
  }

  private canCoordinateDeletion(user: SessionUser | null): boolean {
    try {
      return (
        !!user &&
        coordinatesProjectDeletion(
          this.env.PROJECT_REGION_USERS,
          user.id,
          this.env.PROJECT_SYNC_EXPANSION,
        )
      );
    } catch {
      return false;
    }
  }

  private async deleteAccount(
    request: Request,
    config: RegionalConfig,
  ): Promise<Response> {
    if (
      request.headers.get("origin") !== config.clientOrigin ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return answer({ error: "forbidden" }, 403);
    const body = await readBody(request);
    if (config.accountDeletion !== true && body?.statusOnly !== true)
      return answer({ error: "account-deletion-unavailable" }, 503);
    if (!body) return answer({ error: "invalid-request" }, 400);
    const token = cookie(request, REGIONAL_SESSION_COOKIE);
    const send = async (tokenHash?: string) => {
      const row = tokenHash
        ? this.sql
            .exec<SessionRow>(
              "SELECT * FROM regional_sessions WHERE token_hash=? AND lease_until>? AND expires_at>?",
              tokenHash,
              this.now(),
              this.now(),
            )
            .toArray()[0]
        : undefined;
      const result = await this.authority("account", {
        path: ACCOUNT_DELETE_PATH,
        method: "POST",
        body,
        grant: row?.grant,
      });
      const operation = operationResult(result.body);
      if (!operation)
        return result.status === 401
          ? answer({ error: "unauthorized" }, 401)
          : answer({ error: "account-unavailable" }, 503);
      const revoked = result.body?.revokedUserId;
      const response = answer(operation.body, operation.status);
      if (
        row &&
        validAccountId(revoked) &&
        (JSON.parse(row.user_json) as SessionUser).id === revoked
      ) {
        this.revokeAccount(revoked);
        response.headers.append(
          "set-cookie",
          setCookie(REGIONAL_SESSION_COOKIE, "", config.clientOrigin, 0),
        );
      }
      return response;
    };
    if (!validNonce(token) || body.statusOnly === true) return send();
    const tokenHash = await digest(token);
    return this.orderedAccountOperation(tokenHash, () => send(tokenHash));
  }

  private async accountOperation(
    request: Request,
    url: URL,
  ): Promise<Response> {
    if (
      ((request.method !== "GET" || request.headers.has("origin")) &&
        request.headers.get("origin") !== this.config?.clientOrigin) ||
      request.headers.get("sec-fetch-site") === "cross-site"
    )
      return answer({ error: "forbidden" }, 403);
    const token = cookie(request, REGIONAL_SESSION_COOKIE);
    if (!validNonce(token)) return answer({ error: "unauthorized" }, 401);
    const tokenHash = await digest(token);
    const body =
      request.method === "GET" ||
      (!request.body &&
        (request.method === "DELETE" ||
          url.pathname === "/api/auth/ai-accounts/return"))
        ? {}
        : await readBody(request);
    if (!body) return answer({ error: "invalid-request" }, 400);
    return this.orderedAccountOperation(tokenHash, () =>
      this.runAccountOperation(request.method, url.pathname, body, tokenHash),
    );
  }

  /** Order each session's account effects; local reads and logout stay independent. */
  private async orderedAccountOperation(
    tokenHash: string,
    operation: () => Promise<Response>,
  ): Promise<Response> {
    const previous = this.accountOperations.get(tokenHash);
    let release = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.accountOperations.set(tokenHash, pending);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.accountOperations.get(tokenHash) === pending)
        this.accountOperations.delete(tokenHash);
    }
  }

  private async runAccountOperation(
    method: string,
    path: string,
    body: Record<string, unknown>,
    tokenHash: string,
  ): Promise<Response> {
    const row = this.sql
      .exec<SessionRow>(
        "SELECT * FROM regional_sessions WHERE token_hash = ?",
        tokenHash,
      )
      .toArray()[0];
    if (!row || row.expires_at <= this.now() || row.lease_until <= this.now())
      return answer({ error: "unauthorized" }, 401);
    const changingIdentity = [
      "/api/auth/ai-accounts/switch",
      "/api/auth/ai-accounts/return",
    ].includes(path);
    const fenced = this.sql
      .exec<SessionRow>(
        "UPDATE regional_sessions SET generation = generation + 1, refresh_at = ?, lease_until = ? WHERE token_hash = ? AND grant = ? AND generation = ? RETURNING *",
        this.now() + REGIONAL_REFRESH_MS,
        changingIdentity ? 0 : row.lease_until,
        tokenHash,
        row.grant,
        row.generation,
      )
      .toArray()[0];
    if (!fenced) return answer({ error: "unauthorized" }, 401);
    await this.schedule();
    const result = await this.authority("account", {
      grant: row.grant,
      method,
      path,
      body,
    });
    if (result.status === 401) {
      this.sql.exec(
        "DELETE FROM regional_sessions WHERE token_hash = ? AND grant = ? AND generation = ?",
        tokenHash,
        row.grant,
        fenced.generation,
      );
      return answer({ error: "unauthorized" }, 401);
    }
    const lease = this.lease(result.body);
    const operation = operationResult(result.body);
    if (
      !lease ||
      (lease.user.switchedFrom?.id ?? lease.user.id) !==
        (row.actor_id ?? (JSON.parse(row.user_json) as SessionUser).id) ||
      !operation
    )
      return answer({ error: "account-unavailable" }, 503);
    const updated = this.sql
      .exec<{ token_hash: string }>(
        "UPDATE regional_sessions SET user_json = ?, lease_until = ?, actor_id = ? WHERE token_hash = ? AND grant = ? AND generation = ? RETURNING token_hash",
        JSON.stringify(lease.user),
        lease.expiresAt,
        lease.user.switchedFrom?.id ?? lease.user.id,
        tokenHash,
        row.grant,
        fenced.generation,
      )
      .toArray()[0];
    if (!updated) return answer({ error: "unauthorized" }, 401);
    if (
      path === "/api/auth/profile" &&
      operation.status === 200 &&
      this.env.GALLERY
    ) {
      const job = result.body?.byline;
      if (
        !isProfileByline(job) ||
        job.ownerUserId !== lease.user.id ||
        job.displayName !== lease.user.displayName ||
        !(await this.applyByline(job))
      )
        return answer({ error: "byline-propagation-pending" }, 503);
    }
    return answer(operation.body, operation.status);
  }

  private projectedUser(row: SessionRow): SessionUser | null {
    return sessionIdentity(JSON.parse(row.user_json));
  }

  private async schedule(): Promise<void> {
    const row = this.sql
      .exec<{ next: number | null }>(
        "SELECT MIN(refresh_at) AS next FROM regional_sessions",
      )
      .one();
    if (row.next !== null)
      // Drain overdue batches without spending another second of every lease.
      // The bounded batch and awaited network calls still limit concurrency.
      await this.state.storage.setAlarm(Math.max(this.now() + 100, row.next));
  }

  async alarm(): Promise<void> {
    if (!this.config) return;
    this.sql.exec(
      "DELETE FROM regional_sessions WHERE expires_at <= ?",
      this.now(),
    );
    const due = this.sql
      .exec<SessionRow>(
        "SELECT * FROM regional_sessions WHERE refresh_at <= ? ORDER BY refresh_at LIMIT 100",
        this.now(),
      )
      .toArray();
    for (const row of due)
      this.sql.exec(
        "UPDATE regional_sessions SET refresh_at = ? WHERE token_hash = ?",
        this.now() + REGIONAL_REFRESH_MS,
        row.token_hash,
      );
    // Persist another alarm before network I/O, including retries after a crash.
    await this.schedule();
    await Promise.all(
      due.map(async (row) => {
        const result = await this.authority("renew", { grant: row.grant });
        if (result.status === 401) {
          this.sql.exec(
            "DELETE FROM regional_sessions WHERE token_hash = ? AND grant = ? AND generation = ?",
            row.token_hash,
            row.grant,
            row.generation,
          );
          return;
        }
        const lease = this.lease(result.body);
        if (
          !lease ||
          (lease.user.switchedFrom?.id ?? lease.user.id) !==
            (row.actor_id ?? (JSON.parse(row.user_json) as SessionUser).id)
        )
          return;
        this.sql.exec(
          "UPDATE regional_sessions SET user_json = ?, lease_until = ?, actor_id = ? WHERE token_hash = ? AND grant = ? AND generation = ?",
          JSON.stringify(lease.user),
          lease.expiresAt,
          lease.user.switchedFrom?.id ?? lease.user.id,
          row.token_hash,
          row.grant,
          row.generation,
        );
      }),
    );
    await this.schedule();
  }
}

function operationResult(
  body: Record<string, unknown> | null,
): { status: number; body: unknown } | null {
  const result = body?.result as
    { status?: unknown; body?: unknown } | undefined;
  return result &&
    typeof result.status === "number" &&
    Number.isInteger(result.status) &&
    result.status >= 200 &&
    result.status <= 599 &&
    !(result.status >= 300 && result.status < 400) &&
    result.body
    ? { status: result.status, body: result.body }
    : null;
}

/** Only a local page can be resumed; authority/API URLs are never continuations. */
function returnPath(value: string | null, origin: string): string {
  if (
    !value ||
    value.length > 2048 ||
    !value.startsWith("/") ||
    value.startsWith("//")
  )
    return "/";
  try {
    const target = new URL(value, origin);
    if (target.origin !== origin || target.pathname.startsWith("/api/"))
      return "/";
    return target.pathname + target.search + target.hash;
  } catch {
    return "/";
  }
}
