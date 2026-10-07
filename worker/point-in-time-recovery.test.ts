import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import type { AuthEnv } from "./auth";
import { AuthDO, GalleryDO } from "./index";
import {
  routePointInTimeRecovery,
  type RecoverableState,
} from "./point-in-time-recovery";

const ORIGIN = "https://gallery.test";
const endpoint = `${ORIGIN}/api/admin/recovery`;

function sqliteState(): RecoverableState & {
  storage: {
    sql: { exec(query: string, ...bindings: unknown[]): any };
    transactionSync<T>(callback: () => T): T;
  };
} {
  const db = new DatabaseSync(":memory:");
  return {
    storage: {
      sql: {
        exec(query: string, ...bindings: unknown[]) {
          const statement = db.prepare(query);
          const values = bindings as (string | number | null)[];
          const rows = /^\s*(select|with|pragma)/iu.test(query)
            ? statement.all(...values)
            : (statement.run(...values), []);
          return { toArray: () => rows, one: () => rows[0] };
        },
      },
      transactionSync: (callback) => callback(),
    },
  };
}

/** The deployed stores, with Cloudflare's bookmark calls recorded on Gallery. */
function environment() {
  const calls: string[] = [];
  const galleryState = sqliteState();
  Object.assign(galleryState.storage, {
    getCurrentBookmark: async () => "bookmark-now",
    getBookmarkForTime: async (time: number) => {
      if (time < Date.parse("2026-09-01T00:00:00Z"))
        throw new Error("outside the retained history");
      calls.push(`lookup ${new Date(time).toISOString()}`);
      return `bookmark-${time}`;
    },
    onNextSessionRestoreBookmark: async (bookmark: string) => {
      calls.push(`arm ${bookmark}`);
      return "bookmark-before-restore";
    },
  });
  galleryState.abort = (reason) => {
    calls.push(`abort ${reason}`);
  };
  const gallery = new GalleryDO(galleryState);
  const auth = new AuthDO(sqliteState(), {
    RESEND_API_KEY: "rk",
    ADMIN_EMAILS: "owner@example.com",
  } as AuthEnv);
  const env = {
    GALLERY: {
      getByName: () => ({
        fetch: (input: string, init?: RequestInit) =>
          gallery.fetch(new Request(input, init)),
      }),
    },
    AUTH: {
      getByName: () => ({
        fetch: (input: Request | string, init?: RequestInit) =>
          auth.fetch(
            typeof input === "string" ? new Request(input, init) : input,
          ),
      }),
    },
  };
  return { env, calls, galleryState, auth };
}

async function signIn(
  auth: InstanceType<typeof AuthDO>,
  email: string,
): Promise<string> {
  let message = "";
  auth.fetchLike = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    message = (JSON.parse(String(init?.body)) as { text: string }).text;
    return Response.json({ id: "email-1" });
  }) as typeof fetch;
  const post = (path: string, body: unknown) =>
    auth.fetch(
      new Request(`${ORIGIN}/api/auth/email/${path}`, {
        method: "POST",
        headers: { Origin: ORIGIN, "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
  await post("start", { email });
  const code = /\b(\d{6})\b/u.exec(message)![1];
  const verified = await post("verify", { email, code });
  return verified.headers.get("set-cookie")!.split(";")[0]!;
}

const recover = async (env: object, request: Request) =>
  (await routePointInTimeRecovery(request, env))!;
const restore = (cookie: string, body: unknown, origin = ORIGIN) =>
  new Request(endpoint, {
    method: "POST",
    headers: { Cookie: cookie, Origin: origin },
    body: JSON.stringify(body),
  });
const request = {
  store: "gallery",
  bookmark: "bookmark-1",
  confirm: "restore gallery",
};

describe("point-in-time recovery", () => {
  it("looks a bookmark up for an administrator, arming nothing", async () => {
    const { env, calls, auth } = environment();
    const at = "2026-10-07T09:00:00.000Z";
    const query = `${endpoint}?store=gallery&at=${at}`;
    expect((await recover(env, new Request(query))).status).toBe(401);
    const member = await signIn(auth, "maker@example.com");
    expect(
      (await recover(env, new Request(query, { headers: { Cookie: member } })))
        .status,
    ).toBe(401);
    const admin = { Cookie: await signIn(auth, "owner@example.com") };
    const found = await recover(env, new Request(query, { headers: admin }));
    expect(found.status).toBe(200);
    expect(await found.json()).toEqual({
      store: "gallery",
      at,
      bookmark: `bookmark-${Date.parse(at)}`,
      current: "bookmark-now",
    });
    expect(calls).toEqual([`lookup ${at}`]);
    for (const path of [
      "?store=nowhere",
      "?store=gallery&at=not-a-time",
      "?store=gallery&at=2026-08-01T00:00:00Z",
    ])
      expect(
        (await recover(env, new Request(endpoint + path, { headers: admin })))
          .status,
        path,
      ).toBe(400);
  });

  it("restores only the store named in words, and answers how to undo it", async () => {
    const { env, calls, auth } = environment();
    const cookie = await signIn(auth, "owner@example.com");
    const unconfirmed = await recover(
      env,
      restore(cookie, { ...request, confirm: "yes" }),
    );
    expect(unconfirmed.status).toBe(400);
    expect(await unconfirmed.json()).toEqual({
      error: "confirmation-required",
      confirm: "restore gallery",
    });
    expect(
      (await recover(env, restore(cookie, request, "https://elsewhere.test")))
        .status,
    ).toBe(403);
    const member = await signIn(auth, "maker@example.com");
    expect((await recover(env, restore(member, request))).status).toBe(401);
    expect(calls).toEqual([]);
    const restored = await recover(env, restore(cookie, request));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      store: "gallery",
      restoredTo: "bookmark-1",
      undoBookmark: "bookmark-before-restore",
      restarted: false,
      current: "bookmark-now",
    });
    expect(calls).toEqual(["arm bookmark-1", "abort point-in-time recovery"]);
  });

  it("keeps the undo bookmark when the restart aborts and the object is slow to return", async () => {
    const { env, galleryState, auth } = environment();
    const cookie = await signIn(auth, "owner@example.com");
    // As in production: aborting fails the call that asked for it, and the
    // restarting object may not answer yet.
    galleryState.abort = () => {
      throw new Error("Durable Object reset");
    };
    galleryState.storage.getCurrentBookmark = async () => {
      throw new Error("object restarting");
    };
    const restored = await recover(env, restore(cookie, request));
    expect(restored.status).toBe(200);
    expect(await restored.json()).toEqual({
      store: "gallery",
      restoredTo: "bookmark-1",
      undoBookmark: "bookmark-before-restore",
      restarted: true,
      current: null,
    });
  });

  it("reaches the accounts store too, and says so when it keeps no history", async () => {
    const { env, auth } = environment();
    const admin = { Cookie: await signIn(auth, "owner@example.com") };
    const response = await recover(
      env,
      new Request(`${endpoint}?store=accounts`, { headers: admin }),
    );
    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({
      store: "accounts",
      error: "recovery-unavailable",
    });
  });
});
