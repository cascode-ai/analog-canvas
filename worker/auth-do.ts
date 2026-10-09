// Gallery accounts and sign-in (roadmap phase G2), dark-shipped.
//
// One AuthDO singleton owns users and sessions behind `/api/auth/*`:
// GitHub OAuth, Google OAuth, and emailed sign-in codes — any one credential
// signs a user in, no passwords ever exist. AI accounts ("seats", listed in
// AI_SEATS) are the super-admin's, for Agents to publish under: they have
// no email or identity of their own, and only a signed-in super-admin
// switches a browser to one. Each provider stays invisible
// until its secrets are configured. The browser holds a random session
// token in an HttpOnly cookie; the database stores only SHA-256 hashes of
// session tokens and sign-in codes, so a copied database cannot impersonate
// anyone. Super-admin is computed per request from the union of the
// `ADMIN_EMAILS` and additive `ADMIN_EMAILS_EXTRA` secrets
// (comma-separated, case-insensitive) — rotating either needs no re-login.
// Provider HTTP calls go through an injectable fetch seam so
// tests never touch the network.

export const AUTH_SESSION_COOKIE = "icm_session";
export const AUTH_STATE_COOKIE = "icm_oauth_state";
export const AUTH_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
/** How long an emailed sign-in code works. */
const AUTH_LOGIN_CODE_TTL_MS = 10 * 60 * 1000;
/** Wrong guesses one code takes before it stops working. */
export const AUTH_LOGIN_CODE_ATTEMPTS = 5;
export const AUTH_EMAIL_DAILY_LIMIT = 5;
export const AUTH_DISPLAY_NAME_MAX = 40;
/** The provider of AI accounts, which nothing signs in to directly. */
export const AI_ACCOUNT_PROVIDER = "ai";
/**
 * The AI accounts. Each is made the first time AuthDO starts with it here,
 * or, for an account an Agent already published under, converted in place:
 * its id, sessions and Gallery entries stay, and the email and provider
 * identity it held are released to their owner. Its display name is the
 * model's official name, kept here: AuthDO and GalleryDO restore it, byline
 * included, whenever they start. A new seat is a new line; seats are never
 * renumbered or reused.
 */
export const AI_SEATS: readonly {
  seat: string;
  userId: string;
  displayName: string;
  /** The name an Agent's account published under before it became one. */
  formerName?: string;
}[] = [
  // Published through a person's Google identity until now.
  {
    seat: "ai-designer-1",
    userId: "b183aa15-078d-4476-be33-93c34f4bd95c",
    displayName: "Claude Opus 5.5",
    formerName: "Opus 5.5",
  },
  // Published through a person's email identity until now.
  {
    seat: "ai-designer-2",
    userId: "f7f7789a-47df-4cd3-a384-232381f36c64",
    displayName: "GPT-6 Astra",
    formerName: "GPT-6-Astra",
  },
  // New on 2026-10-08; it had been publishing through GPT-6 Astra's account.
  {
    seat: "ai-designer-3",
    userId: "6ac307cd-655d-4f06-bf8d-bc5975ebf6a6",
    displayName: "GPT-6.1 Sol",
  },
];
/**
 * The site's Owner, by account: the Google and the GitHub sign-in (#1446).
 * Only these open the account page's Data tab and the numbers behind it;
 * other administrators do not, nor does an AI account a browser was
 * switched to. Listed by account ID, never by address.
 */
export const OWNER_ACCOUNT_IDS: readonly string[] = [
  "01933810-6668-4d6b-86cd-62f91a5b1686", // Google
  "60334273-e419-4469-a756-7a557af16029", // GitHub
];
/** The super-admin's own session, kept while the browser is an AI account. */
const AUTH_OWNER_COOKIE = "icm_owner_session";

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
  /** The shared component library, which account deletion also clears. */
  COMPONENT_LIBRARY?: GalleryBylineNamespaceLike;
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
  /** An AI account's seat, such as ai-designer-1. */
  seat?: string;
  /** One of the Owner's own accounts (OWNER_ACCOUNT_IDS). */
  isOwner?: true;
  /**
   * The super-admin who switched this browser to the AI account it is
   * signed in as, and can switch it back (`/api/auth/me` only).
   */
  switchedFrom?: { displayName: string };
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

/** Six random digits, every code equally likely (rejection sampling). */
function randomCode(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  const value = new Uint32Array(1);
  do crypto.getRandomValues(value);
  while (value[0]! >= limit);
  return String(value[0]! % 1_000_000).padStart(6, "0");
}

/** Equal-length hex digests compared without an early exit. */
function sameDigest(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1)
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  return difference === 0;
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

/** The super-admin's session kept while switched; only auth routes see it. */
function ownerCookie(token: string, secure: boolean, maxAge: number): string {
  return (
    `${AUTH_OWNER_COOKIE}=${token}; Path=/api/auth; HttpOnly; SameSite=Lax; ` +
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

/**
 * Where a GitHub or Google sign-in comes back to: a page of AnalogArena
 * (/arena or below it, on this origin) when it asked for one, and `/` for
 * anything else, as before (docs/specs/analog-arena.md#sign-in-return).
 */
function signInReturnPath(requested: string | null, origin: string): string {
  if (!requested?.startsWith("/")) return "/";
  let url: URL;
  try {
    url = new URL(requested, origin);
  } catch {
    return "/";
  }
  const arena = url.pathname === "/arena" || url.pathname.startsWith("/arena/");
  return url.origin === origin && arena ? url.pathname + url.search : "/";
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
    // Emailed links gave way to codes typed into the asking browser; the
    // links' short-lived tokens have no further use.
    this.sql.exec("DROP TABLE IF EXISTS login_tokens");
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS login_codes (
        email TEXT PRIMARY KEY,
        code_hash TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        attempts INTEGER NOT NULL
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
    this.ensureAiSeats(state);
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
      return noStoreJson({ user: await this.me(request) });
    }
    if (route === "admin/stats" && method === "GET") {
      const caller = await this.superAdmin(request);
      if (caller instanceof Response) return caller;
      const row = this.sql
        // People's accounts; the AI accounts are the super-admin's own.
        .exec<{ registeredAccounts: number }>(
          "SELECT COUNT(*) AS registeredAccounts FROM users WHERE provider <> ?",
          AI_ACCOUNT_PROVIDER,
        )
        .one();
      return noStoreJson({
        registeredAccounts: Number(row.registeredAccounts),
      });
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
      return this.emailStart(request);
    }
    if (route === "email/verify" && method === "POST") {
      return this.emailVerify(request, url);
    }
    if (route === "logout" && method === "POST") {
      return this.logout(request, url);
    }
    if (route === "profile" && method === "POST") {
      return this.renameProfile(request);
    }
    if (route === "account/delete" && method === "POST") {
      return this.deleteAccount(request, url);
    }
    if (route === "users/role" && method === "POST") {
      return this.setRole(request);
    }
    if (route === "ai-accounts" && method === "GET") {
      return this.listAiAccounts(request);
    }
    if (route === "ai-accounts/switch" && method === "POST") {
      return this.switchToAiAccount(request, url);
    }
    if (route === "ai-accounts/return" && method === "POST") {
      return this.returnToOwner(request, url);
    }
    return Response.json({ error: "not-found" }, { status: 404 });
  }

  // --- sessions ---------------------------------------------------------

  private async sessionUser(request: Request): Promise<SessionUser | null> {
    return this.tokenUser(
      parseCookies(request.headers.get("Cookie"))[AUTH_SESSION_COOKIE],
    );
  }

  /** Ends the session a token names, if any. */
  private async endSession(token: string | undefined): Promise<void> {
    if (token)
      this.sql.exec(
        "DELETE FROM sessions WHERE token_hash = ?",
        await sha256(token),
      );
  }

  /** The user a live session token belongs to; an expired one is removed. */
  private async tokenUser(
    token: string | undefined,
  ): Promise<SessionUser | null> {
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
      ...(row.provider === AI_ACCOUNT_PROVIDER
        ? { seat: row.provider_id }
        : {}),
      ...(OWNER_ACCOUNT_IDS.includes(row.id) ? { isOwner: true as const } : {}),
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
    returnPath = "/",
  ): Promise<Response> {
    const secure = url.protocol === "https:";
    const token = await this.createSession(user.id);
    const response = redirect(`${url.origin}${returnPath}`);
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
    // The state is the random token, and after a dot the return path, so
    // the provider hands it back with the code; the state cookie holds the
    // same value, which is what makes the path ours.
    const returnPath = signInReturnPath(
      url.searchParams.get("return"),
      url.origin,
    );
    const state =
      randomToken() +
      (returnPath === "/" ? "" : `.${encodeURIComponent(returnPath)}`);
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
  ): { code: string; returnPath: string } | null {
    const state = url.searchParams.get("state");
    const code = url.searchParams.get("code");
    const cookieState = parseCookies(request.headers.get("Cookie"))[
      AUTH_STATE_COOKIE
    ];
    if (!state || !code || !cookieState || state !== cookieState) return null;
    const dot = state.indexOf(".");
    let requested: string | null = null;
    try {
      if (dot >= 0) requested = decodeURIComponent(state.slice(dot + 1));
    } catch {
      // A malformed path returns to `/`, as one never asked for.
    }
    return { code, returnPath: signInReturnPath(requested, url.origin) };
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
      return this.signedInRedirect(url, user, true, inputs.returnPath);
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
      return this.signedInRedirect(url, user, true, inputs.returnPath);
    } catch {
      return failedRedirect(url.origin, secure);
    }
  }

  // --- emailed sign-in codes --------------------------------------------

  private async emailStart(request: Request): Promise<Response> {
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
    // The limit is per day; earlier days' counts serve no purpose.
    this.sql.exec("DELETE FROM login_rates WHERE day < ?", day);
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
    const code = randomCode();
    this.sql.exec(
      "DELETE FROM login_codes WHERE expires_at <= ?",
      now.toISOString(),
    );
    // One code per address: asking again replaces the one before, and its
    // wrong guesses with it.
    this.sql.exec(
      `INSERT INTO login_codes(email, code_hash, expires_at, attempts)
       VALUES (?, ?, ?, 0)
       ON CONFLICT(email) DO UPDATE SET code_hash = excluded.code_hash,
         expires_at = excluded.expires_at, attempts = 0`,
      email,
      await sha256(`code:${email}:${code}`),
      new Date(now.getTime() + AUTH_LOGIN_CODE_TTL_MS).toISOString(),
    );
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
            subject: `${code} is your Analog Canvas sign-in code`,
            text:
              `Your Analog Canvas sign-in code is:\n\n${code}\n\n` +
              "Type it into the page where you asked to sign in. It works " +
              "once and expires in 10 minutes. If you did not ask to sign " +
              "in, ignore this email.",
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

  /**
   * Signs in the browser that types the emailed code, whichever browser the
   * email was read in. A code works once; a wrong guess counts against it,
   * and after AUTH_LOGIN_CODE_ATTEMPTS it stops working, so guessing six
   * digits is bounded by the daily sending limit.
   */
  private async emailVerify(request: Request, url: URL): Promise<Response> {
    if (!enabledProviders(this.env).email) {
      return Response.json({ error: "provider-disabled" }, { status: 404 });
    }
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const body = (await request.json().catch(() => null)) as {
      email?: unknown;
      code?: unknown;
    } | null;
    const email = normalizedEmail(body?.email);
    // People paste codes with spaces or a dash in the middle.
    const code =
      typeof body?.code === "string" ? body.code.replace(/[\s-]/gu, "") : "";
    if (!email || !/^\d{6}$/u.test(code)) {
      return noStoreJson({ error: "invalid-code" }, 400);
    }
    const row = this.sql
      .exec<{ code_hash: string; expires_at: string; attempts: number }>(
        "SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?",
        email,
      )
      .toArray()[0];
    if (!row || row.expires_at <= this.now().toISOString()) {
      this.sql.exec("DELETE FROM login_codes WHERE email = ?", email);
      return noStoreJson({ error: "expired-code" }, 400);
    }
    if (!sameDigest(await sha256(`code:${email}:${code}`), row.code_hash)) {
      const attempts = Number(row.attempts) + 1;
      if (attempts >= AUTH_LOGIN_CODE_ATTEMPTS) {
        this.sql.exec("DELETE FROM login_codes WHERE email = ?", email);
        return noStoreJson({ error: "too-many-attempts" }, 429);
      }
      this.sql.exec(
        "UPDATE login_codes SET attempts = ? WHERE email = ?",
        attempts,
        email,
      );
      return noStoreJson(
        {
          error: "invalid-code",
          attemptsLeft: AUTH_LOGIN_CODE_ATTEMPTS - attempts,
        },
        400,
      );
    }
    this.sql.exec("DELETE FROM login_codes WHERE email = ?", email);
    const user = this.upsertUser(
      "email",
      email,
      email,
      email.split("@")[0] ?? email,
    );
    const token = await this.createSession(user.id);
    const response = noStoreJson({ signedIn: true });
    response.headers.append(
      "Set-Cookie",
      sessionCookie(token, url.protocol === "https:", AUTH_SESSION_TTL_SECONDS),
    );
    return response;
  }

  // --- account management ----------------------------------------------

  private async logout(request: Request, url: URL): Promise<Response> {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    // Signing out signs the whole browser out: an AI account's session and
    // the super-admin's kept beside it.
    const cookies = parseCookies(request.headers.get("Cookie"));
    await this.endSession(cookies[AUTH_SESSION_COOKIE]);
    await this.endSession(cookies[AUTH_OWNER_COOKIE]);
    const secure = url.protocol === "https:";
    const response = noStoreJson({ ok: true });
    response.headers.append("Set-Cookie", sessionCookie("", secure, 0));
    if (cookies[AUTH_OWNER_COOKIE])
      response.headers.append("Set-Cookie", ownerCookie("", secure, 0));
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
    // An AI account's name is the model's, kept in AI_SEATS.
    if (user.seat) return noStoreJson({ error: "ai-account" }, 409);
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
   * Delete the signed-in account and everything kept for it. The Gallery
   * (published circuits, likes, Cloud Projects) and the shared component
   * library go first and the account last: if a step fails, the person is
   * still signed in to try again, and every step is safe to repeat.
   */
  private async deleteAccount(request: Request, url: URL): Promise<Response> {
    if (!sameOrigin(request)) {
      return Response.json({ error: "forbidden" }, { status: 403 });
    }
    const user = await this.sessionUser(request);
    if (!user) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const body = (await request.json().catch(() => null)) as {
      confirm?: unknown;
    } | null;
    if (body?.confirm !== "delete-account") {
      return noStoreJson({ error: "confirmation-required" }, 400);
    }
    // An AI account is the super-admin's, listed in AI_SEATS: it is not
    // deleted from a browser switched to it.
    if (user.seat) return noStoreJson({ error: "ai-account" }, 409);
    const deleted = { circuits: 0, likes: 0, projects: 0, components: 0 };
    const call = async (
      namespace: GalleryBylineNamespaceLike | undefined,
      name: string,
      target: string,
    ): Promise<Record<string, number> | null> => {
      if (!namespace) return {};
      try {
        const response = await namespace.getByName(name).fetch(target, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ userId: user.id }),
        });
        return response.ok
          ? ((await response.json()) as Record<string, number>)
          : null;
      } catch {
        return null;
      }
    };
    const gallery = await call(
      this.env.GALLERY,
      "gallery",
      "https://gallery/delete-account",
    );
    if (!gallery) return noStoreJson({ error: "gallery-delete-failed" }, 503);
    deleted.circuits = gallery.entries ?? 0;
    deleted.likes = gallery.likes ?? 0;
    deleted.projects = gallery.projects ?? 0;
    const components = await call(
      this.env.COMPONENT_LIBRARY,
      "components",
      "https://components/delete-author",
    );
    if (!components)
      return noStoreJson({ error: "components-delete-failed" }, 503);
    deleted.components = components.deleted ?? 0;
    this.sql.exec("DELETE FROM sessions WHERE user_id = ?", user.id);
    if (user.email) {
      this.sql.exec("DELETE FROM login_codes WHERE email = ?", user.email);
      this.sql.exec(
        "DELETE FROM login_rates WHERE email_hash = ?",
        await sha256(`login:${user.email}`),
      );
    }
    this.sql.exec("DELETE FROM users WHERE id = ?", user.id);
    const response = noStoreJson({ deleted });
    response.headers.append(
      "Set-Cookie",
      sessionCookie("", url.protocol === "https:", 0),
    );
    return response;
  }

  /**
   * Super-admin appoints (or revokes) moderators by email; the role
   * applies to every account carrying that verified email, so it covers
   * a person's GitHub, Google, and email identities at once.
   */
  private async setRole(request: Request): Promise<Response> {
    const caller = await this.superAdmin(request, "change");
    if (caller instanceof Response) return caller;
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

  // --- AI accounts --------------------------------------------------------

  /** The signed-in user, and who switched this browser to it. */
  private async me(request: Request): Promise<SessionUser | null> {
    const user = await this.sessionUser(request);
    if (!user?.seat) return user;
    const owner = await this.tokenUser(
      parseCookies(request.headers.get("Cookie"))[AUTH_OWNER_COOKIE],
    );
    return owner?.isAdmin
      ? { ...user, switchedFrom: { displayName: owner.displayName } }
      : user;
  }

  /** The super-admin, or a refusal; a change must also be same-origin. */
  private async superAdmin(
    request: Request,
    kind: "read" | "change" = "read",
  ): Promise<SessionUser | Response> {
    if (kind === "change" && !sameOrigin(request)) {
      return noStoreJson({ error: "forbidden" }, 403);
    }
    const caller = await this.sessionUser(request);
    if (!caller?.isAdmin) return noStoreJson({ error: "unauthorized" }, 401);
    return caller;
  }

  private aiAccount(userId: unknown): UserRow | undefined {
    return this.sql
      .exec<UserRow>(
        "SELECT * FROM users WHERE id = ? AND provider = ?",
        typeof userId === "string" ? userId : "",
        AI_ACCOUNT_PROVIDER,
      )
      .toArray()[0];
  }

  /**
   * Makes each seat in AI_SEATS that is not one yet, a new account or the
   * account an Agent published under converted in place, and gives a
   * renamed seat its listed name back. A converted account's role goes back
   * to user, so a seat holds no moderator's power.
   */
  private ensureAiSeats(state: DurableObjectStateLike): void {
    state.storage.transactionSync(() => {
      for (const { seat, userId, displayName, formerName } of AI_SEATS) {
        const row = this.sql
          .exec<UserRow>("SELECT * FROM users WHERE id = ?", userId)
          .toArray()[0];
        if (
          row?.provider === AI_ACCOUNT_PROVIDER &&
          row.display_name === displayName
        )
          continue;
        // Only the Agent's account it names is converted: a person's account
        // under a mistyped id, or one renamed since, is left alone.
        if (
          row &&
          row.provider !== AI_ACCOUNT_PROVIDER &&
          row.display_name !== formerName
        )
          continue;
        try {
          if (row)
            this.sql.exec(
              "UPDATE users SET provider = ?, provider_id = ?, email = NULL, role = 'user', display_name = ? WHERE id = ?",
              AI_ACCOUNT_PROVIDER,
              seat,
              displayName,
              userId,
            );
          else
            this.sql.exec(
              "INSERT INTO users(id, provider, provider_id, email, display_name, role, created_at) VALUES (?, ?, ?, NULL, ?, 'user', ?)",
              userId,
              AI_ACCOUNT_PROVIDER,
              seat,
              displayName,
              new Date().toISOString(),
            );
        } catch {
          // A seat that cannot be made (its seat name taken by another
          // row) must not stop every sign-in; it is simply not made.
        }
      }
    });
  }

  /** The seats in AI_SEATS order, with their current display names. */
  private aiAccounts() {
    return AI_SEATS.flatMap(({ seat, userId }) => {
      const row = this.aiAccount(userId);
      return row ? [{ id: row.id, seat, displayName: row.display_name }] : [];
    });
  }

  private async listAiAccounts(request: Request): Promise<Response> {
    const caller = await this.superAdmin(request);
    if (caller instanceof Response) return caller;
    return noStoreJson({ accounts: this.aiAccounts() });
  }

  /**
   * This browser becomes the AI account for the session's usual 30 days.
   * The super-admin's own session is kept beside it, so one click switches
   * back without signing in again.
   */
  private async switchToAiAccount(
    request: Request,
    url: URL,
  ): Promise<Response> {
    const caller = await this.superAdmin(request, "change");
    if (caller instanceof Response) return caller;
    const body = (await request.json().catch(() => null)) as {
      userId?: unknown;
    } | null;
    const account = this.aiAccount(body?.userId);
    if (!account) return noStoreJson({ error: "no-such-ai-account" }, 404);
    // A fresh session for the way back, as long as the AI account's: the
    // one in use now could run out first and leave no way back.
    await this.endSession(
      parseCookies(request.headers.get("Cookie"))[AUTH_SESSION_COOKIE],
    );
    const ownerToken = await this.createSession(caller.id);
    const secure = url.protocol === "https:";
    const response = noStoreJson({ switched: true });
    response.headers.append(
      "Set-Cookie",
      sessionCookie(
        await this.createSession(account.id),
        secure,
        AUTH_SESSION_TTL_SECONDS,
      ),
    );
    response.headers.append(
      "Set-Cookie",
      ownerCookie(ownerToken, secure, AUTH_SESSION_TTL_SECONDS),
    );
    return response;
  }

  /** Back to the super-admin's own session; the AI account's here ends. */
  private async returnToOwner(request: Request, url: URL): Promise<Response> {
    if (!sameOrigin(request)) return noStoreJson({ error: "forbidden" }, 403);
    const cookies = parseCookies(request.headers.get("Cookie"));
    const current = await this.tokenUser(cookies[AUTH_SESSION_COOKIE]);
    const ownerToken = cookies[AUTH_OWNER_COOKIE];
    const owner = await this.tokenUser(ownerToken);
    const secure = url.protocol === "https:";
    // Another tab already switched this browser back.
    if (current?.isAdmin && !owner) return noStoreJson({ returned: true });
    if (!current?.seat) return noStoreJson({ error: "not-switched" }, 409);
    // The AI account's session here ends either way: a browser whose way
    // back has gone (or whose owner is no longer the super-admin) is signed
    // out rather than left as the AI account.
    await this.endSession(cookies[AUTH_SESSION_COOKIE]);
    if (!ownerToken || !owner?.isAdmin) {
      await this.endSession(ownerToken);
      const refused = noStoreJson({ error: "unauthorized" }, 401);
      refused.headers.append("Set-Cookie", sessionCookie("", secure, 0));
      refused.headers.append("Set-Cookie", ownerCookie("", secure, 0));
      return refused;
    }
    const response = noStoreJson({ returned: true });
    response.headers.append(
      "Set-Cookie",
      sessionCookie(ownerToken, secure, AUTH_SESSION_TTL_SECONDS),
    );
    response.headers.append("Set-Cookie", ownerCookie("", secure, 0));
    return response;
  }
}
