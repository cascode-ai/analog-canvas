import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import {
  adminOf,
  environment,
  makerOf,
  ownerAccountOf,
  ORIGIN,
  seatOf,
  type Harness,
} from "./gallery.test-support";

const secret = "isolated-source-authority-client-secret";
const clientOrigin = "http://localhost:18082";

function source(transportOrigin?: string) {
  return environment({
    AUTH_REGIONAL_AUTHORITY: JSON.stringify({
      origin: ORIGIN,
      clientOrigin,
      secret,
      transportOrigin,
    }),
  });
}

function call(
  h: Harness,
  path: string,
  cookie = "",
  method = "GET",
  body?: unknown,
) {
  return h.authDurable.fetch(
    new Request(ORIGIN + path, {
      method,
      headers: { cookie, origin: ORIGIN, "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    }),
  );
}

function rpc(h: Harness, action: string, body: unknown, credential = secret) {
  return h.authDurable.fetch(
    new Request(ORIGIN + "/api/auth/regional/" + action, {
      method: "POST",
      headers: {
        authorization: "Bearer " + credential,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
    }),
  );
}

async function connect(h: Harness, cookie: string) {
  const verifier = "v".repeat(43);
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const response = await call(
    h,
    "/api/auth/regional/authorize?" +
      new URLSearchParams({ state: "s".repeat(43), challenge }),
    cookie,
  );
  expect(response.status).toBe(302);
  const callback = new URL(response.headers.get("location")!);
  expect(callback.origin).toBe(clientOrigin);
  const exchange = await rpc(h, "exchange", {
    code: callback.searchParams.get("code"),
    verifier,
  });
  expect(exchange.status).toBe(200);
  return exchange.json() as Promise<{ grant: string; user: { id: string } }>;
}

it("uses the source grant for profile changes without accepting another account or browser credentials", async () => {
  const h = source();
  const cookie = await makerOf(h);
  const { grant, user } = await connect(h, cookie);
  const operation = {
    grant,
    method: "POST",
    path: "/api/auth/profile",
    body: { displayName: "Regional maker", userId: "another-account" },
  };
  expect((await rpc(h, "account", operation, "wrong-secret")).status).toBe(401);
  const response = await rpc(h, "account", operation);
  expect(response.status).toBe(200);
  expect(response.headers.getSetCookie()).toEqual([]);
  expect(await response.json()).toMatchObject({
    result: { status: 200 },
    user: { id: user.id, displayName: "Regional maker" },
  });
  expect(await (await call(h, "/api/auth/me", cookie)).json()).toMatchObject({
    user: { id: user.id, displayName: "Regional maker" },
  });
  expect(
    (
      await rpc(h, "account", {
        ...operation,
        path: "/api/auth/account/delete",
      })
    ).status,
  ).toBe(404);
  expect(
    (await rpc(h, "account", { ...operation, grant: "x".repeat(43) })).status,
  ).toBe(401);
  await call(h, "/api/auth/logout", cookie, "POST");
  expect((await rpc(h, "account", operation)).status).toBe(401);
});

it("keeps role management at the source and refreshes the existing member grant", async () => {
  const h = source();
  const admin = await connect(h, await adminOf(h));
  const member = await connect(h, await makerOf(h));
  const operation = {
    method: "POST",
    path: "/api/auth/users/role",
    body: { email: "maker@example.com", role: "moderator" },
  };
  expect(
    await (
      await rpc(h, "account", { ...operation, grant: member.grant })
    ).json(),
  ).toMatchObject({ result: { status: 401 } });
  expect(
    await (
      await rpc(h, "account", { ...operation, grant: admin.grant })
    ).json(),
  ).toMatchObject({ result: { status: 200 } });
  expect(
    await (await rpc(h, "renew", { grant: member.grant })).json(),
  ).toMatchObject({
    user: { id: member.user.id, role: "moderator", isAdmin: false },
  });
  expect(
    await (
      await rpc(h, "account", {
        grant: member.grant,
        method: "GET",
        path: "/api/auth/admin/stats",
      })
    ).json(),
  ).toMatchObject({ result: { status: 401 } });
});

it("validates Owner import tokens without a cached revocation or browser session", async () => {
  const h = source();
  const owner = await connect(h, await ownerAccountOf(h));
  const member = await connect(h, await makerOf(h));
  const operation = {
    method: "POST",
    path: "/api/auth/owner-tokens",
    body: { label: "Regional import" },
  };
  expect(
    await (
      await rpc(h, "account", { ...operation, grant: member.grant })
    ).json(),
  ).toMatchObject({ result: { status: 403 } });
  const minted = await (
    await rpc(h, "account", { ...operation, grant: owner.grant })
  ).json();
  expect(minted.result.status).toBe(201);
  const { id, token } = minted.result.body;
  const validation = await rpc(h, "owner-token", { token });
  expect(validation.status).toBe(200);
  expect(validation.headers.getSetCookie()).toEqual([]);
  expect(await validation.json()).toMatchObject({
    user: { id: owner.user.id, isOwner: true },
  });
  expect((await rpc(h, "owner-token", { token }, "wrong-secret")).status).toBe(
    401,
  );
  const revoked = await rpc(h, "account", {
    grant: owner.grant,
    method: "DELETE",
    path: "/api/auth/owner-tokens/" + id,
  });
  expect(await revoked.json()).toMatchObject({ result: { status: 200 } });
  expect((await rpc(h, "owner-token", { token })).status).toBe(401);
  expect(await (await call(h, "/api/auth/me")).json()).toEqual({ user: null });
});

it("switches only the regional grant and returns to the verified administrator", async () => {
  const h = source();
  const cookie = await adminOf(h);
  const { grant, user: actor } = await connect(h, cookie);
  const listed = await (
    await rpc(h, "account", {
      grant,
      method: "GET",
      path: "/api/auth/ai-accounts",
    })
  ).json();
  const seat = listed.result.body.accounts[0];
  const operation = (path: string, body?: unknown) =>
    rpc(h, "account", {
      grant,
      method: "POST",
      path: "/api/auth/" + path,
      body,
    });
  const switched = await operation("ai-accounts/switch", { userId: seat.id });
  expect(switched.headers.getSetCookie()).toEqual([]);
  expect(await switched.json()).toMatchObject({
    result: { status: 200 },
    user: { id: seat.id, isAdmin: false, switchedFrom: { id: actor.id } },
  });
  expect(await (await call(h, "/api/auth/me", cookie)).json()).toMatchObject({
    user: { id: actor.id, isAdmin: true },
  });
  expect(
    await (
      await operation("users/role", {
        email: "maker@example.com",
        role: "moderator",
      })
    ).json(),
  ).toMatchObject({ result: { status: 401 } });
  expect(await (await rpc(h, "renew", { grant })).json()).toMatchObject({
    user: { id: seat.id, switchedFrom: { id: actor.id } },
  });
  expect(await (await operation("ai-accounts/return")).json()).toMatchObject({
    result: { status: 200 },
    user: { id: actor.id, isAdmin: true },
  });
});

it("requires the original actor when a switched overseas AI account starts handoff", async () => {
  const h = source();
  const cookie = await seatOf(h);
  const response = await call(
    h,
    "/api/auth/regional/authorize?" +
      new URLSearchParams({ state: "s".repeat(43), challenge: "c".repeat(43) }),
    cookie,
  );
  expect(response.status).toBe(409);
  expect(await response.json()).toEqual({ error: "original-actor-required" });
  expect(
    (await (await call(h, "/api/auth/me", cookie)).json()).user.seat,
  ).toBeTruthy();
});

it("keeps the optional transport alias limited to configured login and authenticated RPC routes", async () => {
  const transportOrigin = "https://authority.test";
  const h = source(transportOrigin);
  const cookie = await makerOf(h);
  const { grant } = await connect(h, cookie);
  const transport = (
    origin: string,
    path: string,
    method: string,
    body?: unknown,
  ) =>
    h.authDurable.fetch(
      new Request(origin + path, {
        method,
        headers: { authorization: "Bearer " + secret, cookie, origin: ORIGIN },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  expect(
    (
      await transport(transportOrigin, "/api/auth/regional/renew", "POST", {
        grant,
      })
    ).status,
  ).toBe(200);
  expect(
    (
      await transport(
        "https://unconfigured.test",
        "/api/auth/regional/renew",
        "POST",
        { grant },
      )
    ).status,
  ).toBe(421);
  expect(
    (
      await transport(transportOrigin, "/api/auth/account/delete", "POST", {
        confirm: "delete-account",
      })
    ).status,
  ).toBe(404);
  expect(
    (
      await transport(transportOrigin, "/internal/gallery-rejection", "POST", {
        entryName: "any",
        reason: "any",
      })
    ).status,
  ).toBe(404);
  expect((await transport(transportOrigin, "/api/auth/me", "GET")).status).toBe(
    404,
  );
  expect(
    (await (await call(h, "/api/auth/me", cookie)).json()).user,
  ).not.toBeNull();
});
