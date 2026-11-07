import { afterEach, expect, it, vi } from "vitest";
import egress from "./egress.mjs";
import {
  accounts,
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

it("enforces a Gallery block and Owner recovery through the standalone egress policy", async () => {
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
  const read = (path) =>
    route(
      h.resources,
      new Request(ORIGIN + path, {
        headers: { cookie: member, "user-agent": "python-requests/2.32" },
      }),
    );
  expect((await read("/api/gallery/ww5fnfambz")).status).toBe(200);
  const blocked = await read("/api/gallery");
  expect(blocked.status).toBe(403);
  expect(await blocked.json()).toMatchObject({ error: "account-blocked" });
  expect(
    (
      await h.call("/api/auth/blocked/unblock", owner, "POST", {
        userId: user.id,
      })
    ).status,
  ).toBe(200);
  expect((await read("/api/gallery?tag=amplifier")).status).toBe(200);
  expect(
    network.mock.calls.map(([request]) => new URL(request.url).pathname),
  ).toContain("/api/auth/regional/security");
});
