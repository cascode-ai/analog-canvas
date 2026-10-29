import { describe, expect, it } from "vitest";

import {
  loadMySubmissions,
  deleteMyEntry,
  setMyEntryRecycled,
  RECYCLED_KEEP_COUNT,
  recycledRetentionNote,
} from "./my-submissions";

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
  [403, { error: "account-blocked" }, "Owner"],
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
