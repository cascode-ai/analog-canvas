import { afterEach, expect, it, vi } from "vitest";
import entry from "./regional-entry";
import canvas from "./index";
import { regionalRuntimeBindings } from "./regional-entry.test-support";
import { RegionalSessionDO } from "./regional-session";
import {
  environment,
  adminOf,
  makerOf,
  ORIGIN,
  sqliteState,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

const transport = "https://canvas-origin.test";

it("reports native memory readiness only to the private loopback probe", async () => {
  const { target } = proxyEnvironment();
  const url = "http://127.0.0.1/__regional/health";
  vi.stubGlobal("gc", undefined);
  expect((await entry.fetch(new Request(url), target)).status).toBe(503);
  vi.stubGlobal("gc", () => {});
  const ready = await entry.fetch(new Request(url), target);
  expect(ready.status).toBe(200);
  expect(await ready.json()).toMatchObject({
    ready: true,
    memory: { enabled: true },
  });
  expect(
    (await entry.fetch(new Request(ORIGIN + "/__regional/health"), target))
      .status,
  ).toBe(404);
  expect(
    (
      await entry.fetch(
        new Request(url, { headers: { "x-real-ip": "192.0.2.1" } }),
        target,
      )
    ).status,
  ).toBe(404);
});

it("rejects an oversized Arena command without waiting for the unread forward body", async () => {
  const { target, requests } = proxyEnvironment();
  const result = await Promise.race([
    entry.fetch(
      new Request(`${ORIGIN}/api/arena/votes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(70_000) }),
      }),
      target,
    ),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 1_000)),
  ]);
  expect(result?.status).toBe(413);
  expect(requests).toHaveLength(0);
});

async function localLogin(
  target: ReturnType<typeof proxyEnvironment>["target"],
  cookie: string,
) {
  const start = await entry.fetch(
    new Request(`${ORIGIN}/api/auth/regional/start`),
    target,
  );
  const pending = start.headers.get("set-cookie")!.split(";")[0]!;
  const authorized = await entry.fetch(
    new Request(start.headers.get("location")!, {
      headers: { Cookie: cookie },
    }),
    target,
  );
  const completed = await entry.fetch(
    new Request(authorized.headers.get("location")!, {
      headers: { Cookie: `${cookie}; ${pending}` },
    }),
    target,
  );
  const local = completed.headers
    .getSetCookie()
    .find((value) => value.startsWith("icm_regional_session="))!
    .split(";")[0]!;
  return `${cookie}; ${local}`;
}

it("completes the Arena browser-bound sign-in handoff through domestic Canvas", async () => {
  const { source, target } = proxyEnvironment();
  const cookie = await localLogin(target, await makerOf(source));
  const begin = await source.authDurable.fetch(
    new Request(
      "https://chip-arena.com/api/auth/handoff/begin?return=/schematic",
    ),
  );
  const binding = begin.headers.get("set-cookie")!.split(";")[0]!;
  const ask = new URL(begin.headers.get("location")!);
  const handoff = await entry.fetch(
    new Request(ORIGIN + ask.pathname + ask.search, {
      headers: { Cookie: cookie },
    }),
    target,
  );
  expect(handoff.status).toBe(302);
  const complete = await source.authDurable.fetch(
    new Request(handoff.headers.get("location")!, {
      headers: { Cookie: binding },
    }),
  );
  expect(complete.status).toBe(302);
  expect(complete.headers.get("location")).toBe(
    "https://chip-arena.com/schematic",
  );
  expect(
    complete.headers
      .getSetCookie()
      .some((value) => value.startsWith("icm_session=")),
  ).toBe(true);
  await entry.fetch(
    new Request(`${ORIGIN}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: ORIGIN },
    }),
    target,
  );
  const signedOut = await entry.fetch(
    new Request(ORIGIN + ask.pathname + ask.search, {
      headers: { Cookie: cookie },
    }),
    target,
  );
  expect(signedOut.headers.get("location")).toBe(
    "https://chip-arena.com/schematic",
  );
});

it("reaches Arena through the authority's verified account without a domestic Arena binding", async () => {
  const { source, target } = proxyEnvironment();
  const cookie = await localLogin(target, await adminOf(source));
  const account = (
    await (
      await source.authDurable.fetch(
        new Request(`${ORIGIN}/api/auth/me`, {
          headers: { Cookie: cookie },
        }),
      )
    ).json()
  ).user;
  const forwarded: Request[] = [];
  const transmitted: Request[] = [];
  const authority = {
    ...source,
    ...regionalRuntimeBindings(),
    AUTH: source.AUTH!,
    AUTH_REGIONAL_AUTHORITY: target.AUTH_REGIONAL_CLIENT,
    ARENA: {
      fetch: async (arenaRequest: Request) => {
        forwarded.push(arenaRequest);
        return Response.json({ accepted: true });
      },
    },
  };
  const network = vi.fn(async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(new URL(request.url).origin).toBe(transport);
    expect(request.redirect).toBe("manual");
    expect(request.headers.has("x-arena-account")).toBe(false);
    if (new URL(request.url).pathname.startsWith("/api/arena/")) {
      // Cloudflare sees the domestic server's connection, not the visitor's.
      request.headers.set("cf-connecting-ip", "203.0.113.99");
      transmitted.push(request.clone());
    }
    return canvas.fetch(request, authority);
  });
  vi.stubGlobal("fetch", network);
  const response = await entry.fetch(
    new Request(`${ORIGIN}/api/arena/votes?retry=1`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: ORIGIN,
        "Content-Type": "application/json",
        "x-arena-account": '{"id":"forged"}',
      },
      body: JSON.stringify({ battleId: "battle", choice: "a" }),
    }),
    target,
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ accepted: true });
  expect(forwarded).toHaveLength(1);
  expect(JSON.parse(forwarded[0]!.headers.get("x-arena-account")!).id).toBe(
    account.id,
  );
  expect(forwarded[0]!.headers.get("cookie") ?? "").not.toContain(
    "icm_session=",
  );
  expect(forwarded[0]!.headers.has("cf-connecting-ip")).toBe(false);
  expect(forwarded[0]!.url).toBe(`${ORIGIN}/api/arena/votes?retry=1`);
  expect(await forwarded[0]!.json()).toEqual({
    battleId: "battle",
    choice: "a",
  });
  const altered = await canvas.fetch(
    new Request(transmitted[0]!, {
      body: JSON.stringify({ battleId: "battle", choice: "b" }),
    }),
    authority,
  );
  expect(altered.status).toBe(401);
  expect(forwarded).toHaveLength(1);
  const anonymous = await entry.fetch(
    new Request(`${ORIGIN}/api/arena/session`),
    target,
  );
  expect(anonymous.status).toBe(200);
  expect(forwarded[1]!.headers.has("x-arena-account")).toBe(false);
  const seats = await (
    await entry.fetch(
      new Request(`${ORIGIN}/api/auth/ai-accounts`, {
        headers: { Cookie: cookie },
      }),
      target,
    )
  ).json();
  const seat = seats.accounts[0];
  const switched = await entry.fetch(
    new Request(`${ORIGIN}/api/auth/ai-accounts/switch`, {
      method: "POST",
      headers: {
        Cookie: cookie,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ userId: seat.id }),
    }),
    target,
  );
  expect(switched.status).toBe(200);
  await entry.fetch(
    new Request(`${ORIGIN}/api/arena/session`, { headers: { Cookie: cookie } }),
    target,
  );
  expect(JSON.parse(forwarded.at(-1)!.headers.get("x-arena-account")!).id).toBe(
    seat.id,
  );
  await entry.fetch(
    new Request(`${ORIGIN}/api/auth/logout`, {
      method: "POST",
      headers: { Cookie: cookie, Origin: ORIGIN },
    }),
    target,
  );
  await entry.fetch(
    new Request(`${ORIGIN}/api/arena/session`, { headers: { Cookie: cookie } }),
    target,
  );
  expect(forwarded.at(-1)!.headers.has("x-arena-account")).toBe(false);
});

function proxyEnvironment() {
  const config = JSON.stringify({
    origin: ORIGIN,
    clientOrigin: ORIGIN,
    transportOrigin: transport,
    secret: "regional-proxy-isolated-service-credential",
  });
  const source = environment({
    AUTH_REGIONAL_AUTHORITY: config,
    GH_OAUTH_CLIENT_ID: "isolated-github-id",
    GH_OAUTH_CLIENT_SECRET: "isolated-github-secret",
    GOOGLE_CLIENT_ID: "isolated-google-id",
    GOOGLE_CLIENT_SECRET: "isolated-google-secret",
  });
  const state = sqliteState();
  const localAuth = new RegionalSessionDO(
    { storage: { ...state.storage, setAlarm: async () => {} } },
    { AUTH_REGIONAL_CLIENT: config },
  );
  const target = {
    ...environment(),
    ...regionalRuntimeBindings(),
    AUTH_REGIONAL_CLIENT: config,
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          localAuth.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
  };
  const requests: Request[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo, init?: RequestInit) => {
    const request = new Request(input, init);
    expect(request.redirect).toBe("manual");
    expect(new URL(request.url).origin).toBe(transport);
    requests.push(request.clone());
    // Cloudflare rejects client-supplied CF-Connecting-IP before the authority.
    if (request.headers.has("cf-connecting-ip"))
      return new Response("error code: 1000", { status: 403 });
    return source.authDurable.fetch(request);
  });
  return { source, target, requests };
}

it("hands off through the fixed authority while keeping the shared browser origin and both sessions", async () => {
  const { source, target, requests } = proxyEnvironment();
  const overseasCookie = await makerOf(source);
  const start = await entry.fetch(
    new Request(`${ORIGIN}/api/auth/regional/start?return=/editor`),
    target,
  );
  expect(start.status).toBe(302);
  const pending = start.headers.get("set-cookie")!.split(";")[0]!;
  const authorizeUrl = new URL(start.headers.get("location")!);
  expect(authorizeUrl.origin).toBe(ORIGIN);
  const authorized = await entry.fetch(
    new Request(authorizeUrl, {
      headers: { Cookie: overseasCookie, "X-Real-IP": "203.0.113.7" },
    }),
    target,
  );
  expect(authorized.status).toBe(302);
  const callbackUrl = new URL(authorized.headers.get("location")!);
  expect(callbackUrl.origin).toBe(ORIGIN);
  expect(callbackUrl.pathname).toBe("/api/auth/regional/callback");
  const callback = await entry.fetch(
    new Request(callbackUrl, {
      headers: { Cookie: `${overseasCookie}; ${pending}` },
    }),
    target,
  );
  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe(ORIGIN + "/editor");
  const localCookie = callback.headers
    .getSetCookie()
    .find((value) => value.startsWith("icm_regional_session="))!
    .split(";")[0]!;
  const cookies = `${overseasCookie}; ${localCookie}`;
  const me = await entry.fetch(
    new Request(`${ORIGIN}/api/auth/me`, { headers: { Cookie: cookies } }),
    target,
  );
  const sourceMe = () =>
    source.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/me`, {
        headers: { Cookie: overseasCookie },
      }),
    );
  expect((await me.json()).user.id).toBe(
    (await (await sourceMe()).json()).user.id,
  );
  const profile = await entry.fetch(
    new Request(`${ORIGIN}/api/auth/profile`, {
      method: "POST",
      headers: {
        Cookie: cookies,
        Origin: ORIGIN,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ displayName: "Regional maker" }),
    }),
    target,
  );
  expect(profile.status).toBe(200);
  expect((await (await sourceMe()).json()).user.displayName).toBe(
    "Regional maker",
  );
  expect(
    (
      await entry.fetch(
        new Request(`${ORIGIN}/api/auth/logout`, {
          method: "POST",
          headers: { Cookie: cookies, Origin: ORIGIN },
        }),
        target,
      )
    ).status,
  ).toBe(200);
  expect((await (await sourceMe()).json()).user).not.toBeNull();
  expect(requests.map((request) => request.url)).toEqual([
    transport + authorizeUrl.pathname + authorizeUrl.search,
    transport + "/api/auth/regional/exchange",
    transport + "/api/auth/regional/account",
  ]);
});

it("preserves provider callbacks, cookies and same-origin email bodies through the browser proxy", async () => {
  const { source, target, requests } = proxyEnvironment();
  for (const provider of ["google", "github"]) {
    const start = await entry.fetch(
      new Request(`${ORIGIN}/api/auth/${provider}/start`),
      target,
    );
    expect(start.status).toBe(302);
    expect(
      new URL(start.headers.get("location")!).searchParams.get("redirect_uri"),
    ).toBe(`${ORIGIN}/api/auth/${provider}/callback`);
    expect(start.headers.get("set-cookie")).toContain("icm_oauth_state=");
    const callbackPath = `/api/auth/${provider}/callback?code=opaque%2Bcode&state=wrong`;
    const callback = await entry.fetch(
      new Request(ORIGIN + callbackPath, {
        headers: {
          Cookie: "icm_oauth_state=unmatched",
          Host: "localhost:8792",
        },
      }),
      target,
    );
    expect(callback.status).toBe(302);
    expect(requests.at(-1)!.url).toBe(transport + callbackPath);
    expect(requests.at(-1)!.headers.get("cookie")).toBe(
      "icm_oauth_state=unmatched",
    );
    expect(requests.at(-1)!.headers.has("host")).toBe(false);
  }
  let code = "";
  source.authDurable.fetchLike = async (_input, init) => {
    const mail = JSON.parse(String(init?.body)) as { text: string };
    code = /\b(\d{6})\b/u.exec(mail.text)![1]!;
    return Response.json({ id: "isolated-mail" });
  };
  const email = "regional-proxy@example.test";
  const emailRequest = (path: string, body: unknown, origin = ORIGIN) =>
    new Request(`${ORIGIN}/api/auth/email/${path}`, {
      method: "POST",
      headers: { Origin: origin, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await entry.fetch(emailRequest("start", { email }), target)).status,
  ).toBe(202);
  expect(requests.at(-1)!.headers.get("origin")).toBe(ORIGIN);
  expect(await requests.at(-1)!.json()).toEqual({ email });
  expect(code).toMatch(/^\d{6}$/);
  const verified = await entry.fetch(
    emailRequest("verify", { email, code }),
    target,
  );
  expect(verified.status).toBe(200);
  expect(verified.headers.get("set-cookie")).toContain("icm_session=");
  expect(
    (
      await entry.fetch(
        emailRequest("start", { email }, "https://foreign.test"),
        target,
      )
    ).status,
  ).toBe(403);
  expect(requests.at(-1)!.headers.get("origin")).toBe("https://foreign.test");
});

it.each([
  ["POST", "/api/auth/regional/authorize"],
  ["GET", "/api/auth/email/start"],
  ["GET", "/api/auth/google/start/"],
  ["POST", "/api/auth/regional/exchange"],
  ["POST", "/api/auth/regional/renew"],
  ["POST", "/api/auth/regional/identities"],
  ["POST", "/api/auth/regional/account"],
  ["POST", "/api/auth/regional/security"],
])(
  "does not turn another Auth route into an authority proxy: %s %s",
  async (method, path) => {
    const { target, requests } = proxyEnvironment();
    expect(
      (
        await entry.fetch(
          new Request(ORIGIN + path, {
            method,
            headers: { Origin: ORIGIN },
          }),
          target,
        )
      ).status,
    ).toBe(404);
    expect(requests).toHaveLength(0);
  },
);

it("requires a local session before forwarding an account operation", async () => {
  const { target, requests } = proxyEnvironment();
  const response = await entry.fetch(
    new Request(ORIGIN + "/api/auth/profile", {
      method: "POST",
      headers: { Origin: ORIGIN, "Content-Type": "application/json" },
      body: JSON.stringify({ displayName: "Unauthorized" }),
    }),
    target,
  );
  expect(response.status).toBe(401);
  expect(requests).toHaveLength(0);
});

it("refuses an untrusted incoming host and reports authority network failure without reflecting it", async () => {
  const { target, requests } = proxyEnvironment();
  expect(
    (
      await entry.fetch(
        new Request("https://foreign.test/api/auth/google/start"),
        target,
      )
    ).status,
  ).toBe(421);
  expect(requests).toHaveLength(0);
  vi.stubGlobal("fetch", async () => {
    throw new Error("private diagnostic");
  });
  const failed = await entry.fetch(
    new Request(ORIGIN + "/api/auth/google/start"),
    target,
  );
  expect(failed.status).toBe(502);
  expect(failed.headers.get("cache-control")).toBe("no-store");
  expect(await failed.json()).toEqual({ error: "authority-unavailable" });
});
