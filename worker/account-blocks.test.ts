// Accounts blocked for collecting the Gallery in bulk (account-blocks.ts):
// the records the Owner reads, lifts and apologises for, and the notices.
// Gallery reads are everyone's, so a block refuses only Gallery writes.
import { describe, expect, it } from "vitest";

import {
  type Harness,
  ORIGIN,
  adminOf,
  cookieHeaders,
  environment,
  makerOf,
  ownerAccountOf,
  route,
} from "./gallery.test-support";
import { ensureAccountBlockTables } from "./account-blocks";

const TRAP_ID = "ww5fnfambz";

/** Emails the AuthDO sends from now on: recipient, subject and text. */
function outbox(env: Harness, ok = true) {
  const sent: {
    to: string[];
    subject: string;
    text: string;
    reply_to?: string;
  }[] = [];
  env.authDurable.fetchLike = (async (_input: unknown, init?: RequestInit) => {
    sent.push(JSON.parse(String(init?.body)));
    return ok
      ? Response.json({ id: "email-1" })
      : new Response("down", { status: 503 });
  }) as typeof fetch;
  return sent;
}

/** Record a block of the session's account, as the AuthDO takes one. */
async function block(
  env: Harness,
  cookie: string,
  evidence: Record<string, string> = {},
) {
  const { user } = (await (
    await env.authDurable.fetch(
      new Request(`${ORIGIN}/api/auth/me`, { headers: cookieHeaders(cookie) }),
    )
  ).json()) as { user: { id: string } };
  return env.authDurable.fetch(
    new Request("https://auth/internal/block-account", {
      method: "POST",
      body: JSON.stringify({
        userId: user.id,
        kind: "script",
        entryId: TRAP_ID,
        path: `/api/gallery/${TRAP_ID}`,
        ...evidence,
      }),
    }),
  );
}

/** A Gallery write (a like) and a Gallery read, as the account. */
const like = (env: Harness, cookie: string) =>
  route(
    env,
    new Request(`${ORIGIN}/api/gallery/${TRAP_ID}/like`, {
      method: "POST",
      headers: { Origin: ORIGIN, Cookie: cookie },
    }),
  );
const read = (env: Harness, cookie: string) =>
  route(
    env,
    new Request(`${ORIGIN}/api/gallery`, { headers: cookieHeaders(cookie) }),
  );

describe("account blocks", () => {
  it("block a member, keep who it was, email the Owner and the member, and refuse their Gallery writes alone", async () => {
    const env = environment();
    const maker = await makerOf(env);
    const sent = outbox(env);

    expect(
      await (
        await block(env, maker, {
          ip: "198.51.100.23",
          country: "NL",
          userAgent: "python-requests/2.32",
        })
      ).json(),
    ).toEqual({ blocked: true });

    expect(sent).toHaveLength(2);
    expect(sent[0]!.to).toEqual(["zzhishuai@ethz.ch"]);
    expect(sent[0]!.subject).toContain("maker@example.com");
    expect(sent[0]!.text).toContain("198.51.100.23");
    expect(sent[0]!.text).toContain("python-requests/2.32");
    // The member learns why, that a reply reaches the Owner, and that the
    // check is still being tested; never how it works.
    expect(sent[1]).toMatchObject({
      to: ["maker@example.com"],
      reply_to: "zzhishuai@ethz.ch",
    });
    expect(sent[1]!.text).toContain("reply to this email");
    expect(sent[1]!.text).toContain("still being tested");
    expect(sent[1]!.text).not.toContain(TRAP_ID);

    // The account's Gallery writes are refused; its reads are anyone's.
    const after = await like(env, maker);
    expect(after.status).toBe(403);
    expect(await after.json()).toMatchObject({ error: "account-blocked" });
    expect((await read(env, maker)).status).toBe(200);

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
        entryId: TRAP_ID,
        ip: "198.51.100.23",
        country: "NL",
        userAgent: "python-requests/2.32",
        notifiedAt: expect.any(String),
        memberNotifiedAt: expect.any(String),
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
    expect((await like(env, maker)).status).not.toBe(403);
  });

  it("never block the Owner, not even by a block recorded under the Owner's email", async () => {
    const env = environment();
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
    expect(await (await block(env, owner)).json()).toEqual({ blocked: false });
    expect((await like(env, owner)).status).not.toBe(403);
  });

  it("let the Owner apologise once to an account unblocked after a mistake", async () => {
    const env = environment();
    const maker = await makerOf(env);
    outbox(env);
    await block(env, maker);
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

  it("let the Owner tell the member of a block from before member notices, once", async () => {
    const env = environment();
    ensureAccountBlockTables(env.authSql);
    env.authSql.exec(
      `INSERT INTO account_blocks
         (user_id, email, display_name, provider, blocked_at, entry_id, path,
          notified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      "github:earlier",
      "earlier@example.com",
      "Earlier",
      "github",
      "2026-10-24T14:13:04.286Z",
      "trap",
      "/api/gallery/trap",
      "2026-10-24T14:13:05.000Z",
    );
    const owner = await ownerAccountOf(env);
    const tell = (cookie = owner) =>
      env.authDurable.fetch(
        new Request(`${ORIGIN}/api/auth/blocked/notify`, {
          method: "POST",
          headers: { Origin: ORIGIN, Cookie: cookie },
          body: JSON.stringify({ userId: "github:earlier" }),
        }),
      );
    const admin = await adminOf(env);
    const sent = outbox(env);
    expect((await tell(admin)).status).toBe(403);
    expect(await (await tell()).json()).toEqual({ sent: true });
    expect(sent).toEqual([
      expect.objectContaining({
        to: ["earlier@example.com"],
        reply_to: "zzhishuai@ethz.ch",
      }),
    ]);
    expect(sent[0]!.text).toContain("2026-10-24 14:13 UTC");
    // Once per block.
    expect((await tell()).status).toBe(409);
    expect(sent).toHaveLength(1);
  });

  it("send the notices again on the next tick when the first try fails, never to blocks from before member notices", async () => {
    const env = environment();
    const maker = await makerOf(env);
    outbox(env, false);
    await block(env, maker);
    expect((await like(env, maker)).status).toBe(403);
    // A block recorded before members were told (2026-10-25) stays untold.
    env.authSql.exec(
      `INSERT INTO account_blocks
         (user_id, email, display_name, provider, blocked_at, entry_id, path,
          notified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      "github:earlier",
      "earlier@example.com",
      "Earlier",
      "github",
      "2026-10-22T00:40:00.000Z",
      "trap",
      "/api/gallery/trap",
      "2026-10-22T00:40:01.000Z",
    );
    const sent = outbox(env);
    const retried = await env.authDurable.fetch(
      new Request("https://auth/internal/block-notices", { method: "POST" }),
    );
    expect(await retried.json()).toEqual({ sent: 2 });
    expect(sent.map((email) => email.to[0])).toEqual([
      "zzhishuai@ethz.ch",
      "maker@example.com",
    ]);
  });
});
