// Seam 2 for AnalogArena: requests enter the deployed Worker's fetch handler,
// accounts are real (the deployed AuthDO on in-memory SQLite), and only the
// Arena Worker, which lives in another repository, is faked at its service
// binding. The contract is docs/specs/analog-arena.md.

import { describe, expect, it } from "vitest";

import type { AuthEnv } from "./auth";
import {
  ORIGIN,
  adminOf,
  makerOf,
  ownerAccountOf,
  seatOf,
  sqliteState,
  type Harness,
} from "./gallery.test-support";
import workerEntry, { AuthDO } from "./index";

const SHELL = "<!doctype html><title>Analog Canvas</title>";

type ArenaService = (request: Request) => Promise<Response>;

const arenaPage: ArenaService = async () =>
  new Response("<h1>AnalogArena</h1>", {
    headers: { "content-type": "text/html; charset=utf-8" },
  });

/**
 * Analog Canvas with Arena answering as `arena` does; null leaves it unbound.
 * Every request Arena receives is kept in `forwarded`, whether the Worker
 * forwarded it or the account store sent it while deleting an account: as
 * in Production, the account store sees the Worker's bindings.
 */
function canvas(arena: ArenaService | null = arenaPage) {
  const forwarded: Request[] = [];
  const served: Request[] = [];
  const binding = arena && {
    ARENA: {
      fetch: (request: Request) => {
        forwarded.push(request);
        return arena(request);
      },
    },
  };
  const authState = sqliteState();
  const authDurable = new AuthDO(authState, {
    RESEND_API_KEY: "rk",
    ADMIN_EMAILS: "owner@example.com",
    GH_OAUTH_CLIENT_ID: "gid",
    GH_OAUTH_CLIENT_SECRET: "gsecret",
    GOOGLE_CLIENT_ID: "cid",
    GOOGLE_CLIENT_SECRET: "csecret",
    ...binding,
  } as AuthEnv);
  // The Gallery harness's sign-in helpers need only the accounts.
  const accounts = {
    authDurable,
    authSql: authState.storage.sql,
  } as unknown as Harness;
  const env = {
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          authDurable.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
    ...binding,
    ASSETS: {
      fetch: async (request: Request) => {
        served.push(request);
        return new Response(SHELL, {
          headers: { "content-type": "text/html; charset=utf-8" },
        });
      },
    },
  } as unknown as Parameters<typeof workerEntry.fetch>[1];
  const visit = (path: string, init: RequestInit = {}) =>
    workerEntry.fetch(new Request(`${ORIGIN}${path}`, init), env);
  return { accounts, forwarded, served, visit };
}

/** The account Analog Canvas vouched for, as Arena reads it. */
function forwardedAccount(request: Request | undefined): unknown {
  const header = request?.headers.get("x-arena-account");
  return header === null || header === undefined ? null : JSON.parse(header);
}

async function accountId(
  visit: ReturnType<typeof canvas>["visit"],
  cookie: string,
): Promise<string> {
  const response = await visit("/api/auth/me", { headers: { Cookie: cookie } });
  return ((await response.json()) as { user: { id: string } }).user.id;
}

describe("Arena forwarding", () => {
  it("forwards a signed-in visit to /arena with the account Analog Canvas vouches for", async () => {
    const { accounts, forwarded, visit } = canvas();
    const cookie = await makerOf(accounts);

    const response = await visit("/arena", { headers: { Cookie: cookie } });

    expect(await response.text()).toBe("<h1>AnalogArena</h1>");
    expect(forwardedAccount(forwarded[0])).toEqual({
      id: await accountId(visit, cookie),
      displayName: "maker",
      isOwner: false,
      isAdmin: false,
      role: "user",
      seat: null,
    });
  });

  it("vouches for the Owner, an administrator, a moderator and an AI seat as they are", async () => {
    const { accounts, forwarded, visit } = canvas();
    const admin = await adminOf(accounts);
    const maker = await makerOf(accounts);
    const appointed = await visit("/api/auth/users/role", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: admin },
      body: JSON.stringify({ email: "maker@example.com", role: "moderator" }),
    });
    expect(appointed.status).toBe(200);
    const visitors = {
      owner: await ownerAccountOf(accounts),
      admin,
      moderator: maker,
      seat: await seatOf(accounts),
    };

    const facts: Record<string, unknown> = {};
    for (const [visitor, cookie] of Object.entries(visitors)) {
      await visit("/api/arena/session", { headers: { Cookie: cookie } });
      const { isOwner, isAdmin, role, seat } = forwardedAccount(
        forwarded.at(-1),
      ) as Record<string, unknown>;
      facts[visitor] = { isOwner, isAdmin, role, seat };
    }

    expect(facts).toEqual({
      owner: { isOwner: true, isAdmin: false, role: "user", seat: null },
      admin: { isOwner: false, isAdmin: true, role: "user", seat: null },
      moderator: {
        isOwner: false,
        isAdmin: false,
        role: "moderator",
        seat: null,
      },
      seat: {
        isOwner: false,
        isAdmin: false,
        role: "user",
        seat: "ai-designer-1",
      },
    });
  });

  it("vouches for a name in any script", async () => {
    // A header carries bytes, not text: an account named outside Latin-1
    // must still reach Arena, and by its own name.
    const { accounts, forwarded, visit } = canvas();
    const cookie = await makerOf(accounts);
    const renamed = await visit("/api/auth/profile", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: cookie },
      body: JSON.stringify({ displayName: "Zoë 张伟 🎛" }),
    });
    expect(renamed.status).toBe(200);

    const response = await visit("/arena", { headers: { Cookie: cookie } });

    expect(response.status).toBe(200);
    expect(forwardedAccount(forwarded[0])).toMatchObject({
      displayName: "Zoë 张伟 🎛",
    });
  });

  it("forwards a signed-out visit with no account", async () => {
    const { forwarded, visit } = canvas();

    await visit("/arena");

    expect(forwarded).toHaveLength(1);
    expect(forwardedAccount(forwarded[0])).toBeNull();
  });

  it("drops an account the client forged, signed out or in", async () => {
    const { accounts, forwarded, visit } = canvas();
    const cookie = await makerOf(accounts);
    const forged = JSON.stringify({
      id: "someone-else",
      displayName: "The Owner",
      isOwner: true,
      isAdmin: true,
      role: "moderator",
      seat: null,
    });

    await visit("/arena", { headers: { "x-arena-account": forged } });
    await visit("/api/arena/session", {
      headers: { "x-arena-account": forged, Cookie: cookie },
    });

    expect(forwardedAccount(forwarded[0])).toBeNull();
    expect(forwardedAccount(forwarded[1])).toMatchObject({
      id: await accountId(visit, cookie),
      isOwner: false,
    });
  });

  it("forwards the method, path, query and body unchanged", async () => {
    const { accounts, forwarded, visit } = canvas();
    const cookie = await makerOf(accounts);
    const vote = JSON.stringify({ battle: "b-1", verdict: "left" });

    await visit("/api/arena/votes?retry=1", {
      method: "POST",
      headers: {
        Cookie: cookie,
        "content-type": "application/json",
        "x-arena-account": "{}",
      },
      body: vote,
    });

    const [request] = forwarded;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(`${ORIGIN}/api/arena/votes?retry=1`);
    expect(request?.headers.get("content-type")).toBe("application/json");
    expect(await request?.text()).toBe(vote);
  });

  it("keeps the session cookie from Arena and forwards the other cookies", async () => {
    const { accounts, forwarded, visit } = canvas();
    const cookie = await makerOf(accounts);
    expect(cookie).toMatch(/^icm_session=/u);

    await visit("/arena", {
      headers: { Cookie: `theme=dark; ${cookie}; arena_seen=1` },
    });
    await visit("/api/arena/session", { headers: { Cookie: cookie } });

    expect(forwarded[0]?.headers.get("cookie")).toBe(
      "theme=dark; arena_seen=1",
    );
    expect(forwardedAccount(forwarded[0])).toMatchObject({
      id: await accountId(visit, cookie),
    });
    expect(forwarded[1]?.headers.has("cookie")).toBe(false);
    expect(forwardedAccount(forwarded[1])).not.toBeNull();
  });

  it("drops the Authorization header", async () => {
    const { forwarded, visit } = canvas();

    await visit("/api/arena/session", {
      headers: { Authorization: "Bearer icm-agent-token" },
    });

    expect(forwarded[0]?.headers.has("authorization")).toBe(false);
  });

  it.each([200, 404])(
    "drops a %i answer's cookies that would sign this browser in or out",
    async (status) => {
      const { visit } = canvas(async () => {
        const headers = new Headers({ "content-type": "text/html" });
        headers.append("set-cookie", "icm_session=arena; Path=/; HttpOnly");
        headers.append(
          "set-cookie",
          "icm_owner_session=arena; Path=/api/auth; HttpOnly",
        );
        headers.append("set-cookie", "arena_seen=1; Path=/arena");
        return new Response("<h1>AnalogArena</h1>", { status, headers });
      });

      const response = await visit("/arena");

      expect(response.status).toBe(status);
      expect(response.headers.getSetCookie()).toEqual([
        "arena_seen=1; Path=/arena",
      ]);
      expect(await response.text()).toBe("<h1>AnalogArena</h1>");
    },
  );

  it.each([
    "/",
    "/editor",
    "/arenas",
    "/arena-results",
    "/g/arena",
    "/api/arena",
    "/api/arenas/session",
    "/api/auth/providers",
    // Arena's account deletion, which only the account store sends.
    "/api/canvas/account-deletion",
    "/api/arena/../canvas/account-deletion",
  ])("leaves %s to Analog Canvas", async (path) => {
    const { forwarded, visit } = canvas();

    await visit(path);

    expect(forwarded).toEqual([]);
  });

  it("drops a forged account on paths Arena never sees", async () => {
    const { served, visit } = canvas();

    await visit("/editor", {
      headers: { "x-arena-account": JSON.stringify({ id: "forged" }) },
    });

    expect(served).toHaveLength(1);
    expect(served[0]!.headers.has("x-arena-account")).toBe(false);
  });
});

describe("when Arena cannot answer", () => {
  const failures: [string, ArenaService | null][] = [
    [
      "unreachable",
      async () => {
        throw new Error("Network connection lost.");
      },
    ],
    ["failing", async () => new Response("Worker threw", { status: 500 })],
    ["not bound", null],
  ];

  it.each(failures)(
    "answers a page with a small error page when Arena is %s",
    async (_case, arena) => {
      const { visit } = canvas(arena);

      const response = await visit("/arena");

      expect(response.status).toBe(503);
      expect(response.headers.get("content-type")).toContain("text/html");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).toContain("Arena is unavailable");
    },
  );

  it.each(failures)(
    "answers an API call with a JSON error when Arena is %s",
    async (_case, arena) => {
      const { visit } = canvas(arena);

      const response = await visit("/api/arena/session");

      expect(response.status).toBe(503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ error: "arena-unavailable" });
    },
  );

  it("passes Arena's own refusals through", async () => {
    const { visit } = canvas(async () =>
      Response.json({ error: "not-found" }, { status: 404 }),
    );

    const response = await visit("/api/arena/nothing-here");

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not-found" });
  });
});

describe("signing in from Arena", () => {
  /** GitHub's and Google's side of a successful sign-in. */
  const providers = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://github.com/login/oauth/access_token"))
      return Response.json({ access_token: "gh-token" });
    if (url === "https://api.github.com/user")
      return Response.json({ id: 4242, login: "voter", name: "A Voter" });
    if (url === "https://api.github.com/user/emails")
      return Response.json([
        { email: "voter@example.com", primary: true, verified: true },
      ]);
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "g-token" });
    if (url === "https://openidconnect.googleapis.com/v1/userinfo")
      return Response.json({
        sub: "sub-1",
        email: "voter@example.com",
        email_verified: true,
        name: "A Voter",
      });
    throw new Error(`unexpected provider call: ${url}`);
  }) as typeof fetch;

  /** Where the browser lands after signing in through `start`. */
  async function landing(
    provider: "github" | "google",
    returnPath?: string,
  ): Promise<string | null> {
    const { accounts, visit } = canvas();
    accounts.authDurable.fetchLike = providers;
    const started = await visit(
      `/api/auth/${provider}/start` +
        (returnPath === undefined
          ? ""
          : `?return=${encodeURIComponent(returnPath)}`),
    );
    const state = new URL(
      started.headers.get("location") ?? "",
    ).searchParams.get("state");
    const stateCookie = started.headers
      .getSetCookie()
      .find((cookie) => cookie.startsWith("icm_oauth_state="))
      ?.split(";")[0];
    const callback = await visit(
      `/api/auth/${provider}/callback?code=abc&state=${encodeURIComponent(state ?? "")}`,
      { headers: { Cookie: stateCookie ?? "" } },
    );
    expect(
      callback.headers
        .getSetCookie()
        .some((cookie) => /^icm_session=[^;]+/u.test(cookie)),
    ).toBe(true);
    return callback.headers.get("location");
  }

  it.each([
    ["github", "/arena"],
    ["google", "/arena"],
    ["github", "/arena/my-votes"],
    ["google", "/arena/battle?season=1&round=2"],
  ] as const)(
    "%s sign-in started at %s comes back there",
    async (provider, path) => {
      expect(await landing(provider, path)).toBe(`${ORIGIN}${path}`);
    },
  );

  it.each([
    "https://evil.example",
    "https://evil.example/arena",
    "//evil.example/arena",
    "/\\evil.example/arena",
    "/editor",
    "/arenas",
    "/arena/../editor",
    "arena",
  ])("sign-in asked to return to %s comes back to /", async (path) => {
    expect(await landing("github", path)).toBe(`${ORIGIN}/`);
  });

  it("sign-in started anywhere else still comes back to /", async () => {
    expect(await landing("google")).toBe(`${ORIGIN}/`);
  });
});

describe("deleting an account", () => {
  /** The account page's Delete account…, confirmed. */
  function deleteAccount(
    visit: ReturnType<typeof canvas>["visit"],
    cookie: string,
    headers: Record<string, string> = {},
  ) {
    return visit("/api/auth/account/delete", {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: cookie, ...headers },
      body: JSON.stringify({ confirm: "delete-account" }),
    });
  }

  async function signedIn(
    visit: ReturnType<typeof canvas>["visit"],
    cookie: string,
  ): Promise<boolean> {
    const response = await visit("/api/auth/me", {
      headers: { Cookie: cookie },
    });
    return ((await response.json()) as { user: unknown }).user !== null;
  }

  const unlinked: ArenaService = async () => Response.json({ unlinked: true });

  it("asks Arena to unlink the account being deleted from its Voter, then deletes it", async () => {
    const { accounts, forwarded, visit } = canvas(unlinked);
    const cookie = await makerOf(accounts);
    const id = await accountId(visit, cookie);
    // A forged account on the deletion request changes nothing.
    const forged = JSON.stringify({
      id: "someone-else",
      displayName: "Someone",
      isOwner: false,
      isAdmin: false,
      role: "user",
      seat: null,
    });

    const response = await deleteAccount(visit, cookie, {
      "x-arena-account": forged,
    });

    expect(response.status).toBe(200);
    expect(forwarded).toHaveLength(1);
    const [request] = forwarded;
    expect(request?.method).toBe("POST");
    expect(request?.url).toBe(`${ORIGIN}/api/canvas/account-deletion`);
    expect(forwardedAccount(request)).toEqual({
      id,
      displayName: "maker",
      isOwner: false,
      isAdmin: false,
      role: "user",
      seat: null,
    });
    // Analog Canvas's credentials never reach Arena.
    expect(request?.headers.has("cookie")).toBe(false);
    expect(request?.headers.has("authorization")).toBe(false);
    expect(await signedIn(visit, cookie)).toBe(false);
  });

  it.each<[string, ArenaService]>([
    [
      "is unreachable",
      async () => {
        throw new Error("Network connection lost.");
      },
    ],
    ["fails", async () => new Response("Worker threw", { status: 500 })],
    [
      "refuses",
      async () =>
        Response.json(
          { error: "invalid-request", message: "…" },
          { status: 400 },
        ),
    ],
    // An Arena deployed without the account deletion answers 404, which
    // never counts as unlinked.
    [
      "does not know the call",
      async () => Response.json({ error: "not-found" }, { status: 404 }),
    ],
  ])(
    "keeps the account signed in when Arena %s, and a retry finishes the deletion",
    async (_case, failure) => {
      let arenaAnswers = failure;
      const { accounts, forwarded, visit } = canvas((request) =>
        arenaAnswers(request),
      );
      const cookie = await makerOf(accounts);
      const id = await accountId(visit, cookie);

      const failed = await deleteAccount(visit, cookie);

      expect(failed.status).toBe(503);
      expect(failed.headers.get("cache-control")).toBe("no-store");
      expect(await failed.json()).toEqual({ error: "arena-unlink-failed" });
      expect(failed.headers.has("set-cookie")).toBe(false);
      expect(await signedIn(visit, cookie)).toBe(true);

      // Arena answers the same however often it is asked, so retrying is
      // safe and finishes the deletion.
      arenaAnswers = unlinked;
      const retried = await deleteAccount(visit, cookie);

      expect(retried.status).toBe(200);
      expect(forwarded.map(forwardedAccount)).toEqual([
        expect.objectContaining({ id }),
        expect.objectContaining({ id }),
      ]);
      expect(await signedIn(visit, cookie)).toBe(false);
    },
  );

  it("deletes the account without Arena where Arena is not bound", async () => {
    const { accounts, visit } = canvas(null);
    const cookie = await makerOf(accounts);

    const response = await deleteAccount(visit, cookie);

    expect(response.status).toBe(200);
    expect(await signedIn(visit, cookie)).toBe(false);
  });
});
