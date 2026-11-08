import { afterEach, expect, it, vi } from "vitest";
import egress from "./egress.mjs";
import {
  accounts,
  config,
  transportOrigin,
} from "../../../worker/regional-auth.test-support.ts";
import {
  makerOf,
  ownerAccountOf,
  ORIGIN,
  route,
} from "../../../worker/gallery.test-support.ts";

afterEach(() => vi.unstubAllGlobals());

it("discovers the authority's enabled sign-in providers through standalone egress", async () => {
  const h = accounts({
    GH_OAUTH_CLIENT_ID: "github-test",
    GH_OAUTH_CLIENT_SECRET: "secret",
    GOOGLE_CLIENT_ID: "google-test",
    GOOGLE_CLIENT_SECRET: "secret",
  });
  vi.stubGlobal("fetch", (request) => h.source.authDurable.fetch(request));
  h.region.fetchLike = (input, init) =>
    egress.fetch(new Request(input, init), {
      PEER_ORIGIN: transportOrigin,
      IDENTITY_URL: transportOrigin + "/api/auth/regional/identities",
    });
  const response = await h.call("/api/auth/providers", "");
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({
    github: true,
    google: true,
    email: true,
    central: true,
  });
});

it("enforces a Gallery block on writes and Owner recovery through the standalone egress policy", async () => {
  const h = accounts();
  const network = vi.fn((request) => {
    expect(new URL(request.url).origin).toBe(transportOrigin);
    return h.source.authDurable.fetch(request);
  });
  vi.stubGlobal("fetch", network);
  h.region.fetchLike = (input, init) =>
    egress.fetch(new Request(input, init), {
      PEER_ORIGIN: transportOrigin,
      IDENTITY_URL: transportOrigin + "/api/auth/regional/identities",
    });
  const member = await h.connect(await makerOf(h.source));
  const owner = await h.connect(await ownerAccountOf(h.source));
  h.source.authDurable.fetchLike = async () =>
    Response.json({ id: "isolated-block-notice" });
  const { user } = await (await h.call("/api/auth/me", member)).json();
  const blocking = await h.region.fetch(
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
  expect(await blocking.json()).toEqual({ blocked: true });
  const request = (path, method = "GET") =>
    route(
      h.resources,
      new Request(ORIGIN + path, {
        method,
        headers: { cookie: member, origin: ORIGIN },
      }),
    );
  // A blocked account still reads the Gallery; its writes are refused.
  expect((await request("/api/gallery?tag=amplifier")).status).toBe(200);
  const blocked = await request("/api/gallery/ww5fnfambz/like", "POST");
  expect(blocked.status).toBe(403);
  expect(await blocked.json()).toMatchObject({ error: "account-blocked" });
  expect(
    (
      await h.call("/api/auth/blocked/unblock", owner, "POST", {
        userId: user.id,
      })
    ).status,
  ).toBe(200);
  expect(
    (await request("/api/gallery/ww5fnfambz/like", "POST")).status,
  ).not.toBe(403);
  expect(
    network.mock.calls.map(([request]) => new URL(request.url).pathname),
  ).toContain("/api/auth/regional/security");
});

it("pulls and acknowledges a deletion through the configured authority transport", async () => {
  const enabled = JSON.stringify({
    ...JSON.parse(config),
    accountDeletion: true,
  });
  const h = accounts(
    { AUTH_REGIONAL_AUTHORITY: enabled },
    { AUTH_REGIONAL_CLIENT: enabled },
  );
  vi.stubGlobal("fetch", (request) => h.source.authDurable.fetch(request));
  h.region.fetchLike = (input, init) =>
    egress.fetch(new Request(input, init), {
      PEER_ORIGIN: transportOrigin,
      IDENTITY_URL: transportOrigin + "/api/auth/regional/identities",
    });
  const original = await makerOf(h.source);
  const cookie = await h.connect(original);
  const requestId = crypto.randomUUID();
  const path = "/api/auth/account/delete";
  expect(
    (
      await h.call(path, cookie, "POST", {
        requestId,
        confirm: "delete-account",
      })
    ).status,
  ).toBe(202);
  expect(
    (
      await h.region.fetch(
        new Request("https://auth/internal/account-deletion-tick", {
          method: "POST",
        }),
      )
    ).status,
  ).toBe(200);
  const progress = await h.call(path, "", "POST", {
    requestId,
    statusOnly: true,
  });
  expect(await progress.json()).toMatchObject({ deletion: { cn: "complete" } });
});
