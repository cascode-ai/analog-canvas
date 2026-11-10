import { afterEach, expect, it, vi } from "vitest";
import egress from "./egress.mjs";

const env = {
  PEER_ORIGIN: "https://project-peer.test",
  IDENTITY_URL: "https://canvas-origin.test/api/auth/regional/identities",
};
afterEach(() => vi.unstubAllGlobals());

it("delivers analytics batches only to the fixed peer and refuses management destinations", async () => {
  const requests=[];
  vi.stubGlobal("fetch",async request=>{requests.push(request.url);return Response.json({accepted:true});});
  expect((await egress.fetch(new Request("https://project-peer.test/api/analytics-sync/receive",{method:"POST",body:"{}"}),env)).status).toBe(200);
  expect((await egress.fetch(new Request("https://other.test/api/analytics-sync/receive",{method:"POST",body:"{}"}),env)).status).toBe(403);
  expect((await egress.fetch(new Request("https://project-peer.test/api/analytics-sync/activate",{method:"POST",body:"{}"}),env)).status).toBe(403);
  expect(requests).toEqual(["https://project-peer.test/api/analytics-sync/receive"]);
});

it.each([undefined, "Canvas-acceptance-client/1"])(
  "identifies service requests without replacing an existing User-Agent (%s)",
  async (userAgent) => {
    vi.stubGlobal("fetch", async (request) => {
      expect(request.headers.get("user-agent")).toBe(
        userAgent ??
          "Analog-Canvas-Regional/1 (+https://analog-canvas.tokenzhang.com)",
      );
      return new Response("ok");
    });
    const headers = userAgent ? { "user-agent": userAgent } : {};
    const response = await egress.fetch(
      new Request(env.IDENTITY_URL, { method: "POST", headers }),
      env,
    );
    expect(response.status).toBe(200);
  },
);

it.each(["account", "owner-token", "security"])(
  "forwards the configured %s service RPC with its credential and body",
  async (operation) => {
    const url = `https://canvas-origin.test/api/auth/regional/${operation}`;
    const body = JSON.stringify({ opaque: "isolated-rpc-payload" });
    vi.stubGlobal("fetch", async (request) => {
      expect(request.url).toBe(url);
      expect(request.method).toBe("POST");
      expect(request.redirect).toBe("manual");
      expect(request.headers.get("authorization")).toBe("Bearer isolated");
      expect(await request.text()).toBe(body);
      return Response.json({ error: "unauthorized" }, { status: 401 });
    });
    const result = await egress.fetch(
      new Request(url, {
        method: "POST",
        headers: {
          Authorization: "Bearer isolated",
          "Content-Type": "application/json",
        },
        body,
      }),
      env,
    );
    expect(result.status).toBe(401);
    expect(await result.json()).toEqual({ error: "unauthorized" });
  },
);

it("returns the fixed authority's browser redirect without following it or losing cookies", async () => {
  const url =
    "https://canvas-origin.test/api/auth/google/callback?code=opaque&state=bound";
  const response = new Response(null, {
    status: 302,
    headers: {
      Location: "https://canvas.test/api/auth/regional/authorize?state=bound",
    },
  });
  response.headers.append("set-cookie", "icm_session=source; Path=/; HttpOnly");
  response.headers.append("set-cookie", "icm_oauth_state=; Path=/; Max-Age=0");
  vi.stubGlobal("fetch", async (request) => {
    expect(request.url).toBe(url);
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("cookie")).toBe("icm_oauth_state=bound");
    expect(request.headers.get("origin")).toBe("https://canvas.test");
    return response;
  });
  const result = await egress.fetch(
    new Request(url, {
      headers: {
        Cookie: "icm_oauth_state=bound",
        Origin: "https://canvas.test",
      },
    }),
    env,
  );
  expect(result.status).toBe(302);
  expect(result.headers.get("location")).toBe(response.headers.get("location"));
  expect(result.headers.getSetCookie()).toEqual(
    response.headers.getSetCookie(),
  );
});

it("keeps service redirects closed even when they contain an apparent identity", async () => {
  vi.stubGlobal("fetch", async (request) => {
    expect(request.redirect).toBe("manual");
    return Response.json(
      { user: { id: "untrusted" } },
      {
        status: 307,
        headers: { Location: "https://unconfigured.test/collect" },
      },
    );
  });
  for (const [method, url] of [
    ["GET", env.PEER_ORIGIN + "/api/project-sync/status"],
    ["POST", env.PEER_ORIGIN + "/api/project-sync/events"],
    ["POST", env.PEER_ORIGIN + "/api/project-sync/quota"],
    ["POST", env.IDENTITY_URL],
    ["POST", "https://canvas-origin.test/api/auth/regional/exchange"],
    ["POST", "https://canvas-origin.test/api/auth/regional/renew"],
    ["POST", "https://canvas-origin.test/api/auth/regional/account"],
    ["POST", "https://canvas-origin.test/api/auth/regional/owner-token"],
    ["POST", "https://canvas-origin.test/api/auth/regional/security"],
  ]) {
    const result = await egress.fetch(new Request(url, { method }), env);
    expect(result.status, url).toBe(502);
    expect(await result.text()).toBe("Regional redirect refused");
    expect(result.headers.has("location")).toBe(false);
  }
});

it.each([
  ["GET", "https://unconfigured.test/api/auth/google/start"],
  ["GET", env.PEER_ORIGIN + "/api/auth/google/start"],
  ["POST", "https://canvas-origin.test/api/auth/google/start"],
  ["GET", "https://canvas-origin.test/api/auth/google/start/"],
  ["GET", "https://canvas-origin.test/api/auth/me"],
  ["POST", "https://canvas-origin.test/api/auth/logout"],
  ["POST", "https://canvas-origin.test/api/auth/profile"],
  ["GET", "https://canvas-origin.test/api/auth/regional/account"],
  ["GET", "https://canvas-origin.test/api/auth/regional/owner-token"],
  ["GET", "https://canvas-origin.test/api/auth/regional/security"],
  ["POST", "https://unconfigured.test/api/auth/regional/security"],
  ["POST", "https://canvas-origin.test/api/auth/regional/security?override=1"],
  ["POST", "https://unconfigured.test/api/auth/regional/account"],
  ["POST", "https://canvas-origin.test/api/auth/regional/account?override=1"],
  ["GET", "https://canvas-origin.test/api/auth/regional/callback?code=x"],
  ["GET", "https://canvas-origin.test/api/auth/regional/start"],
  ["POST", env.IDENTITY_URL + "?redirect=https://unconfigured.test"],
  ["GET", "http://canvas-origin.test/api/auth/google/start"],
])(
  "refuses a request outside the pinned egress policy: %s %s",
  async (method, url) => {
    const network = vi.fn(() => {
      throw new Error("Unexpected network request");
    });
    vi.stubGlobal("fetch", network);
    expect((await egress.fetch(new Request(url, { method }), env)).status).toBe(
      403,
    );
    expect(network).not.toHaveBeenCalled();
  },
);
