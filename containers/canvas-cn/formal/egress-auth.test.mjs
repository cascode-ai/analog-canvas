import { afterEach, expect, it, vi } from "vitest";
import egress from "./egress.mjs";
import {
  accounts,
  config,
  transportOrigin,
} from "../../../worker/regional-auth.test-support.ts";
import {
  adminOf,
  makerOf,
  ORIGIN,
  route,
  submitOne,
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

it("sends a moderator's rejection through the security RPC over standalone egress", async () => {
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
  const admin = await h.connect(await adminOf(h.source));
  const id = await submitOne(h.resources, "Regional publication", {
    cookie: member,
  });
  const sent = [];
  h.source.authDurable.fetchLike = async (_input, init) => {
    sent.push(JSON.parse(String(init?.body)));
    return Response.json({ id: "isolated-rejection" });
  };
  const rejected = await route(
    h.resources,
    new Request(ORIGIN + "/api/gallery/" + id + "/reject", {
      method: "POST",
      headers: {
        origin: ORIGIN,
        cookie: admin,
        "content-type": "application/json",
      },
      body: JSON.stringify({ reason: "Please fix the source", notify: true }),
    }),
  );
  expect(rejected.status).toBe(200);
  expect(await rejected.json()).toMatchObject({ emailed: true });
  expect(sent).toHaveLength(1);
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
