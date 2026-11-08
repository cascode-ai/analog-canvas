import { expect, it } from "vitest";
import {
  accounts,
  config,
  secret,
  transportOrigin,
} from "./regional-auth.test-support";
import {
  adminOf,
  makerOf,
  ownerAccountOf,
  ORIGIN,
  route,
  submitOne,
} from "./gallery.test-support";
import { RegionalSessionDO } from "./regional-session";

it("immediately applies a domestic Gallery block and Owner unblock without restricting other account operations", async () => {
  const h = accounts();
  const member = await h.connect(await makerOf(h.source));
  const owner = await h.connect(await ownerAccountOf(h.source));
  const { user } = await (await h.call("/api/auth/me", member)).json();
  const sent: { to: string[]; text: string }[] = [];
  h.source.authDurable.fetchLike = async (input, init) => {
    expect(String(input)).toBe("https://api.resend.com/emails");
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "isolated-notice" });
  };
  const response = await h.region.fetch(
    new Request("https://auth/internal/block-account", {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        entryId: "ww5fnfambz",
        kind: "script",
        path: "/api/gallery/ww5fnfambz",
      }),
    }),
  );
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ blocked: true });
  expect(sent).toHaveLength(2);
  expect(
    (await (await h.call("/api/auth/me", member)).json()).user,
  ).toMatchObject({ id: user.id, blocked: true });
  expect((await h.call("/api/auth/blocked", member)).status).toBe(403);
  const record = await (await h.call("/api/auth/blocked", owner)).json();
  expect(record.blocked).toEqual([
    expect.objectContaining({ userId: user.id }),
  ]);
  expect(
    (
      await h.call("/api/auth/blocked/unblock", owner, "POST", {
        userId: user.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (await (await h.call("/api/auth/me", member)).json()).user,
  ).not.toHaveProperty("blocked");
});

it.each([
  [false, "unchanged"],
  [true, "unchanged"],
  [false, "changed-email"],
  [false, "deleted"],
] as const)(
  "projects retained email restrictions without merging providers or blocking an exempt Owner (Owner=%s, target=%s)",
  async (exempt, targetState) => {
    const h = accounts({
      GOOGLE_CLIENT_ID: "isolated",
      GOOGLE_CLIENT_SECRET: "isolated",
    });
    const ownerSource = await ownerAccountOf(h.source);
    const primary = await h.connect(
      exempt ? ownerSource : await makerOf(h.source),
    );
    const owner = await h.connect(ownerSource);
    const email = exempt ? "zhishuai@example.com" : "maker@example.com";
    const googleSignIn = async (email: string) => {
      h.source.authDurable.fetchLike = async (input) =>
        String(input).startsWith("https://oauth2.googleapis.com/")
          ? Response.json({ access_token: "isolated-google-token" })
          : Response.json({
              sub: "isolated-google-user",
              email,
              email_verified: true,
              name: "Other provider",
            });
      const start = await h.source.authDurable.fetch(
        new Request(ORIGIN + "/api/auth/google/start"),
      );
      const state = new URL(start.headers.get("location")!).searchParams.get(
        "state",
      );
      const callback = await h.source.authDurable.fetch(
        new Request(
          ORIGIN + "/api/auth/google/callback?code=isolated&state=" + state,
          { headers: { cookie: "icm_oauth_state=" + state } },
        ),
      );
      return callback.headers
        .getSetCookie()
        .find((value) => value.startsWith("icm_session="))!
        .split(";")[0]!;
    };
    const googleCookie = await googleSignIn(email);
    const secondary = await h.connect(googleCookie);
    const userOf = async (cookie: string) =>
      (await (await h.call("/api/auth/me", cookie)).json()).user;
    const first = await userOf(primary),
      second = await userOf(secondary);
    expect(first.id).not.toBe(second.id);
    expect(second.provider).toBe("google");
    h.source.authDurable.fetchLike = async () =>
      Response.json({ id: "isolated-notice" });
    const block = await h.region.fetch(
      new Request("https://auth/internal/block-account", {
        method: "POST",
        body: JSON.stringify({
          userId: second.id,
          entryId: "ww5fnfambz",
          kind: "script",
        }),
      }),
    );
    expect(block.status).toBe(200);
    expect((await userOf(secondary)).blocked).toBe(true);
    expect(Boolean((await userOf(primary)).blocked)).toBe(!exempt);
    if (targetState === "changed-email") {
      await googleSignIn("new-address@example.com");
    } else if (targetState === "deleted") {
      const deletion = await h.source.authDurable.fetch(
        new Request(ORIGIN + "/api/auth/account/delete", {
          method: "POST",
          headers: { origin: ORIGIN, cookie: googleCookie },
          body: JSON.stringify({ confirm: "delete-account" }),
        }),
      );
      expect(deletion.status).toBe(200);
    }
    expect(
      (
        await h.call("/api/auth/blocked/unblock", owner, "POST", {
          userId: second.id,
        })
      ).status,
    ).toBe(200);
    expect(await userOf(primary)).not.toHaveProperty("blocked");
    if (targetState !== "deleted")
      expect(await userOf(secondary)).not.toHaveProperty("blocked");
  },
);

it("does not report a confirmed restriction when the authority omits its projection", async () => {
  const h = accounts();
  const member = await h.connect(await makerOf(h.source));
  const { user } = await (await h.call("/api/auth/me", member)).json();
  const bridge = h.region.fetchLike;
  h.source.authDurable.fetchLike = async () =>
    Response.json({ id: "isolated-notice" });
  h.region.fetchLike = async (input, init) => {
    const response = await bridge(input, init);
    const body = await response.json();
    delete body.restrictions;
    return Response.json(body);
  };
  expect(
    (
      await h.region.fetch(
        new Request("https://auth/internal/block-account", {
          method: "POST",
          body: JSON.stringify({
            userId: user.id,
            entryId: "ww5fnfambz",
            kind: "script",
          }),
        }),
      )
    ).status,
  ).toBe(503);
});

it("keeps the newest restriction across delayed renewals, delayed unblock replies and a regional restart", async () => {
  const h = accounts();
  const member = await h.connect(await makerOf(h.source));
  const owner = await h.connect(await ownerAccountOf(h.source));
  const { user } = await (await h.call("/api/auth/me", member)).json();
  h.source.authDurable.fetchLike = async () =>
    Response.json({ id: "isolated-notice" });
  const block = () =>
    h.region.fetch(
      new Request("https://auth/internal/block-account", {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          entryId: "ww5fnfambz",
          kind: "script",
        }),
      }),
    );
  const bridge = h.region.fetchLike;
  const captured = Promise.withResolvers<void>(),
    released = Promise.withResolvers<void>();
  h.region.fetchLike = async (input, init) => {
    const response = await bridge(input, init);
    if (String(input).endsWith("/renew")) {
      captured.resolve();
      await released.promise;
    }
    return response;
  };
  h.advance(30_000);
  const renewal = h.region.alarm();
  await captured.promise;
  expect((await block()).status).toBe(200);
  released.resolve();
  await renewal;
  expect(
    (await (await h.call("/api/auth/me", member)).json()).user.blocked,
  ).toBe(true);
  const unblocked = Promise.withResolvers<void>(),
    unblockReply = Promise.withResolvers<void>();
  h.region.fetchLike = async (input, init) => {
    const response = await bridge(input, init);
    if (String(input).endsWith("/account")) {
      unblocked.resolve();
      await unblockReply.promise;
    }
    return response;
  };
  const unblock = h.call("/api/auth/blocked/unblock", owner, "POST", {
    userId: user.id,
  });
  await unblocked.promise;
  expect((await block()).status).toBe(200);
  unblockReply.resolve();
  expect((await unblock).status).toBe(200);
  const restarted = new RegionalSessionDO(h.state, {
    AUTH_REGIONAL_CLIENT: config,
  });
  restarted.now = h.region.now;
  const response = await restarted.fetch(
    new Request(ORIGIN + "/api/auth/me", { headers: { cookie: member } }),
  );
  expect((await response.json()).user.blocked).toBe(true);
});

it("sends a domestic moderator's rejection through the account authority without exposing its email provider", async () => {
  const h = accounts();
  const member = await h.connect(await makerOf(h.source));
  const admin = await h.connect(await adminOf(h.source));
  const id = await submitOne(h.resources, "Regional publication", {
    cookie: member,
  });
  const sent: { to: string[]; text: string }[] = [];
  h.source.authDurable.fetchLike = async (input, init) => {
    expect(String(input)).toBe("https://api.resend.com/emails");
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "isolated-rejection" });
  };
  const reject = (cookie: string) =>
    route(
      h.resources,
      new Request(ORIGIN + "/api/gallery/" + id + "/reject", {
        method: "POST",
        headers: { origin: ORIGIN, cookie, "content-type": "application/json" },
        body: JSON.stringify({
          reason: "Please fix the missing source",
          notify: true,
        }),
      }),
    );
  expect((await reject(member)).status).toBe(401);
  expect(sent).toHaveLength(0);
  const rejected = await reject(admin);
  expect(rejected.status).toBe(200);
  expect(await rejected.json()).toMatchObject({ emailed: true });
  expect(sent).toHaveLength(1);
  expect(sent[0]).toMatchObject({ to: ["maker@example.com"] });
  expect(sent[0]?.text).toContain("Please fix the missing source");
});

it.each([
  ["ordinary", "python-requests/2.32"],
  ["escaped evidence", "python-requests/" + "\\".repeat(9000)],
])(
  "enforces a confirmed block on the next domestic Gallery write, never a read (%s)",
  async (_label, userAgent) => {
    const h = accounts();
    const member = await h.connect(await makerOf(h.source));
    h.source.authDurable.fetchLike = async () =>
      Response.json({ id: "isolated-block-notice" });
    const { user } = await (await h.call("/api/auth/me", member)).json();
    const blocked = await h.region.fetch(
      new Request("https://auth/internal/block-account", {
        method: "POST",
        body: JSON.stringify({
          userId: user.id,
          entryId: "ww5fnfambz",
          kind: "script",
          path: "/api/gallery/ww5fnfambz",
          userAgent: userAgent.slice(0, 512),
        }),
      }),
    );
    expect(await blocked.json()).toEqual({ blocked: true });
    const request = (path: string, method = "GET") =>
      route(
        h.resources,
        new Request(ORIGIN + path, {
          method,
          headers: { cookie: member, origin: ORIGIN, "user-agent": userAgent },
        }),
      );
    // Gallery reads are everyone's; its writes are refused.
    expect((await request("/api/gallery")).status).toBe(200);
    const write = await request("/api/gallery/ww5fnfambz/like", "POST");
    expect(write.status).toBe(403);
    expect(await write.json()).toMatchObject({ error: "account-blocked" });
    expect(
      (await (await h.call("/api/auth/me", member)).json()).user,
    ).toMatchObject({ blocked: true });
    expect(
      (
        await h.call("/api/auth/profile", member, "POST", {
          displayName: "Still my account",
        })
      ).status,
    ).toBe(200);
  },
);

it("limits security forwarding to the authenticated service and exact internal operations", async () => {
  const h = accounts();
  const owner = await h.connect(await ownerAccountOf(h.source));
  const rpc = (path: string, authorization = "Bearer " + secret) =>
    h.source.authDurable.fetch(
      new Request(transportOrigin + "/api/auth/regional/security", {
        method: "POST",
        headers: { authorization },
        body: JSON.stringify({ path, body: {} }),
      }),
    );
  expect((await rpc("/internal/block-notices", "")).status).toBe(401);
  for (const path of [
    "/api/auth/owner-tokens",
    "/internal/session-user",
    "https://attacker.test/internal/block-notices",
    "/internal/block-account?user=owner",
    "/internal/block-notices/",
  ])
    expect((await rpc(path)).status).toBe(404);
  expect(
    (
      await h.call("/api/auth/regional/security", owner, "POST", {
        path: "/internal/block-notices",
        body: {},
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await h.region.fetch(
        new Request(ORIGIN + "/internal/block-notices", {
          method: "POST",
          headers: { cookie: owner, origin: ORIGIN },
        }),
      )
    ).status,
  ).toBe(404);
  expect(
    (await h.region.fetch(new Request("https://auth/internal/block-notices")))
      .status,
  ).toBe(421);
  h.region.fetchLike = async () =>
    new Response(null, {
      status: 307,
      headers: { location: "https://attacker.test/" },
    });
  expect(
    (
      await h.region.fetch(
        new Request("https://auth/internal/block-notices", { method: "POST" }),
      )
    ).status,
  ).toBe(503);
});

it.each([
  [{}, 400, "invalid-block"],
  [
    { userId: "unknown-account", entryId: "ww5fnfambz", kind: "script" },
    404,
    "not-found",
  ],
] as const)(
  "preserves the authority's permanent rejection for %j",
  async (body, status, error) => {
    const h = accounts();
    const response = await h.region.fetch(
      new Request("https://auth/internal/block-account", {
        method: "POST",
        body: JSON.stringify(body),
      }),
    );
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  },
);

it("keeps block notices retryable at the authority and Owner recovery actions scoped", async () => {
  const h = accounts();
  const member = await h.connect(await makerOf(h.source));
  const owner = await h.connect(await ownerAccountOf(h.source));
  const admin = await h.connect(await adminOf(h.source));
  const { user } = await (await h.call("/api/auth/me", member)).json();
  let online = false;
  const sent: { to: string[]; text: string }[] = [];
  h.source.authDurable.fetchLike = async (_input, init) => {
    if (!online)
      return Response.json({ error: "provider-unavailable" }, { status: 503 });
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "isolated-notice" });
  };
  const internal = (path: string, body?: unknown) =>
    h.region.fetch(
      new Request("https://auth/internal/" + path, {
        method: "POST",
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  expect(
    (
      await internal("block-account", {
        userId: user.id,
        entryId: "ww5fnfambz",
        kind: "script",
      })
    ).status,
  ).toBe(200);
  online = true;
  expect(await (await internal("block-notices")).json()).toEqual({ sent: 2 });
  expect(await (await internal("block-notices")).json()).toEqual({ sent: 0 });
  for (const cookie of [member, admin]) {
    expect((await h.call("/api/auth/blocked", cookie)).status).toBe(403);
    for (const action of ["unblock", "notify", "apology"])
      expect(
        (
          await h.call("/api/auth/blocked/" + action, cookie, "POST", {
            userId: user.id,
            subject: "Sorry",
            text: "Incorrect block",
          })
        ).status,
      ).toBe(403);
  }
  expect(
    (
      await h.call("/api/auth/blocked/unblock", owner, "POST", {
        userId: user.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await h.call("/api/auth/blocked/apology", owner, "POST", {
        userId: user.id,
        subject: "Sorry",
        text: "Incorrect block",
      })
    ).status,
  ).toBe(200);
  expect(sent).toHaveLength(3);
  expect(sent[2]).toMatchObject({
    to: ["maker@example.com"],
    text: "Incorrect block",
  });
  expect(
    (
      await h.call("/api/auth/blocked/apology", owner, "POST", {
        userId: user.id,
        subject: "Sorry",
        text: "Incorrect block",
      })
    ).status,
  ).toBe(409);
});
