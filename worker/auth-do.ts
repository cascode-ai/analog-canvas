// Gallery accounts and sign-in (roadmap phase G2), dark-shipped.
//
// One AuthDO singleton owns users and sessions behind `/api/auth/*`:
// GitHub OAuth, Google OAuth, and email magic links — any one credential
// signs a user in, no passwords ever exist. Each provider stays invisible
// until its secrets are configured. The browser holds a random session
// token in an HttpOnly cookie; the database stores only SHA-256 hashes of
// session and login tokens, so a copied database cannot impersonate
// anyone. Super-admin is computed per request from the union of the
// `ADMIN_EMAILS` and additive `ADMIN_EMAILS_EXTRA` secrets
// (comma-separated, case-insensitive) — rotating either needs no re-login.
// Provider HTTP calls go through an injectable fetch seam so
// tests never touch the network.

export const AUTH_SESSION_COOKIE = "icm_session";
export const AUTH_STATE_COOKIE = "icm_oauth_state";
export const AUTH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const AUTH_LOGIN_TOKEN_TTL_MS = 15 * 60 * 1000;
export const AUTH_EMAIL_DAILY_LIMIT = 5;
export const AUTH_DISPLAY_NAME_MAX = 40;

const TOKENZHANG_DISPLAY_NAME_MIGRATION =
  "2026-08-26-tokenzhang-to-zhishuai-zhang";
const TOKENZHANG_DISPLAY_NAME = "Zhishuai Zhang";
const MAGIC_LI_DISPLAY_NAME_MIGRATION = "2026-09-19-gallery-owner-to-magic-li";
const MAGIC_LI_USER_ID = "2cf8ed78-a15d-4a24-8020-74dca560a897";
const MAGIC_LI_DISPLAY_NAME = "Magic Li";

type SqlResult<T> = {
  toArray(): T[];
  one(): T;
};

type SqlStorage = {
  exec<T>(query: string, ...bindings: unknown[]): SqlResult<T>;
};

type DurableObjectStateLike = {
  storage: {
    sql: SqlStorage;
    transactionSync<T>(callback: () => T): T;
  };
};

export type AuthNamespaceLike = {
  getByName(name: string): {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  };
};

export type GalleryBylineNamespaceLike = {
  getByName(name: string): {
    fetch(input: Request | string, init?: RequestInit): Promise<Response>;
  };
};

export type AuthEnv = {
  AUTH: AuthNamespaceLike;
  /** Present in the deployed Worker; omitted only by isolated Auth tests. */
  GALLERY?: GalleryBylineNamespaceLike;
  GH_OAUTH_CLIENT_ID?: string;
  GH_OAUTH_CLIENT_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  RESEND_API_KEY?: string;
  AUTH_EMAIL_FROM?: string;
  ADMIN_EMAILS?: string;
  ADMIN_EMAILS_EXTRA?: string;
};

export interface SessionUser {
  id: string;
  displayName: string;
  email: string | null;
  provider: string;
  /** "user" or "moderator" (appointed by the super-admin). */
  role: string;
  isAdmin: boolean;
}

interface UserRow {
  id: string;
  provider: string;
  provider_id: string;
  email: string | null;
  display_name: string;
  role: string;
  created_at: string;
}

function enabledProviders(env: AuthEnv): {
  github: boolean;
  google: boolean;
  email: boolean;
} {
  return {
    github: Boolean(env.GH_OAUTH_CLIENT_ID && env.GH_OAUTH_CLIENT_SECRET),
    google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
    email: Boolean(env.RESEND_API_KEY),
  };
}

function adminEmails(env: AuthEnv): string[] {
  return [env.ADMIN_EMAILS, env.ADMIN_EMAILS_EXTRA]
    .filter((value): value is string => typeof value === "string")
    .join(",")
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter((email) => email.length > 0);
}

function parseCookies(header: string | null): Record<string, string> {
  const cookies: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    cookies[part.slice(0, eq).trim()] = part.slice(eq + 1).trim();
  }
  return cookies;
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function sessionCookie(token: string, secure: boolean, maxAge: number): string {
  return (
    `${AUTH_SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${maxAge}${secure ? "; Secure" : ""}`
  );
}

function stateCookie(value: string, secure: boolean, maxAge: number): string {
  return (
    `${AUTH_STATE_COOKIE}=${value}; Path=/api/auth; HttpOnly; ` +
    `SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`
  );
}

// Same policy as the gallery's POST gate (duplicated to keep this module
// free of the gallery's rendering imports): the browser's own metadata
// must not contradict a same-origin request.
function sameOrigin(request: Request): boolean {
  const expected = new URL(request.url).origin;
  const origin = request.headers.get("Origin");
  const fetchSite = request.headers.get("Sec-Fetch-Site");
  if (origin && origin !== expected) return false;
  if (fetchSite && !["same-origin", "same-site", "none"].includes(fetchSite)) {
    return false;
  }
  return true;
}

function normalizedEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (email.length === 0 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function failedRedirect(origin: string, secure: boolean): Response {
  const response = redirect(`${origin}/?auth=failed`);
  response.headers.append("Set-Cookie", stateCookie("", secure, 0));
  return response;
}

function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { location } });
}

function noStoreJson(payload: unknown, status = 200): Response {
  return Response.json(payload, {
    status,
    headers: { "cache-control": "no-store" },
  });
}

/**
 * Users, sessions, and the whole `/api/auth/*` surface. The worker entry
 * forwards those requests verbatim; `/internal/session-user` is the one
 * operation other modules (the gallery) call through the binding, and it
 * is never reachable publicly because only `/api/auth/*` is forwarded.
 */
export class AuthDO {
  private readonly sql: SqlStorage;
  /**
   * Provider/network seam; tests replace it. The arrow wrapper is
   * load-bearing: assigning the global `fetch` itself and invoking it as
   * `this.fetchLike(...)` rebinds `this` to the DO instance, which the
   * Workers runtime rejects with "Illegal invocation" (Node's fetch does
   * not care, so unit tests cannot catch the unwrapped form).
   */
  fetchLike: typeof fetch = (input, init) => fetch(input, init);
  /** Clock seam; tests replace it. */
  now: () => Date = () => new Date();

  constructor(
    state: DurableObjectStateLike,
    private readonly env: AuthEnv,
  ) {
    this.sql = state.storage.sql;
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        provider TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        email TEXT,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        created_at TEXT NOT NULL,
        UNIQUE (provider, provider_id)
      ) WITHOUT ROWID
    `);
    try {
      // Additive upgrade for databases created before roles existed.
      this.sql.exec(
        "ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'",
      );
    } catch {
      // Column already present.
    }
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS data_migrations (
        id TEXT PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    state.storage.transactionSync(() => {
      const applied = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM data_migrations WHERE id = ?",
          TOKENZHANG_DISPLAY_NAME_MIGRATION,
        )
        .toArray();
      if (applied.length > 0) return;
      // One production account was initially named from its GitHub login.
      // Change only that legacy spelling; the marker preserves any later
      // display-name choice made by the account holder.
      this.sql.exec(
        `UPDATE users SET display_name = ?
         WHERE LOWER(REPLACE(TRIM(display_name), ' ', '')) = 'tokenzhang'`,
        TOKENZHANG_DISPLAY_NAME,
      );
      this.sql.exec(
        "INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)",
        TOKENZHANG_DISPLAY_NAME_MIGRATION,
        new Date().toISOString(),
      );
    });
    state.storage.transactionSync(() => {
      const applied = this.sql
        .exec<{ id: string }>(
          "SELECT id FROM data_migrations WHERE id = ?",
          MAGIC_LI_DISPLAY_NAME_MIGRATION,
        )
        .toArray();
      if (applied.length > 0) return;
      // This identity owns the legacy Gallery byline migrated alongside this
      // account change. Updating the account keeps future submissions under
      // the same public name; the marker preserves later profile choices.
      this.sql.exec(
        "UPDATE users SET display_name = ? WHERE id = ?",
        MAGIC_LI_DISPLAY_NAME,
        MAGIC_LI_USER_ID,
      );
      this.sql.exec(
        "INSERT INTO data_migrations(id, applied_at) VALUES (?, ?)",
        MAGIC_LI_DISPLAY_NAME_MIGRATION,
        new Date().toISOString(),
      );
    });
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS login_tokens (
        token_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL
      ) WITHOUT ROWID
    `);
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS login_rates (
        day TEXT NOT NULL,
        email_hash TEXT NOT NULL,
        count INTEGER NOT NULL,
        PRIMARY KEY (day, email_hash)
      ) WITHOUT ROWID
    `);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/internal/session-user") {
      return noStoreJson({ user: await this.sessionUser(request) });
    }
    if (!url.pathname.startsWith("/api/auth/")) {
      return Response.json({ error: "not-found" }, { status: 404 });
    }
    const route = url.pathname.slice("/api/auth/".length).replace(/\/+$/u, "");
    const method = request.method;
    if (route === "providers" && method === "GET") {
      return noStoreJson(enabledProviders(this.env));
    }
    if (route === "me" && method === "GET") {
      return noStoreJson({ user: await this.sessionUser(request) });
    }
    if (route === "github/start" && method === "GET") {
      return this.oauthStart(url, "github");
    }
    if (route === "github/callback" && method === "GET") {
      return this.githubCallback(request, url);
    }
    if (route === "google/start" && method === "GET") {
      return this.oauthStart(url, "google");
    }
    if (route === "google/callback" && method === "GET") {
      return this.googleCallback(request, url);
    }
    if (route === "email/start" && method === "POST") {
      return this.emailStart(request, url);
    }
    if (route === "email/callback" && method === "GET") {
      return this.emailCallback(url);
    }
    if (route === "logout" && method === "POST") {
      return this.logout(request, url);
    }
    if (route === "profile" && method === "POST") {
      return this.renameProfile(request);
    }
    if (route === "users/role" && method === "POST") {
      return this.setRole(request);
    }
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  // --- sessions ---------------------------------------------------------

  private async sessionUser(request: Request): Promise<SessionUser | null> {
    const token = parseCookies(request.headers.get("Cookie"))[
      AUTH_SESSION_COOKIE
    ];
    if (!token) return null;
    const tokenHash = await sha256(token);
    const row = this.sql
      .exec<UserRow & { expires_at: string }>(
        `SELECT users.*, sessions.expires_at FROM sessions
         JOIN users ON users.id = sessions.user_id
         WHERE sessions.token_hash = ?`,
        tokenHash,
      )
      .toArray()[0];
    if (!row) return null;
    if (row.expires_at <= this.now().toISOString()) {
      this.sql.exec("DELETE FROM sessions WHERE token_hash = ?", tokenHash);
      return null;
    }
    return this.publicUser(row);
  }

  private publicUser(row: UserRow): SessionUser {
    return {
      id: row.id,
      displayName: row.display_name,
      email: row.email,
      provider: row.provider,
      role: row.role ?? "user",
      isAdmin:
        row.email !== null &&
        adminEmails(this.env).includes(row.email.toLowerCase()),
    };
  }

  private async createSession(userId: string): Promise<string> {
    const token = randomToken();
    const now = this.now();
    this.sql.exec(
      "DELETE FROM sessions WHERE expires_at <= ?",
      now.toISOString(),
    );
    this.sql.exec(
      "INSERT INTO sessions(token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)",
      await sha256(token),
      userId,
      now.toISOString(),
      new Date(now.getTime() + AUTH_SESSION_TTL_SECONDS * 1000).toISOString(),
    );
    return token;
  }

  private upsertUser(
    provider: string,
    providerId: string,
    email: string | null,
    defaultDisplayName: string,
  ): UserRow {
    const existing = this.sql
      .exec<UserRow>(
        "SELECT * FROM users WHERE provider = ? AND provider_id = ?",
        provider,
        providerId,
      )
      .toArray()[0];
    if (existing) {
      // The verified email may change at the provider; the display name
      // belongs to the user once created and is never overwritten here.
      if (existing.email !== email) {
        this.sql.exec(
          "UPDATE users SET email = ? WHERE id = ?",
          email,
          existing.id,
        );
        existing.email = email;
      }
      return existing;
    }
    const row: UserRow = {
      id: crypto.randomUUID(),
      provider,
      provider_id: providerId,
      email,
      display_name:
        defaultDisplayName.trim().slice(0, AUTH_DISPLAY_NAME_MAX) || "Someone",
      role: "user",
      created_at: this.now().toISOString(),
    };
    this.sql.exec(
      "INSERT INTO users(id, provider, provider_id, email, display_name, role, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      row.id,
      row.provider,
      row.provider_id,
      row.email,
      row.display_name,
      row.role,
      row.created_at,
    );
    return row;
  }

  private async signedInRedirect(
    url: URL,
    user: UserRow,
    clearState: boolean,
  ): Promise<Response> {
    const secure = url.protocol === "https:";
    const token = await this.createSession(user.id);
    const response = redirect(`${url.origin}/`);
    response.headers.append(
      "Set-Cookie",
      sessionCookie(token, secure, AUTH_SESSION_TTL_SECONDS),
    );
    if (clearState) {
      response.headers.append("Set-Cookie", stateCookie("", secure, 0));
    }
    return response;
  }

  // --- OAuth (GitHub, Google) ------------------------------------------

  private oauthStart(url: URL, provider: "github" | "google"): Response {
    if (!enabledProviders(this.env)[provider]) {
      return Response.json({ error: "provider-disabled" }, { status: 404 });
    }
    const state = randomToken();
    const redirectUri = `${url.origin}/api/auth/${provider}/callback`;
    const authorizeUrl =
      provider === "github"
        ? "https://github.com/login/oauth/authorize?" +
          new URLSearchParams({
            client_id: this.env.GH_OAUTH_CLIENT_ID ?? "",
            redirect_uri: redirectUri,
            scope: "read:user user:email",
            state,
          }).toString()
        : "https://accounts.google.com/o/oauth2/v2/auth?" +
          new URLSearchParams({
            client_id: this.env.GOOGLE_CLIENT_ID ?? "",
            redirect_uri: redirectUri,
            response_type: "code",
            scope: "openid email profile",
            prompt: "select_account",
            state,
          }).toString();
    const response = redirect(authorizeUrl);
    response.headers.append(
      "Set-Cookie",
      stateCookie(state, url.protocol === "https:", 600),
    );
    return response;
  }

  private oauthCallbackInputs(
    request: Request,
    url: URL,
  ): { code: string } | null {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const cookieState = parseCookies(request.headers.get("Cookie"))[
      AUTH_STATE_COOKIE
    ];
    if (!state || !code || !cookieState || state !== cookieState) return null;
    return { code };
  }

  private async githubCallback(request: Request, url: URL): Promise<Response> {
    const secure = url.protocol === "https:";
    if (!enabledProviders(this.env).github) {
      return Response.json({ error: "provider-disabled" }, { status: 404 });
    }
    const inputs = this.oauthCallbackInputs(request, url);
    if (!inputs) return failedRedirect(url.origin, secure);
    try {
      // Form-encoded on purpose: it is the exchange format GitHub's OAuth
      // documentation guarantees.
      const tokenResponse = await this.fetchLike(
        "https://github.com/login/oauth/access_token",
        {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/x-www-form-urlencoded",
          },
          body: new URLSearchParams({
            client_id: this.env.GH_OAUTH_CLIENT_ID ?? "",
            client_secret: this.env.GH_OAUTH_CLIENT_SECRET ?? "",
            code: inputs.code,
            redirect_uri: `${url.origin}/api/auth/github/callback`,
          }).toString(),
        },
      );
      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!tokenResponse.ok || !tokenPayload.access_token) {
        return failedRedirect(url.origin, secure);
      }
      const apiHeaders = {
        authorization: `Bearer ${tokenPayload.access_token}`,
        accept: "application/vnd.github+json",
        "user-agent": "analog-canvas-worker",
      };
      const profileResponse = await this.fetchLike(
        "https://api.github.com/user",
        { headers: apiHeaders },
      );
      if (!profileResponse.ok) return failedRedirect(url.origin, secure);
      const profile = (await profileResponse.json()) as {
        id?: number;
        login?: string;
        name?: string | null;
      };
      if (profile.id === undefined || !profile.login) {
        return failedRedirect(url.origin, secure);
      }
      const emailsResponse = await this.fetchLike(
        "https://api.github.com/user/emails",
        { headers: apiHeaders },
      );
      const emails = emailsResponse.ok
        ? ((await emailsResponse.json()) as {
            email?: string;
            primary?: boolean;
            verified?: boolean;
          }[])
        : [];
      const verified = emails.filter((entry) => entry.verified);
      const email = normalizedEmail(
        (verified.find((entry) => entry.primary) ?? verified[0])?.email,
      );
      const user = this.upsertUser(
        "github",
        String(profile.id),
        email,
        profile.name?.trim() || profile.login,
      );
      return this.signedInRedirect(url, user, true);
    } catch {
      return failedRedirect(url.origin, secure);
    }
  }

  private async googleCallback(request: Request, url: URL): Promise<Response> {
    const secure = url.protocol === "https:";
    if (!enabledProviders(this.env).google) {
      return Response.json({ error: "provider-disabled" }, { status: 404 });
    }
    const inputs = this.oauthCallbackInputs(request, url);
    if (!inputs) return failedRedirect(url.origin, secure);
    try {
      const tokenResponse = await this.fetchLike(
        "https://oauth2.googleapis.com/token",
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            code: inputs.code,
            client_id: this.env.GOOGLE_CLIENT_ID ?? "",
            client_secret: this.env.GOOGLE_CLIENT_SECRET ?? "",
            redirect_uri: `${url.origin}/api/auth/google/callback`,
            grant_type: "authorization_code",
          }).toString(),
        },
      );
      const tokenPayload = (await tokenResponse.json()) as {
        access_token?: string;
      };
      if (!tokenResponse.ok || !tokenPayload.access_token) {
        return failedRedirect(url.origin, secure);
      }
      const profileResponse = await this.fetchLike(
        "https://openidconnect.googleapis.com/v1/userinfo",
        {
          headers: { authorization: `Bearer ${tokenPayload.access_token}` },
        },
      );
      if (!profileResponse.ok) return failedRedirect(url.origin, secure);
      const profile = (await profileResponse.json()) as {
        sub?: string;
        email?: string;
        email_verified?: boolean;
        name?: string;
      };
      if (!profile.sub) return failedRedirect(url.origin, secure);
      const email = profile.email_verified
        ? normalizedEmail(profile.email)
        : null;
      const user = this.upsertUser(
        "google",
        profile.sub,
        email,
        profile.name?.trim() || email?.split("@")[0] || "Google user",
      );
      return this.signedInRedirect(url, user, true);
    } catch {
      return failedRedirect(url.origin, secure);
    }
  }

  // --- email magic links ------------------------------------------------

  private async emailStart(request: Request, url: URL): Promise<Response> {
    if (!enabledProviders(this.env).email) {
      return Response.json({ error: "provider-disabled" }, { status: 404 });
    }
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as {
      email?: unknown;
    } | null;
    const email = normalizedEmail(body?.email);
    if (!email) {
      return Response.json({ error: "invalid-email" }, { status: 400 });
    }
    const now = this.now();
    const day = now.toISOString().slice(0, 10);
    const emailHash = await sha256(`login:${email}`);
    const used =
      this.sql
        .exec<{ count: number }>(
          "SELECT count FROM login_rates WHERE day = ? AND email_hash = ?",
          day,
          emailHash,
        )
        .toArray()[0]?.count ?? 0;
    if (used >= AUTH_EMAIL_DAILY_LIMIT) {
      return Response.json({ error: "rate-limited" }, { status: 429 });
    }
    this.sql.exec(
      `INSERT INTO login_rates(day, email_hash, count) VALUES (?, ?, 1)
       ON CONFLICT(day, email_hash) DO UPDATE SET count = count + 1`,
      day,
      emailHash,
    );
    const token = randomToken();
    this.sql.exec(
      "DELETE FROM login_tokens WHERE expires_at <= ?",
      now.toISOString(),
    );
    this.sql.exec(
      "INSERT INTO login_tokens(token_hash, email, created_at, expires_at) VALUES (?, ?, ?, ?)",
      await sha256(token),
      email,
      now.toISOString(),
      new Date(now.getTime() + AUTH_LOGIN_TOKEN_TTL_MS).toISOString(),
    );
    const link = `${url.origin}/api/auth/email/callback?token=${token}`;
    try {
      const sendResponse = await this.fetchLike(
        "https://api.resend.com/emails",
        {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.env.RESEND_API_KEY}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            from:
              this.env.AUTH_EMAIL_FROM ??
              "Analog Canvas <onboarding@resend.dev>",
            to: [email],
            subject: "Sign in to Analog Canvas",
            text:
              `Follow this link to sign in to Analog Canvas:\n\n${link}\n\n` +
              "The link works once and expires in 15 minutes. If you did " +
              "not request it, ignore this email.",
          }),
        },
      );
      if (!sendResponse.ok) {
        return Response.json({ error: "send-failed" }, { status: 502 });
      }
    } catch {
      return Response.json({ error: "send-failed" }, { status: 502 });
    }
    return Response.json({ sent: true }, { status: 202 });
  }

  private async emailCallback(url: URL): Promise<Response> {
    const secure = url.protocol === "https:";
    const token = url.searchParams.get("token");
    if (!token) return failedRedirect(url.origin, secure);
    const tokenHash = await sha256(token);
    const row = this.sql
      .exec<{ email: string; expires_at: string }>(
        "SELECT email, expires_at FROM login_tokens WHERE token_hash = ?",
        tokenHash,
      )
      .toArray()[0];
    // Single use: the token disappears whether or not it was still valid.
    this.sql.exec("DELETE FROM login_tokens WHERE token_hash = ?", tokenHash);
    if (!row || row.expires_at <= this.now().toISOString()) {
      return failedRedirect(url.origin, secure);
    }
    const user = this.upsertUser(
      "email",
      row.email,
      row.email,
      row.email.split("@")[0] ?? row.email,
    );
    return this.signedInRedirect(url, user, false);
  }

  // --- account management ----------------------------------------------

  private async logout(request: Request, url: URL): Promise<Response> {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const token = parseCookies(request.headers.get("Cookie"))[
      AUTH_SESSION_COOKIE
    ];
    if (token) {
      this.sql.exec(
        "DELETE FROM sessions WHERE token_hash = ?",
        await sha256(token),
      );
    }
    const response = noStoreJson({ ok: true });
    response.headers.append(
      "Set-Cookie",
      sessionCookie("", url.protocol === "https:", 0),
    );
    return response;
  }

  private async renameProfile(request: Request): Promise<Response> {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const user = await this.sessionUser(request);
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      displayName?: unknown;
    } | null;
    const displayName =
      typeof body?.displayName === "string" ? body.displayName.trim() : "";
    if (
      displayName.length === 0 ||
      displayName.length > AUTH_DISPLAY_NAME_MAX
    ) {
      return Response.json({ error: "invalid-display-name" }, { status: 400 });
    }
    if (this.env.GALLERY) {
      try {
        const galleryResponse = await this.env.GALLERY.getByName(
          "gallery",
        ).fetch("https://gallery/rename-owner", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ ownerUserId: user.id, displayName }),
        });
        if (!galleryResponse.ok) {
          return noStoreJson({ error: "gallery-byline-sync-failed" }, 503);
        }
      } catch {
        return noStoreJson({ error: "gallery-byline-sync-failed" }, 503);
      }
    }
    // Gallery moves first. If it is unavailable the profile stays unchanged;
    // retrying is safe because the Gallery operation is idempotent.
    this.sql.exec(
      "UPDATE users SET display_name = ? WHERE id = ?",
      displayName,
      user.id,
    );
    return noStoreJson({ user: { ...user, displayName } });
  }

  /**
   * Super-admin appoints (or revokes) moderators by email; the role
   * applies to every account carrying that verified email, so it covers
   * a person's GitHub, Google, and email identities at once.
   */
  private async setRole(request: Request): Promise<Response> {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const caller = await this.sessionUser(request);
    if (!caller?.isAdmin) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      email?: unknown;
      role?: unknown;
    } | null;
    const email = normalizedEmail(body?.email);
    const role = body?.role;
    if (!email || (role !== "user" && role !== "moderator")) {
      return Response.json({ error: "invalid-fields" }, { status: 400 });
    }
    const targets = this.sql
      .exec<UserRow>("SELECT * FROM users WHERE lower(email) = ?", email)
      .toArray();
    if (targets.length === 0) {
      return Response.json({ error: "no-such-user" }, { status: 404 });
    }
    this.sql.exec(
      "UPDATE users SET role = ? WHERE lower(email) = ?",
      role,
      email,
    );
    return noStoreJson({ updated: targets.length, role });
  }
}
