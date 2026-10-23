import { parseProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";

import {
  isReservedGalleryId,
  withoutReservedEntries,
} from "../apps/editor/src/gallery-reserved-ids";
import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  ownerAccountOf,
  route,
  submitOne,
} from "./gallery.test-support";
import { ensureAccountBlockTables } from "./account-blocks";

/** Emails the AuthDO sends from now on: recipient, subject and text. */
function outbox(env: Harness, ok = true) {
  const sent: { to: string[]; subject: string; text: string }[] = [];
  env.authDurable.fetchLike = (async (_input: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return ok
      ? Response.json({ id: "email-1" })
      : new Response("down", { status: 503 });
  }) as typeof fetch;
  return sent;
}

async function wall(env: Harness, headers: HeadersInit) {
  const response = await route(
    env,
    new Request(`${ORIGIN}/api/gallery`, { headers }),
  );
  return {
    status: response.status,
    ...((await response.json()) as { entries?: { id: string }[] }),
  };
}

async function sevenCircuits(env: Harness) {
  const admin = await adminOf(env);
  for (let index = 0; index < 7; index += 1)
    await submitOne(env, `Circuit ${index}`, { cookie: admin });
}

const trapFrom = (entries: { id: string }[]) =>
  entries.find((entry) => isReservedGalleryId(entry.id))!;

describe("trap circuits", () => {
  it("mix one into a member's list page, which the client drops, and none into the Owner's or a curator's", async () => {
    const env = environment();
    await sevenCircuits(env);
    const member = await wall(env, cookieHeaders(await makerOf(env)));
    expect(member.entries).toHaveLength(8);
    expect(trapFrom(member.entries!)).toBeDefined();
    expect(withoutReservedEntries(member.entries!)).toHaveLength(7);

    for (const cookie of [await adminOf(env), await ownerAccountOf(env)]) {
      const exempt = await wall(env, cookieHeaders(cookie));
      expect(exempt.entries).toHaveLength(7);
    }
    // The read credential (backups) meets none either.
    expect((await wall(env, {})).entries).toHaveLength(7);
  });

  it("block the member who reads one, keep who it was and email the Owner", async () => {
    const env = environment();
    await sevenCircuits(env);
    const maker = await makerOf(env);
    const trap = trapFrom((await wall(env, cookieHeaders(maker))).entries!);
    const sent = outbox(env);

    const read = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${trap.id}`, {
        headers: {
          Cookie: maker,
          "cf-connecting-ip": "198.51.100.23",
          "cf-ipcountry": "NL",
          "user-agent": "python-requests/2.32",
        },
      }),
    );
    // An ordinary-looking circuit, so the program reading it does not stop.
    expect(read.status).toBe(200);
    const { projectText } = (await read.json()) as { projectText: string };
    expect(parseProject(projectText).documents.length).toBeGreaterThan(0);

    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["zzhishuai@ethz.ch"]);
    expect(sent[0]!.subject).toContain("maker@example.com");
    expect(sent[0]!.text).toContain("198.51.100.23");
    expect(sent[0]!.text).toContain("python-requests/2.32");

    // Every later Gallery request of the account is refused.
    const after = await wall(env, cookieHeaders(maker));
    expect(after.status).toBe(403);
    expect(after).toMatchObject({ error: "account-blocked" });

    const owner = await ownerAccountOf(env);
    const records = (await (
      await env.authDurable.fetch(
        new Request(`${ORIGIN}/api/auth/blocked`, {
          headers: cookieHeaders(owner),
        }),
      )
    ).json()) as { blocked: Record<string, unknown>[] };
    expect(records.blocked).toEqual([
      expect.objectContaining({
        email: "maker@example.com",
        entryId: trap.id,
        ip: "198.51.100.23",
        country: "NL",
        userAgent: "python-requests/2.32",
        notifiedAt: expect.any(String),
        unblockedAt: null,
        reason: "script",
      }),
    ]);
    // Nobody else reads or lifts them.
    expect(
      (
        await env.authDurable.fetch(
          new Request(`${ORIGIN}/api/auth/blocked`, {
            headers: cookieHeaders(await adminOf(env)),
          }),
        )
      ).status,
    ).toBe(403);

    const userId = (records.blocked[0] as { userId: string }).userId;
    const lifted = await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/blocked/unblock`, {
        method: "POST",
        headers: { Origin: ORIGIN, Cookie: owner },
        body: JSON.stringify({ userId }),
      }),
    );
    expect(await lifted.json()).toEqual({ unblocked: true });
    expect((await wall(env, cookieHeaders(maker))).status).toBe(200);
  });

  it("never block the Owner, not even by a block recorded under the Owner's email", async () => {
    const env = environment();
    await sevenCircuits(env);
    const owner = await ownerAccountOf(env);
    // Another account under the Owner's email (a second sign-in method) was
    // blocked; the block holds by email, but never against the Owner.
    ensureAccountBlockTables(env.authSql);
    env.authSql.exec(
      `INSERT INTO account_blocks
         (user_id, email, display_name, provider, blocked_at, entry_id, path, reason)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      "github:second-sign-in",
      "zhishuai@example.com",
      "Second sign-in",
      "github",
      new Date().toISOString(),
      "trap",
      "/api/gallery/trap",
      "script",
    );
    expect((await wall(env, cookieHeaders(owner))).status).toBe(200);
  });

  it("block a browser only once it has read two different traps' circuits in a day, never for a preview", async () => {
    const env = environment();
    await sevenCircuits(env);
    const browser = {
      Cookie: await makerOf(env),
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/155.0.0.0 Safari/537.36 Edg/155.0.0.0",
    };
    const read = (path: string) =>
      route(env, new Request(`${ORIGIN}${path}`, { headers: browser }));
    const sent = outbox(env);
    // A page left open across a deploy shows trap tiles and loads their
    // previews by itself (2026-10-22); its reader opened one circuit, twice.
    await read("/api/gallery/ww5fnfambz/preview.svg");
    await read("/api/gallery/s93tzkszt6/preview.svg");
    await read("/api/gallery/s93tzkszt6?summary=1");
    for (let time = 0; time < 2; time += 1)
      expect((await read("/api/gallery/ww5fnfambz")).status).toBe(200);
    expect((await wall(env, browser)).status).toBe(200);
    expect(sent).toHaveLength(0);

    // A second trap's circuit is no accident.
    await read("/api/gallery/s93tzkszt6");
    expect((await wall(env, browser)).status).toBe(403);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.text).toContain("2 个不同蜜罐");
  });

  it("let the Owner apologise once to an account unblocked after a mistake", async () => {
    const env = environment();
    await sevenCircuits(env);
    const maker = await makerOf(env);
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/ww5fnfambz`, {
        headers: cookieHeaders(maker),
      }),
    );
    const owner = await ownerAccountOf(env);
    const ownerPost = (route: string, body: unknown, cookie = owner) =>
      env.authDurable.fetch(
        new Request(`${ORIGIN}/api/auth/blocked/${route}`, {
          method: "POST",
          headers: { Origin: ORIGIN, Cookie: cookie },
          body: JSON.stringify(body),
        }),
      );
    const [record] = (
      (await (
        await env.authDurable.fetch(
          new Request(`${ORIGIN}/api/auth/blocked`, {
            headers: cookieHeaders(owner),
          }),
        )
      ).json()) as { blocked: { userId: string }[] }
    ).blocked;
    const apology = {
      userId: record!.userId,
      subject: "Your Analog Canvas Gallery access is restored",
      text: "Dear user, …",
    };
    // Not while the account is still blocked, and never by anyone else.
    expect((await ownerPost("apology", apology)).status).toBe(409);
    await ownerPost("unblock", { userId: record!.userId });
    expect((await ownerPost("apology", apology, maker)).status).toBe(403);

    const sent = outbox(env);
    expect(await (await ownerPost("apology", apology)).json()).toEqual({
      sent: true,
    });
    expect(sent).toEqual([
      expect.objectContaining({
        to: ["maker@example.com"],
        subject: apology.subject,
        text: apology.text,
        reply_to: "zzhishuai@ethz.ch",
      }),
    ]);
    // Once per block.
    expect((await ownerPost("apology", apology)).status).toBe(409);
    expect(sent).toHaveLength(1);
  });

  it("answer a curator as a missing circuit and block nobody", async () => {
    const env = environment();
    await sevenCircuits(env);
    const trap = trapFrom(
      (await wall(env, cookieHeaders(await makerOf(env)))).entries!,
    );
    const admin = await adminOf(env);
    const sent = outbox(env);
    const read = await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${trap.id}`, {
        headers: cookieHeaders(admin),
      }),
    );
    expect(read.status).toBe(404);
    expect(sent).toHaveLength(0);
    expect((await wall(env, cookieHeaders(admin))).status).toBe(200);
  });

  it("send the Owner's notice again on the next tick when the first fails", async () => {
    const env = environment();
    await sevenCircuits(env);
    const maker = await makerOf(env);
    const trap = trapFrom((await wall(env, cookieHeaders(maker))).entries!);
    outbox(env, false);
    await route(
      env,
      new Request(`${ORIGIN}/api/gallery/${trap.id}/preview.svg`, {
        headers: cookieHeaders(maker),
      }),
    );
    expect((await wall(env, cookieHeaders(maker))).status).toBe(403);
    const sent = outbox(env);
    const retried = await env.authDurable.fetch(
      new Request("https://auth/internal/block-notices", { method: "POST" }),
    );
    expect(await retried.json()).toEqual({ sent: 1 });
    expect(sent[0]!.subject).toContain("maker@example.com");
  });
});
