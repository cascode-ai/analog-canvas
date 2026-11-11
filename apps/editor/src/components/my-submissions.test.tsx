import { describe, expect, it } from "vitest";

import {
  loadMySubmissions,
  deleteMyEntry,
  setMyEntryRecycled,
  RECYCLED_KEEP_COUNT,
  recycledRetentionNote,
} from "./my-submissions";

it("retries an uncertain lifecycle request with the same identity and gives a later action a new one", async () => {
  const keys: (string | null)[] = [];
  let attempts = 0;
  const fetcher: typeof fetch = async (_input, init) => {
    keys.push(new Headers(init?.headers).get("idempotency-key"));
    if (++attempts === 1) throw new TypeError("lost response");
    return Response.json({ status: "recycled" });
  };
  expect(
    (await setMyEntryRecycled("retry-circuit", "recycle", fetcher)).ok,
  ).toBe(false);
  expect(
    (await setMyEntryRecycled("retry-circuit", "recycle", fetcher)).ok,
  ).toBe(true);
  await setMyEntryRecycled("retry-circuit", "restore", fetcher);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
  expect(keys[2]).not.toBe(keys[0]);
});

it("keeps a deletion's identity while its result is uncertain", async () => {
  const keys: (string | null)[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    expect(input).toBe("/api/gallery/delete-retry-circuit");
    expect(init?.method).toBe("DELETE");
    keys.push(new Headers(init?.headers).get("idempotency-key"));
    return keys.length === 1
      ? Response.json({ error: "action-propagation-pending" }, { status: 503 })
      : Response.json({ id: "delete-retry-circuit", deleted: true });
  };
  expect((await deleteMyEntry("delete-retry-circuit", fetcher)).ok).toBe(false);
  expect((await deleteMyEntry("delete-retry-circuit", fetcher)).ok).toBe(true);
  expect(keys[0]).toBeTruthy();
  expect(keys[1]).toBe(keys[0]);
});

it("distinguishes a saved action waiting for replication from a refused action", async () => {
  const outcome = await setMyEntryRecycled(
    "pending-circuit",
    "recycle",
    async () =>
      Response.json({ error: "action-propagation-pending" }, { status: 503 }),
  );
  expect(outcome).toEqual({
    ok: false,
    message:
      "The change was saved. Synchronization is still finishing; retry to confirm.",
  });
});

it("reports offline actions and accepts successful empty replies", async () => {
  for (const run of [
    deleteMyEntry,
    (id: string, fetcher: typeof fetch) =>
      setMyEntryRecycled(id, "restore", fetcher),
  ]) {
    expect(
      await run("g1", async () => {
        throw new TypeError("network");
      }),
    ).toMatchObject({
      ok: false,
      message: expect.stringContaining("Check your connection"),
    });
    expect(
      await run("g1", async () => new Response(null, { status: 204 })),
    ).toEqual({ ok: true });
  }
});

it.each([
  [401, {}, "Sign in"],
  [404, {}, "Not found"],
  [
    429,
    { error: "too-many-requests", retryAfterSeconds: 12 },
    "Wait 12 seconds",
  ],
  [503, {}, "server could not answer"],
] as const)(
  "names HTTP %s for each submission action",
  async (status, body, message) => {
    const fetcher: typeof fetch = async () => Response.json(body, { status });
    for (const outcome of [
      await deleteMyEntry("g1", fetcher),
      await setMyEntryRecycled("g1", "recycle", fetcher),
      await setMyEntryRecycled("g1", "restore", fetcher),
    ])
      expect(outcome).toMatchObject({
        ok: false,
        message: expect.stringContaining(message),
      });
  },
);

describe("recycledRetentionNote", () => {
  // The bin holds a fixed number of withdrawals per account and expires
  // nothing on a clock. A card that named a removal date would be promising
  // a day the worker never acts on, which is the bug this replaces.
  it("names the rule that removes an entry, never a date", () => {
    const note = recycledRetentionNote({ rejectReason: null });
    expect(note).toContain(
      `your ${RECYCLED_KEEP_COUNT} most recent withdrawals`,
    );
    expect(note).not.toMatch(/\d{4}-\d{2}-\d{2}/);
    expect(note.toLowerCase()).not.toContain("expire");
  });

  it("keeps the restore path honest for a rejected entry", () => {
    // A withdrawal the owner rejected is not the author's to republish, so
    // the same card must not offer them Restore.
    expect(recycledRetentionNote({ rejectReason: "Loose wires." })).toContain(
      "Only the Owner can restore",
    );
    expect(recycledRetentionNote({ rejectReason: null })).toContain(
      "Restore republishes it",
    );
  });

  it("leaves the Owner's withdrawal to the Owner (#1540)", () => {
    // The worker refuses the author's Restore of it, so the card names who
    // can, and promises no slot among the author's own withdrawals.
    const note = recycledRetentionNote({
      rejectReason: null,
      withdrawnByCurator: true,
    });
    expect(note).toBe("Withdrawn by the Owner. Only the Owner can restore it.");
  });
});

describe("loadMySubmissions", () => {
  const signedIn = (mine: () => Promise<Response>) =>
    (async (url: string) =>
      url === "/api/auth/me"
        ? Response.json({ user: { id: "u1", displayName: "U" } })
        : mine()) as unknown as typeof fetch;

  it("says what failed instead of calling a signed-in reader signed out (2026-10-23)", async () => {
    expect(
      await loadMySubmissions(
        signedIn(async () => new Response("", { status: 503 })),
      ),
    ).toEqual({
      status: "failed",
      message: "The server could not answer (503). Try again later.",
    });
    expect(
      await loadMySubmissions(
        signedIn(async () => new Response("", { status: 401 })),
      ),
    ).toEqual({ status: "signed-out" });
  });
});
