import { afterEach, expect, it, vi } from "vitest";
import entry from "./regional-entry";
import { RegionalSessionDO } from "./regional-session";
import {
  environment,
  makerOf,
  ORIGIN,
  sqliteState,
} from "./gallery.test-support";

afterEach(() => vi.unstubAllGlobals());

const transport = "https://canvas-origin.test";

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
      headers: { Cookie: overseasCookie },
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
