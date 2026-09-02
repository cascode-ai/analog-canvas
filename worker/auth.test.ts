import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  AUTH_DISPLAY_NAME_MAX,
  AUTH_EMAIL_DAILY_LIMIT,
  AuthDO,
  sessionUserOf,
  type AuthEnv,
  type SessionUser,
} from "./auth";

const ORIGIN = "https://canvas.test";

function sqliteState() {
  const db = new DatabaseSync(":memory:");
  return {
    storage: {
      sql: {
        exec<T>(query: string, ...bindings: unknown[]) {
          const statement = db.prepare(query);
          if (/^\s*(select|with|pragma)/iu.test(query)) {
            const rows = statement.all(
              ...(bindings as (string | number | null)[]),
            ) as T[];
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("expected one row");
                return rows[0]!;
              },
            };
          }
          statement.run(...(bindings as (string | number | null)[]));
          return {
            toArray: () => [] as T[],
            one: () => {
              throw new Error("no rows");
            },
          };
        },
      },
      transactionSync<T>(callback: () => T): T {
        return callback();
      },
    },
  };
}

type FakeRoute = (url: string, init?: RequestInit) => Response | null;

function harness(env: Partial<AuthEnv> = {}, routes: FakeRoute[] = []) {
  const durable = new AuthDO(sqliteState(), {
    AUTH: undefined as never,
    ...env,
  });
  const outbound: { url: string; init?: RequestInit }[] = [];
  durable.fetchLike = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    outbound.push({ url, ...(init === undefined ? {} : { init }) });
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    throw new Error(`unmocked outbound fetch: ${url}`);
  }) as typeof fetch;
  const call = (
    path: string,
    init: RequestInit & { cookie?: string } = {},
  ): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (init.cookie) headers.set("Cookie", init.cookie);
    if (init.method === "POST") headers.set("Origin", ORIGIN);
    return durable.fetch(new Request(`${ORIGIN}${path}`, { ...init, headers }));
  };
  return { durable, call, outbound };
}

function cookieValue(response: Response, name: string): string | null {
  for (const header of response.headers.getSetCookie()) {
    const match = header.match(new RegExp(`^${name}=([^;]*)`, "u"));
    if (match) return match[1] ?? null;
  }
  return null;
}

function resendCapture(sent: { to: string; text: string }[]): FakeRoute {
  return (url, init) => {
    if (!url.startsWith("https://api.resend.com/")) return null;
    const body = JSON.parse(String(init?.body)) as {
      to: string[];
      text: string;
    };
    sent.push({ to: body.to[0] ?? "", text: body.text });
    return Response.json({ id: "email-1" });
  };
}

async function emailSignIn(
  auth: ReturnType<typeof harness>,
  email: string,
): Promise<string> {
  const sent: { to: string; text: string }[] = [];
  auth.durable.fetchLike = (async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ) => {
    const response = resendCapture(sent)(String(input), init);
    if (!response) throw new Error(`unmocked: ${String(input)}`);
    return response;
  }) as typeof fetch;
  const start = await auth.call("/api/auth/email/start", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
  expect(start.status).toBe(202);
  const link = sent[0]?.text.match(/https?:\/\/\S+/u)?.[0];
  if (!link) throw new Error("no sign-in link sent");
  const callback = await auth.call(link.slice(ORIGIN.length));
  expect(callback.status).toBe(302);
  const session = cookieValue(callback, "icm_session");
  if (!session) throw new Error("no session cookie set");
  return `icm_session=${session}`;
}

async function me(
  auth: ReturnType<typeof harness>,
  cookie?: string,
): Promise<SessionUser | null> {
  const response = await auth.call(
    "/api/auth/me",
    cookie === undefined ? {} : { cookie },
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { user: SessionUser | null }).user;
}

describe("runtime binding", () => {
  it("never exposes the raw global fetch as the default seam", () => {
    // `this.fetchLike(...)` on the raw global rebinds `this` to the DO,
    // which the Workers runtime rejects with "Illegal invocation" (Node
    // tolerates it, so only this identity check can catch a regression).
    const durable = new AuthDO(sqliteState(), {} as AuthEnv);
    expect(durable.fetchLike).not.toBe(fetch);
    expect(durable.fetchLike).not.toBe(globalThis.fetch);
  });
});

describe("account data migrations", () => {
  it("renames the legacy tokenzhang account once without touching other users", () => {
    const state = sqliteState();
    new AuthDO(state, {} as AuthEnv);
    state.storage.sql.exec(
      `INSERT INTO users
       (id, provider, provider_id, email, display_name, role, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?), (?, ?, ?, ?, ?, ?, ?)`,
      "legacy-user",
      "github",
      "1",
      null,
      "Token Zhang",
      "user",
      "2026-08-01T00:00:00.000Z",
      "other-user",
      "github",
      "2",
      null,
      "Zhishuai Zhang",
      "user",
      "2026-08-01T00:00:00.000Z",
    );
    state.storage.sql.exec("DELETE FROM data_migrations");

    new AuthDO(state, {} as AuthEnv);
    expect(
      state.storage.sql
        .exec<{ id: string; display_name: string }>(
          "SELECT id, display_name FROM users ORDER BY id",
        )
        .toArray(),
    ).toEqual([
      { id: "legacy-user", display_name: "Zhishuai Zhang" },
      { id: "other-user", display_name: "Zhishuai Zhang" },
    ]);

    state.storage.sql.exec(
      "UPDATE users SET display_name = 'Token Zhang' WHERE id = 'legacy-user'",
    );
    new AuthDO(state, {} as AuthEnv);
    expect(
      state.storage.sql
        .exec<{ display_name: string }>(
          "SELECT display_name FROM users WHERE id = 'legacy-user'",
        )
        .one().display_name,
    ).toBe("Token Zhang");
  });
});

describe("providers visibility (dark ship)", () => {
  it("reports exactly the providers whose secrets exist", async () => {
    const dark = harness();
    expect(await (await dark.call("/api/auth/providers")).json()).toEqual({
      github: false,
      google: false,
      email: false,
    });
    const lit = harness({
      GH_OAUTH_CLIENT_ID: "gid",
      GH_OAUTH_CLIENT_SECRET: "gsecret",
      RESEND_API_KEY: "rk",
    });
    expect(await (await lit.call("/api/auth/providers")).json()).toEqual({
      github: true,
      google: false,
      email: true,
    });
    const darkStart = await dark.call("/api/auth/github/start");
    expect(darkStart.status).toBe(404);
    const darkEmail = await dark.call("/api/auth/email/start", {
      method: "POST",
      body: JSON.stringify({ email: "a@b.co" }),
    });
    expect(darkEmail.status).toBe(404);
  });
});

describe("email magic-link sign-in", () => {
  it("signs in end-to-end, renames, and signs out", async () => {
    const auth = harness({
      RESEND_API_KEY: "rk",
      ADMIN_EMAILS: "Boss@Example.com, other@example.com",
    });
    const cookie = await emailSignIn(auth, "boss@example.com");

    const user = await me(auth, cookie);
    expect(user).toMatchObject({
      provider: "email",
      email: "boss@example.com",
      displayName: "boss",
      isAdmin: true,
    });

    const renamed = await auth.call("/api/auth/profile", {
      method: "POST",
      cookie,
      body: JSON.stringify({ displayName: "  Token Zhang  " }),
    });
    expect(renamed.status).toBe(200);
    expect((await me(auth, cookie))?.displayName).toBe("Token Zhang");

    // Signing in again keeps the account and the chosen name.
    const secondCookie = await emailSignIn(auth, "boss@example.com");
    const again = await me(auth, secondCookie);
    expect(again?.id).toBe(user?.id);
    expect(again?.displayName).toBe("Token Zhang");

    const logout = await auth.call("/api/auth/logout", {
      method: "POST",
      cookie,
    });
    expect(logout.status).toBe(200);
    expect(await me(auth, cookie)).toBeNull();
    expect(await me(auth)).toBeNull();
  });

  it("unions the primary and additive administrator email secrets", async () => {
    const auth = harness({
      RESEND_API_KEY: "rk",
      ADMIN_EMAILS: "owner@example.com",
      ADMIN_EMAILS_EXTRA: " Added.Admin@Example.com ",
    });

    const ownerCookie = await emailSignIn(auth, "owner@example.com");
    const addedCookie = await emailSignIn(auth, "added.admin@example.com");
    const ordinaryCookie = await emailSignIn(auth, "user@example.com");

    expect((await me(auth, ownerCookie))?.isAdmin).toBe(true);
    expect((await me(auth, addedCookie))?.isAdmin).toBe(true);
    expect((await me(auth, ordinaryCookie))?.isAdmin).toBe(false);
  });

  it("magic links are single-use, expire, and are rate-limited", async () => {
    const auth = harness({ RESEND_API_KEY: "rk" });
    const sent: { to: string; text: string }[] = [];
    auth.durable.fetchLike = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => resendCapture(sent)(String(input), init)!) as typeof fetch;

    const start = await auth.call("/api/auth/email/start", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com" }),
    });
    expect(start.status).toBe(202);
    const link = sent[0]!.text.match(/https?:\/\/\S+/u)![0];
    const path = link.slice(ORIGIN.length);

    const first = await auth.call(path);
    expect(cookieValue(first, "icm_session")).toBeTruthy();
    const reused = await auth.call(path);
    expect(reused.headers.get("location")).toContain("auth=failed");

    // A fresh link that has already expired by callback time fails.
    await auth.call("/api/auth/email/start", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com" }),
    });
    const expiredLink = sent[1]!.text.match(/https?:\/\/\S+/u)![0];
    auth.durable.now = () => new Date(Date.now() + 16 * 60 * 1000);
    const expired = await auth.call(expiredLink.slice(ORIGIN.length));
    expect(expired.headers.get("location")).toContain("auth=failed");
    auth.durable.now = () => new Date();

    const invalid = await auth.call("/api/auth/email/start", {
      method: "POST",
      body: JSON.stringify({ email: "not-an-email" }),
    });
    expect(invalid.status).toBe(400);

    for (let index = sent.length; index < AUTH_EMAIL_DAILY_LIMIT; index += 1) {
      const ok = await auth.call("/api/auth/email/start", {
        method: "POST",
        body: JSON.stringify({ email: "user@example.com" }),
      });
      expect(ok.status).toBe(202);
    }
    const overflow = await auth.call("/api/auth/email/start", {
      method: "POST",
      body: JSON.stringify({ email: "user@example.com" }),
    });
    expect(overflow.status).toBe(429);
    const other = await auth.call("/api/auth/email/start", {
      method: "POST",
      body: JSON.stringify({ email: "someone-else@example.com" }),
    });
    expect(other.status).toBe(202);
  });

  it("rejects a rename that is empty, oversized, or anonymous", async () => {
    const auth = harness({ RESEND_API_KEY: "rk" });
    const cookie = await emailSignIn(auth, "user@example.com");
    const anonymous = await auth.call("/api/auth/profile", {
      method: "POST",
      body: JSON.stringify({ displayName: "X" }),
    });
    expect(anonymous.status).toBe(401);
    const empty = await auth.call("/api/auth/profile", {
      method: "POST",
      cookie,
      body: JSON.stringify({ displayName: "   " }),
    });
    expect(empty.status).toBe(400);
    const oversized = await auth.call("/api/auth/profile", {
      method: "POST",
      cookie,
      body: JSON.stringify({
        displayName: "x".repeat(AUTH_DISPLAY_NAME_MAX + 1),
      }),
    });
    expect(oversized.status).toBe(400);
  });

  it("expires sessions after their TTL", async () => {
    const auth = harness({ RESEND_API_KEY: "rk" });
    const cookie = await emailSignIn(auth, "user@example.com");
    expect(await me(auth, cookie)).not.toBeNull();
    auth.durable.now = () => new Date(Date.now() + 31 * 24 * 60 * 60 * 1000);
    expect(await me(auth, cookie)).toBeNull();
  });
});

describe("GitHub OAuth", () => {
  function githubRoutes(): FakeRoute[] {
    return [
      (url) =>
        url.startsWith("https://github.com/login/oauth/access_token")
          ? Response.json({ access_token: "gh-token" })
          : null,
      (url) =>
        url === "https://api.github.com/user"
          ? Response.json({ id: 4242, login: "tz", name: "Token Zhang" })
          : null,
      (url) =>
        url === "https://api.github.com/user/emails"
          ? Response.json([
              { email: "old@example.com", primary: false, verified: true },
              { email: "boss@example.com", primary: true, verified: true },
              { email: "spoof@example.com", primary: false, verified: false },
            ])
          : null,
    ];
  }

  it("round-trips authorize, callback, and admin detection", async () => {
    const auth = harness(
      {
        GH_OAUTH_CLIENT_ID: "gid",
        GH_OAUTH_CLIENT_SECRET: "gsecret",
        ADMIN_EMAILS: "boss@example.com",
      },
      githubRoutes(),
    );
    const start = await auth.call("/api/auth/github/start");
    expect(start.status).toBe(302);
    const authorize = new URL(start.headers.get("location") ?? "");
    expect(authorize.origin + authorize.pathname).toBe(
      "https://github.com/login/oauth/authorize",
    );
    expect(authorize.searchParams.get("redirect_uri")).toBe(
      `${ORIGIN}/api/auth/github/callback`,
    );
    const state = authorize.searchParams.get("state");
    const stateCookie = cookieValue(start, "icm_oauth_state");
    expect(state).toBe(stateCookie);

    const callback = await auth.call(
      `/api/auth/github/callback?code=abc&state=${state}`,
      { cookie: `icm_oauth_state=${state}` },
    );
    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${ORIGIN}/`);
    const session = cookieValue(callback, "icm_session");
    expect(session).toBeTruthy();

    const user = await me(auth, `icm_session=${session}`);
    expect(user).toMatchObject({
      provider: "github",
      displayName: "Token Zhang",
      email: "boss@example.com",
      isAdmin: true,
    });
  });

  it("refuses a state mismatch without touching the provider", async () => {
    const auth = harness(
      { GH_OAUTH_CLIENT_ID: "gid", GH_OAUTH_CLIENT_SECRET: "gsecret" },
      githubRoutes(),
    );
    const mismatch = await auth.call(
      "/api/auth/github/callback?code=abc&state=forged",
      { cookie: "icm_oauth_state=real" },
    );
    expect(mismatch.headers.get("location")).toContain("auth=failed");
    expect(auth.outbound).toHaveLength(0);
  });
});

describe("Google OAuth", () => {
  it("uses only a verified email and defaults the display name", async () => {
    const auth = harness(
      { GOOGLE_CLIENT_ID: "cid", GOOGLE_CLIENT_SECRET: "csecret" },
      [
        (url) =>
          url.startsWith("https://oauth2.googleapis.com/token")
            ? Response.json({ access_token: "g-token" })
            : null,
        (url) =>
          url.startsWith("https://openidconnect.googleapis.com/")
            ? Response.json({
                sub: "sub-1",
                email: "person@example.com",
                email_verified: true,
                name: "",
              })
            : null,
      ],
    );
    const start = await auth.call("/api/auth/google/start");
    const state = new URL(start.headers.get("location") ?? "").searchParams.get(
      "state",
    );
    const callback = await auth.call(
      `/api/auth/google/callback?code=abc&state=${state}`,
      { cookie: `icm_oauth_state=${state}` },
    );
    const session = cookieValue(callback, "icm_session");
    const user = await me(auth, `icm_session=${session}`);
    expect(user).toMatchObject({
      provider: "google",
      email: "person@example.com",
      displayName: "person",
      isAdmin: false,
    });
  });
});

describe("moderator appointment", () => {
  it("lets only the admin set a role, applied across the email's accounts", async () => {
    const auth = harness({
      RESEND_API_KEY: "rk",
      ADMIN_EMAILS: "owner@example.com",
    });
    const adminCookie = await emailSignIn(auth, "owner@example.com");
    const reviewerCookie = await emailSignIn(auth, "reviewer@example.com");
    expect((await me(auth, reviewerCookie))?.role).toBe("user");

    const denied = await auth.call("/api/auth/users/role", {
      method: "POST",
      cookie: reviewerCookie,
      body: JSON.stringify({
        email: "reviewer@example.com",
        role: "moderator",
      }),
    });
    expect(denied.status).toBe(401);

    const appointed = await auth.call("/api/auth/users/role", {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({
        email: "Reviewer@Example.com",
        role: "moderator",
      }),
    });
    expect(appointed.status).toBe(200);
    expect((await me(auth, reviewerCookie))?.role).toBe("moderator");

    const unknown = await auth.call("/api/auth/users/role", {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({ email: "ghost@example.com", role: "moderator" }),
    });
    expect(unknown.status).toBe(404);

    const revoked = await auth.call("/api/auth/users/role", {
      method: "POST",
      cookie: adminCookie,
      body: JSON.stringify({ email: "reviewer@example.com", role: "user" }),
    });
    expect(revoked.status).toBe(200);
    expect((await me(auth, reviewerCookie))?.role).toBe("user");
  });
});

describe("sessionUserOf (module seam for the gallery)", () => {
  it("resolves the signed-in user through the binding and null otherwise", async () => {
    const auth = harness({ RESEND_API_KEY: "rk", ADMIN_EMAILS: "b@e.co" });
    const cookie = await emailSignIn(auth, "b@e.co");
    let bindingFetches = 0;
    const env = {
      AUTH: {
        getByName: () => ({
          fetch: (input: Request | string, init?: RequestInit) => {
            bindingFetches += 1;
            return auth.durable.fetch(
              typeof input === "string" ? new Request(input, init) : input,
            );
          },
        }),
      },
    };
    const signedIn = await sessionUserOf(
      new Request(`${ORIGIN}/api/gallery/submissions`, {
        headers: { Cookie: cookie },
      }),
      env,
    );
    expect(signedIn?.isAdmin).toBe(true);
    expect(bindingFetches).toBe(1);
    const anonymous = await sessionUserOf(
      new Request(`${ORIGIN}/api/gallery/submissions`),
      env,
    );
    expect(anonymous).toBeNull();
    expect(bindingFetches).toBe(1);
    const emptySession = await sessionUserOf(
      new Request(`${ORIGIN}/api/gallery/submissions`, {
        headers: { Cookie: "icm_visitor=visitor; icm_session=" },
      }),
      env,
    );
    expect(emptySession).toBeNull();
    expect(bindingFetches).toBe(1);
    const unbound = await sessionUserOf(
      new Request(`${ORIGIN}/api/gallery/submissions`),
      {},
    );
    expect(unbound).toBeNull();
  });
});
