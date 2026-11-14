import { afterEach, expect, it, vi } from "vitest";
import canvas from "./index";
import { accounts, config } from "./regional-auth.test-support";
import { makerOf, ORIGIN } from "./gallery.test-support";
import { regionalRuntimeBindings } from "./regional-entry.test-support";
import { adminOf } from "./gallery.test-support";
import { RegionalSessionDO } from "./regional-session";

afterEach(() => vi.unstubAllGlobals());

function browserRegions() {
  const auth = accounts();
  const cn = {
    ...auth.resources,
    ...regionalRuntimeBindings(),
    RESOURCE_REGION: "cn" as const,
    RESOURCE_ACTION_PEER: "https://overseas.test",
    RESOURCE_SYNC_TOKEN: "cn-session-secret",
    RESOURCE_SYNC_PEER_TOKEN: "overseas-session-secret",
  };
  const overseas = {
    ...auth.source,
    AUTH: auth.source.AUTH!,
    AUTH_REGIONAL_AUTHORITY: config,
    ...regionalRuntimeBindings(),
    RESOURCE_REGION: "overseas" as const,
    RESOURCE_ACTION_PEER: "https://cn.test",
    RESOURCE_SYNC_TOKEN: "overseas-session-secret",
    RESOURCE_SYNC_PEER_TOKEN: "cn-session-secret",
  };
  vi.stubGlobal(
    "fetch",
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const request = new Request(input, init);
      return canvas.fetch(
        request,
        new URL(request.url).hostname === "cn.test" ? cn : overseas,
      );
    },
  );
  const call = (
    region: typeof cn | typeof overseas,
    path: string,
    cookie = "",
    method = "GET",
    body?: unknown,
  ) =>
    canvas.fetch(
      new Request(ORIGIN + path, {
        method,
        headers: {
          cookie,
          origin: ORIGIN,
          "sec-fetch-site": "same-origin",
          "content-type": "application/json",
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
      region,
    );
  return { auth, cn, overseas, call };
}

it("keeps the browser's native and regional identities when its entry changes", async () => {
  const { auth, cn, overseas, call } = browserRegions();
  const native = await makerOf(auth.source);
  const expected = (await (await call(overseas, "/api/auth/me", native)).json())
    .user;
  expect((await (await call(cn, "/api/auth/me", native)).json()).user).toEqual(
    expected,
  );
  const regional = await auth.connect(native);
  expect(
    (await (await call(overseas, "/api/auth/me", regional)).json()).user,
  ).toEqual(expected);
  const profile = await call(overseas, "/api/auth/profile", regional, "POST", {
    displayName: "Same browser across regions",
  });
  expect(profile.status).toBe(200);
  expect(
    (await (await call(cn, "/api/auth/me", regional)).json()).user.displayName,
  ).toBe("Same browser across regions");
});

it("finishes a domestic handoff even when start and callback arrive overseas", async () => {
  const { auth, overseas, cn, call } = browserRegions();
  const native = await makerOf(auth.source);
  const start = await call(overseas, "/api/auth/regional/start?return=/editor");
  expect(start.status).toBe(302);
  const pending = start.headers.getSetCookie()[0]!.split(";")[0]!;
  const authorized = await auth.source.authDurable.fetch(
    new Request(start.headers.get("location")!, {
      headers: { cookie: native },
    }),
  );
  const callback = new URL(authorized.headers.get("location")!);
  const completed = await call(
    overseas,
    callback.pathname + callback.search,
    pending,
  );
  expect(completed.status).toBe(302);
  expect(completed.headers.get("location")).toBe(ORIGIN + "/editor");
  const regional = completed.headers
    .getSetCookie()
    .find((value) => value.startsWith("icm_regional_session="))!
    .split(";")[0]!;
  expect(
    (await (await call(cn, "/api/auth/me", regional)).json()).user,
  ).not.toBeNull();
});

it("signs out both presented sessions without ending another browser", async () => {
  const { auth, cn, overseas, call } = browserRegions();
  const native = await makerOf(auth.source),
    otherBrowser = await makerOf(auth.source);
  const regional = await auth.connect(native);
  const result = await call(
    cn,
    "/api/auth/logout",
    native + "; " + regional,
    "POST",
  );
  expect(result.status).toBe(200);
  expect(
    (await (await call(overseas, "/api/auth/me", native)).json()).user,
  ).toBeNull();
  expect(
    (await (await call(cn, "/api/auth/me", regional)).json()).user,
  ).toBeNull();
  expect(
    (await (await call(overseas, "/api/auth/me", otherBrowser)).json()).user,
  ).not.toBeNull();
});

it("replaces stale regional identity only after a successful explicit native sign-in", async () => {
  const { auth, cn, overseas, call } = browserRegions();
  const native = await makerOf(auth.source);
  const stale = "icm_regional_session=" + "x".repeat(43);
  expect(
    (await (await call(overseas, "/api/auth/me", native + "; " + stale)).json())
      .user,
  ).toBeNull();
  let code = "";
  auth.source.authDurable.fetchLike = async (_input, init) => {
    code = /\b(\d{6})\b/u.exec(JSON.parse(String(init?.body)).text)![1]!;
    return Response.json({ id: "isolated-mail" });
  };
  const email = "explicit-new@example.test";
  expect(
    (
      await call(
        overseas,
        "/api/auth/email/start",
        native + "; " + stale,
        "POST",
        { email },
      )
    ).status,
  ).toBe(202);
  const signedIn = await call(
    overseas,
    "/api/auth/email/verify",
    native + "; " + stale,
    "POST",
    { email, code },
  );
  expect(signedIn.status).toBe(200);
  expect(signedIn.headers.getSetCookie()).toContain(
    "icm_regional_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Secure",
  );
  const next = signedIn.headers
    .getSetCookie()
    .find((value) => value.startsWith("icm_session="))!
    .split(";")[0]!;
  expect((await (await call(cn, "/api/auth/me", next)).json()).user.email).toBe(
    email,
  );
});

it("keeps an AI effective actor across fallback and never borrows the native administrator", async () => {
  const { auth, cn, overseas, call } = browserRegions();
  const native = await adminOf(auth.source),
    regional = await auth.connect(native);
  const cookies = native + "; " + regional;
  const seats = (
    await (await call(cn, "/api/auth/ai-accounts", cookies)).json()
  ).accounts;
  expect(
    (
      await call(overseas, "/api/auth/ai-accounts/switch", cookies, "POST", {
        userId: seats[0].id,
      })
    ).status,
  ).toBe(200);
  const me = (await (await call(cn, "/api/auth/me", cookies)).json()).user;
  expect(me.id).toBe(seats[0].id);
  expect(me.isAdmin).toBe(false);
  expect(
    (await (await call(overseas, "/api/auth/me", cookies)).json()).user,
  ).toEqual(me);
  expect((await call(overseas, "/api/auth/owner-tokens", cookies)).status).toBe(
    403,
  );
  vi.stubGlobal("fetch", async () => {
    throw Error("owning region unreachable");
  });
  expect((await (await call(cn, "/api/auth/me", cookies)).json()).user).toEqual(
    me,
  );
  expect((await call(overseas, "/api/auth/me", cookies)).status).toBe(503);
});

it("reports incomplete logout and safely retries without reviving local authorization", async () => {
  const { auth, cn, overseas, call } = browserRegions();
  const native = await makerOf(auth.source),
    regional = await auth.connect(native);
  const cookies = native + "; " + regional;
  const transport = globalThis.fetch;
  vi.stubGlobal("fetch", async () => {
    throw Error("peer unavailable");
  });
  const failed = await call(cn, "/api/auth/logout", cookies, "POST");
  expect(failed.status).toBe(503);
  expect(failed.headers.getSetCookie()).toEqual([]);
  expect(
    (await (await call(cn, "/api/auth/me", cookies)).json()).user,
  ).toBeNull();
  vi.stubGlobal("fetch", transport);
  expect((await call(cn, "/api/auth/logout", cookies, "POST")).status).toBe(
    200,
  );
  expect(
    (await (await call(overseas, "/api/auth/me", native)).json()).user,
  ).toBeNull();
});

it("revokes a regional session's outstanding action authority when it signs out", async () => {
  const { auth, cn, call } = browserRegions();
  const native = await makerOf(auth.source),
    regional = await auth.connect(native);
  const binding = "a".repeat(43);
  const proof = await auth.region.fetch(
    new Request("https://auth/internal/resource-action-authorize", {
      method: "POST",
      headers: { cookie: regional },
      body: JSON.stringify({ binding }),
    }),
  );
  expect(proof.status).toBe(200);
  const { token } = await proof.json();
  auth.region.fetchLike = async () => {
    throw Error("authority unavailable");
  };
  expect((await call(cn, "/api/auth/logout", regional, "POST")).status).toBe(
    503,
  );
  expect(
    (await (await call(cn, "/api/auth/me", regional)).json()).user,
  ).toBeNull();
  const restarted = new RegionalSessionDO(auth.state, {
    AUTH_REGIONAL_CLIENT: config,
  });
  restarted.now = auth.region.now;
  restarted.fetchLike = async (input, init) =>
    auth.source.authDurable.fetch(new Request(input, init));
  await restarted.alarm();
  const verified = await auth.source.authDurable.fetch(
    new Request("https://auth/internal/resource-action-verify", {
      method: "POST",
      body: JSON.stringify({ token, binding }),
    }),
  );
  expect(verified.status).toBe(401);
  expect((await call(cn, "/api/auth/logout", regional, "POST")).status).toBe(
    200,
  );
});

it("rejects public peer forgery and refuses arbitrary internal routes or origins", async () => {
  const { overseas } = browserRegions();
  const rpc = (body: unknown, secret = "") =>
    canvas.fetch(
      new Request("https://overseas.test/api/auth/region/session", {
        method: "POST",
        headers: { "x-canvas-auth-peer": secret },
        body: JSON.stringify(body),
      }),
      overseas,
    );
  const request = {
    url: ORIGIN + "/api/auth/me",
    method: "GET",
    headers: {},
    user: { id: "owner", isAdmin: true },
  };
  expect((await rpc(request)).status).toBe(403);
  expect(
    (await (await rpc(request, "overseas-session-secret")).json()).user,
  ).toBeNull();
  expect(
    (
      await rpc(
        { ...request, url: "https://auth/internal/account-delete" },
        "overseas-session-secret",
      )
    ).status,
  ).toBe(404);
  expect(
    (
      await rpc(
        { ...request, url: "https://unconfigured.test/api/auth/me" },
        "overseas-session-secret",
      )
    ).status,
  ).toBe(404);
});
