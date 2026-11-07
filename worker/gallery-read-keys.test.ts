import { afterEach, describe, expect, it, vi } from "vitest";
import { galleryReadKeyOf } from "./gallery-read-keys";
import {
  type Harness,
  ORIGIN,
  adminOf,
  environment,
  makerOf,
  ownerAccountOf,
  route,
  submitOne,
} from "./gallery.test-support";

afterEach(() => vi.restoreAllMocks());

/** The isolate's clock a minute on, so it asks the AuthDO about a key again. */
function aMinuteLater(): void {
  const now = Date.now() + 61_000;
  vi.spyOn(Date, "now").mockReturnValue(now);
}

/** The Owner's read-key routes, called from the Editor's own origin. */
async function keysOf(env: Harness) {
  const owner = await ownerAccountOf(env);
  const call = (
    path = "",
    init: RequestInit = {},
    cookie: string | null = owner,
  ) =>
    env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/read-keys${path}`, {
        ...init,
        headers: { Origin: ORIGIN, ...(cookie ? { Cookie: cookie } : {}) },
      }),
    );
  const mint = async (fields: Record<string, unknown> = {}) =>
    (await (
      await call("", {
        method: "POST",
        body: JSON.stringify({ label: "Lu Jie", ...fields }),
      })
    ).json()) as {
      id: string;
      token: string;
      scope: string;
      createdAt: string;
      expiresAt: string;
    };
  return { owner, call, mint };
}

const withKey = (token: string, init: RequestInit = {}) => ({
  ...init,
  headers: { Authorization: `Bearer ${token}` },
});
const get = (env: Harness, path: string, token: string) =>
  route(env, new Request(`${ORIGIN}${path}`, withKey(token)));

describe("read keys", () => {
  it("lets only the signed-in Owner mint, list and revoke them", async () => {
    const env = environment();
    const { call, mint } = await keysOf(env);
    const member = await makerOf(env);
    const admin = await adminOf(env);
    const post = (cookie: string | null, body: unknown) =>
      call("", { method: "POST", body: JSON.stringify(body) }, cookie);
    expect((await post(null, { label: "x" })).status).toBe(401);
    expect((await post(member, { label: "x" })).status).toBe(403);
    expect((await post(admin, { label: "x" })).status).toBe(403);
    for (const bad of [
      {},
      { label: " " },
      { label: "x".repeat(81) },
      { label: "x", scope: "write" },
      { label: "x", days: 0 },
      { label: "x", days: 366 },
      { label: "x", days: 1.5 },
    ])
      expect(
        (await call("", { method: "POST", body: JSON.stringify(bad) })).status,
      ).toBe(400);

    env.authDurable.now = () => new Date("2026-11-07T00:00:00.000Z");
    const made = await mint();
    expect(made.token).toMatch(/^acrk_[A-Za-z0-9_-]{43}$/u);
    expect(made).toMatchObject({
      scope: "gallery",
      createdAt: "2026-11-07T00:00:00.000Z",
      expiresAt: "2027-02-05T00:00:00.000Z",
    });
    env.authDurable.now = () => new Date("2026-11-08T00:00:00.000Z");
    const full = await mint({ label: "Owner's Mac", scope: "full", days: 30 });
    expect(full.expiresAt).toBe("2026-12-08T00:00:00.000Z");

    const listed = (await (await call()).json()) as {
      keys: { id: string; label: string; scope: string; uses: number }[];
    };
    expect(
      listed.keys.map(({ label, scope, uses }) => [label, scope, uses]),
    ).toEqual([
      ["Lu Jie", "gallery", 0],
      ["Owner's Mac", "full", 0],
    ]);
    expect(JSON.stringify(listed)).not.toContain(made.token);
    expect((await call("", {}, member)).status).toBe(403);
    // A key opens none of this.
    expect(
      (
        await env.authDurable.fetch(
          new Request(`${ORIGIN}/api/auth/read-keys`, withKey(made.token)),
        )
      ).status,
    ).toBe(401);

    expect(
      (await call(`/${made.id}`, { method: "DELETE" }, member)).status,
    ).toBe(403);
    expect((await call("/no-such-key", { method: "DELETE" })).status).toBe(404);
    expect(
      await (await call(`/${made.id}`, { method: "DELETE" })).json(),
    ).toEqual({
      revoked: made.id,
    });
    expect(
      ((await (await call()).json()) as { keys: { id: string }[] }).keys.map(
        (key) => key.id,
      ),
    ).toEqual([full.id]);
  });

  it("reads the Gallery without a session, and writes nothing", async () => {
    const env = environment();
    const { mint } = await keysOf(env);
    const id = await submitOne(env, "Keyed reads", {
      cookie: await adminOf(env),
    });
    const { token } = await mint();
    for (const path of [
      "/api/gallery?limit=5",
      "/api/gallery?q=keyed",
      "/api/gallery/tags",
      "/api/gallery/stats",
      `/api/gallery/${id}`,
      "/api/gallery/maintenance/netlists?format=spice",
    ])
      expect((await get(env, path, token)).status, path).toBe(200);
    const opened = (await (
      await get(env, `/api/gallery/${id}`, token)
    ).json()) as {
      projectText?: string;
    };
    expect(opened.projectText).toBeTruthy();
    // No reference figure yet: the read is allowed and finds none.
    expect((await get(env, `/api/gallery/${id}/reference`, token)).status).toBe(
      404,
    );

    const write = (path: string, method: string) =>
      route(
        env,
        new Request(`${ORIGIN}${path}`, withKey(token, { method, body: "{}" })),
      );
    expect((await write(`/api/gallery/${id}/like`, "POST")).status).toBe(401);
    expect((await write(`/api/gallery/${id}/reference`, "PUT")).status).toBe(
      401,
    );
    expect((await write(`/api/gallery/${id}/reviews`, "POST")).status).toBe(
      401,
    );
    expect(
      (await write(`/api/gallery/${id}`, "DELETE")).status,
    ).toBeGreaterThanOrEqual(400);
  });

  it("reads reviews and public history only with full scope", async () => {
    const env = environment();
    const { mint } = await keysOf(env);
    const id = await submitOne(env, "Reviewed", { cookie: await adminOf(env) });
    const gallery = await mint();
    const full = await mint({ label: "Owner's Mac", scope: "full" });
    const reviewPaths = [
      "/api/gallery/review/community/queue",
      "/api/gallery/review/community/people",
      "/api/gallery/review/community/issues",
      `/api/gallery/${id}/reviews`,
    ];
    for (const path of reviewPaths) {
      const refused = await get(env, path, gallery.token);
      expect(refused.status, path).toBe(403);
      expect(await refused.json()).toEqual({ error: "read-key-scope" });
      expect((await get(env, path, full.token)).status, path).toBe(200);
    }
    expect(
      (await get(env, `/api/gallery/${id}/versions`, gallery.token)).status,
    ).toBe(401);
    expect(
      (await get(env, `/api/gallery/${id}/versions`, full.token)).status,
    ).toBe(200);
  });

  it("stops at revocation or expiry, and counts its reads", async () => {
    const env = environment();
    const { call, mint } = await keysOf(env);
    const made = await mint({ days: 1 });
    expect((await get(env, "/api/gallery?limit=1", made.token)).status).toBe(
      200,
    );
    expect((await get(env, "/api/gallery?limit=1", made.token)).status).toBe(
      200,
    );
    // An isolate asks again a minute later and brings the reads it served.
    aMinuteLater();
    expect((await get(env, "/api/gallery?limit=1", made.token)).status).toBe(
      200,
    );
    const [listed] = (
      (await (await call()).json()) as {
        keys: { uses: number; lastUsedAt: string | null }[];
      }
    ).keys;
    expect(listed!.uses).toBe(3);
    expect(listed!.lastUsedAt).not.toBeNull();

    const later = Date.parse(made.expiresAt) + 1000;
    env.authDurable.now = () => new Date(later);
    aMinuteLater();
    expect((await get(env, "/api/gallery?limit=1", made.token)).status).toBe(
      401,
    );

    env.authDurable.now = () => new Date();
    const other = await mint();
    await call(`/${other.id}`, { method: "DELETE" });
    aMinuteLater();
    expect((await get(env, "/api/gallery?limit=1", other.token)).status).toBe(
      401,
    );
    expect(
      (await get(env, "/api/gallery?limit=1", `${other.token}x`)).status,
    ).toBe(401);
  });

  it("wakes the AuthDO only for a read key's prefix, once a minute", async () => {
    const env = environment();
    const { mint } = await keysOf(env);
    const { token } = await mint();
    let asked = 0;
    const counting = {
      AUTH: {
        getByName: (name: string) => {
          const stub = env.AUTH!.getByName(name);
          return {
            fetch: (input: RequestInfo, init?: RequestInit) => {
              asked += 1;
              return stub.fetch(input, init);
            },
          };
        },
      },
    } as Parameters<typeof galleryReadKeyOf>[1];
    const request = (authorization?: string) =>
      new Request(`${ORIGIN}/api/gallery`, {
        headers: authorization ? { Authorization: authorization } : {},
      });
    expect(await galleryReadKeyOf(request(), counting)).toBeNull();
    expect(
      await galleryReadKeyOf(request("Bearer something-else"), counting),
    ).toBeNull();
    expect(asked).toBe(0);
    const once = request(`Bearer ${token}`);
    expect((await galleryReadKeyOf(once, counting))?.scope).toBe("gallery");
    expect((await galleryReadKeyOf(once, counting))?.scope).toBe("gallery");
    expect(
      (await galleryReadKeyOf(request(`Bearer ${token}`), counting))?.label,
    ).toBe("Lu Jie");
    expect(asked).toBe(1);
  });

  it("goes with the Owner account that made it", async () => {
    const env = environment();
    const { owner, mint } = await keysOf(env);
    const { token } = await mint();
    const deleted = await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/account/delete`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: owner },
        body: JSON.stringify({ confirm: "delete-account" }),
      }),
    );
    expect(deleted.status).toBe(200);
    expect((await get(env, "/api/gallery?limit=1", token)).status).toBe(401);
  });
});
