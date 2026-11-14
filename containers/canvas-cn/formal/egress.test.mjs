import { afterEach, expect, it, vi } from "vitest";
import egress from "./egress.mjs";

const env = {
  PEER_ORIGIN: "https://project-peer.test",
  IDENTITY_URL: "https://canvas-origin.test/api/auth/regional/identities",
};
afterEach(() => vi.unstubAllGlobals());

it("carries an Arena request and its sign-in handoff only to the fixed authority", async () => {
  const network = vi.fn(async (request) => {
    expect(request.redirect).toBe("manual");
    expect(request.headers.get("cookie")).toBe("icm_session=browser-session");
    if (new URL(request.url).pathname === "/api/auth/handoff")
      return new Response(null, {
        status: 302,
        headers: { Location: "https://chip-arena.com/schematic" },
      });
    expect(request.url).toBe(
      "https://canvas-origin.test/api/arena/votes?retry=1",
    );
    expect(await request.json()).toEqual({ battleId: "battle", choice: "a" });
    return Response.json({ error: "vote-refused" }, { status: 409 });
  });
  vi.stubGlobal("fetch", network);
  const headers = {
    Cookie: "icm_session=browser-session",
    "Content-Type": "application/json",
  };
  const vote = await egress.fetch(
    new Request("https://canvas-origin.test/api/arena/votes?retry=1", {
      method: "POST",
      headers,
      body: JSON.stringify({ battleId: "battle", choice: "a" }),
    }),
    env,
  );
  expect(vote.status).toBe(409);
  expect(await vote.json()).toEqual({ error: "vote-refused" });
  const handoff = await egress.fetch(
    new Request("https://canvas-origin.test/api/auth/handoff?binding=browser", {
      headers,
    }),
    env,
  );
  expect(handoff.status).toBe(302);
  expect(handoff.headers.get("location")).toBe(
    "https://chip-arena.com/schematic",
  );
  expect(network).toHaveBeenCalledTimes(2);
});

it("looks up only a Dataset writer at the fixed peer", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ known: true, origin: "cn" }),
  );
  expect(
    (
      await egress.fetch(
        new Request(
          "https://project-peer.test/api/resource-sync/analoggenie/location?id=ag-401",
        ),
        env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await egress.fetch(
        new Request(
          "https://project-peer.test/api/resource-sync/analoggenie/location?id=ag-401&url=https://other.test",
        ),
        env,
      )
    ).status,
  ).toBe(403);
});

it("carries owner command authorization only to the fixed identity endpoint", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ capability: "opaque" }));
  const path = "/api/auth/regional/owner-action-authorize";
  expect(
    (
      await egress.fetch(
        new Request("https://canvas-origin.test" + path, {
          method: "POST",
          body: "{}",
        }),
        env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await egress.fetch(
        new Request("https://project-peer.test" + path, {
          method: "POST",
          body: "{}",
        }),
        env,
      )
    ).status,
  ).toBe(403);
});

it("carries supported regional actions and their private catch-up without opening other peer paths", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: true }));
  for (const action of [
    "like",
    "review-resolution",
    "component",
    "publication",
    "board",
    "maintenance",
    "simulation-job",
    "topology-job",
  ]) {
    expect(
      (
        await egress.fetch(
          new Request(
            `https://project-peer.test/api/resource-actions/${action}`,
            { method: "POST", body: "{}" },
          ),
          env,
        )
      ).status,
    ).toBe(200);
  }
  for (const stream of [
    "components",
    "gallery-interactions",
    "analoggenie",
    "amsnet-interactions",
    "gallery-activity",
    "circuitthink-activity",
    "analogretriever-opens",
    "image2net-activity",
  ]) {
    expect(
      (
        await egress.fetch(
          new Request(
            `https://project-peer.test/api/resource-sync/${stream}/changes?after=12`,
          ),
          env,
        )
      ).status,
    ).toBe(200);
  }
  expect(
    (
      await egress.fetch(
        new Request("https://canvas-origin.test/api/auth/regional/bylines", {
          method: "POST",
          body: "{}",
        }),
        env,
      )
    ).status,
  ).toBe(200);
  for (const path of [
    "/api/resource-actions/unknown",
    "/api/resource-sync/unknown/changes?after=0",
    "/api/resource-sync/gallery/changes?after=0&url=https://other.test",
    "/api/resource-sync/gallery/receive",
  ]) {
    expect(
      (await egress.fetch(new Request("https://project-peer.test" + path), env))
        .status,
    ).toBe(403);
  }
});

it("allows narrow resource command authorization and ordered catch-up only at fixed peers", async () => {
  vi.stubGlobal("fetch", async () => Response.json({ ok: true }));
  expect(
    (
      await egress.fetch(
        new Request(
          "https://canvas-origin.test/api/auth/regional/action-authorize",
          { method: "POST", body: "{}" },
        ),
        env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await egress.fetch(
        new Request(
          "https://project-peer.test/api/resource-actions/lifecycle",
          { method: "POST", body: "{}" },
        ),
        env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await egress.fetch(
        new Request(
          "https://project-peer.test/api/resource-sync/gallery/changes?after=4",
        ),
        env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await egress.fetch(
        new Request(
          "https://project-peer.test/api/resource-sync/gallery/seed",
          { method: "POST" },
        ),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await egress.fetch(
        new Request("https://untrusted.test/api/resource-actions/lifecycle", {
          method: "POST",
        }),
        env,
      )
    ).status,
  ).toBe(403);
});

it("delivers analytics batches only to the fixed peer and refuses management destinations", async () => {
  const requests = [];
  vi.stubGlobal("fetch", async (request) => {
    requests.push(request.url);
    return Response.json({ accepted: true });
  });
  expect(
    (
      await egress.fetch(
        new Request("https://project-peer.test/api/analytics-sync/receive", {
          method: "POST",
          body: "{}",
        }),
        env,
      )
    ).status,
  ).toBe(200);
  expect(
    (
      await egress.fetch(
        new Request("https://other.test/api/analytics-sync/receive", {
          method: "POST",
          body: "{}",
        }),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await egress.fetch(
        new Request("https://project-peer.test/api/analytics-sync/activate", {
          method: "POST",
          body: "{}",
        }),
        env,
      )
    ).status,
  ).toBe(403);
  expect(requests).toEqual([
    "https://project-peer.test/api/analytics-sync/receive",
  ]);
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
  ["GET", "https://unconfigured.test/api/arena/session"],
  ["GET", env.PEER_ORIGIN + "/api/arena/session"],
  ["GET", "https://canvas-origin.test/api/arenas/session"],
  ["POST", "https://canvas-origin.test/api/canvas/account-deletion"],
  ["POST", "https://canvas-origin.test/api/auth/handoff"],
  ["GET", "https://canvas-origin.test/api/auth/handoff/complete"],
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

it("carries session credentials and upgrade headers only to the fixed Agent peer", async () => {
  const path =
    "/api/agent/region/12345678_caca0002-1111-8111-8111-111111111111/editor";
  const network = vi.fn(async (request) => {
    expect(request.headers.get("upgrade")).toBe("websocket");
    expect(request.headers.get("sec-websocket-protocol")).toBe("editor-proof");
    expect(request.headers.get("x-canvas-agent-peer")).toBe("peer-proof");
    return new Response(null, { status: 426 });
  });
  vi.stubGlobal("fetch", network);
  const headers = {
    upgrade: "websocket",
    "sec-websocket-protocol": "editor-proof",
    "x-canvas-agent-peer": "peer-proof",
  };
  expect(
    (await egress.fetch(new Request(env.PEER_ORIGIN + path, { headers }), env))
      .status,
  ).toBe(426);
  expect(
    (
      await egress.fetch(
        new Request("https://other.test" + path, { headers }),
        env,
      )
    ).status,
  ).toBe(403);
  expect(
    (
      await egress.fetch(
        new Request(env.PEER_ORIGIN + path.replace("/editor", "/create"), {
          headers,
        }),
        env,
      )
    ).status,
  ).toBe(403);
  expect(network).toHaveBeenCalledTimes(1);
});
