import { describe, expect, it } from "vitest";

import {
  ARENA_GATE_PAGE,
  createArenaGate,
  FAILURES_ALLOWED,
  gateClosable,
  startArenaGate,
  VOTES_REQUIRED,
} from "./arena-gate";

const OPENED = "Mon, 12 Oct 2026 10:00:00 GMT";
const BEFORE = "2026-10-12T09:59:59.400Z";
const after = (second: number) =>
  `2026-10-12T10:00:${String(second).padStart(2, "0")}.250Z`;

/**
 * A day that begins a minute after the gate opens: every Vote these tests
 * list is another day's, so none counts toward the day's five.
 */
const dayFromOpening = () => -60_000;

type Answer = Response | Error;
type Session = Record<string, unknown>;

/** Arena's session for a signed-in Voter with `battlesLeft` pairings left. */
const voter = (battlesLeft: number): Session => ({
  signedIn: true,
  displayName: "Author",
  isOwner: false,
  aiAccount: false,
  consented: true,
  votes: 3,
  profileGiven: false,
  voterId: "v-1",
  battlesLeft,
});

/**
 * Arena behind the Canvas Worker: the Voter's voted Battles and the session,
 * each answered from its own queue (the last answer repeats).
 */
function arena({
  past,
  session = [voter(40)],
}: {
  past: Answer[];
  session?: (Session | Answer)[];
}) {
  const asked: string[] = [];
  const take = <T>(queue: T[]) =>
    queue.length > 1 ? queue.shift()! : queue[0]!;
  const fetchLike = (async (input: RequestInfo | URL) => {
    const path = String(input);
    asked.push(path);
    if (path === "/api/arena/battles/past") {
      const answer = take(past);
      if (answer instanceof Error) throw answer;
      return answer.clone();
    }
    if (path === "/api/arena/session") {
      const answer = take(session);
      if (answer instanceof Error) throw answer;
      return answer instanceof Response
        ? answer.clone()
        : Response.json(answer);
    }
    throw new Error(`unexpected ${path}`);
  }) as typeof fetch;
  return { fetchLike, asked };
}

/** Voted Battles `[id, castAt]`, newest first, answered at `date`. */
const past = (battles: [string, string][], date: string | null = OPENED) =>
  Response.json(
    {
      battles: battles.map(([id, castAt]) => ({ id, castAt })),
      more: false,
      total: battles.length,
    },
    { headers: date ? { date } : {} },
  );
const refusal = (status: number, error: string) =>
  Response.json(
    { error, message: error },
    { status, headers: { date: OPENED } },
  );

describe("the Arena gate's count", () => {
  it("counts Votes cast since it opened, by Arena's clock, on Battles not listed then", async () => {
    const { fetchLike } = arena({
      past: [
        // A Vote in the very second the gate opened, but before it.
        past([
          ["same-second", after(0)],
          ["old", BEFORE],
        ]),
        past([
          ["n2", after(30)],
          ["n1", after(10)],
          ["same-second", after(0)],
          ["old", BEFORE],
        ]),
      ],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    expect(await gate.start()).toEqual({
      status: "voting",
      voted: 0,
      required: 5,
    });
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 2,
      required: 5,
    });
    expect(gateClosable(gate.state())).toBe(false);
  });

  it("counts by the Battles listed as it opened when Arena gives no time", async () => {
    const { fetchLike } = arena({
      past: [
        past([["old", BEFORE]], null),
        past(
          [
            ["n1", after(5)],
            ["old", BEFORE],
          ],
          "garbled",
        ),
      ],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 1,
      required: 5,
    });
  });

  it("unlocks at five new Votes and stays unlocked", async () => {
    const five = [5, 4, 3, 2, 1].map((s): [string, string] => [
      `n${s}`,
      after(s),
    ]);
    const { fetchLike } = arena({
      past: [
        past([["old", BEFORE]]),
        past([...five, ["old", BEFORE]]),
        refusal(503, "arena-unavailable"),
      ],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: VOTES_REQUIRED,
      required: VOTES_REQUIRED,
    });
    expect(gateClosable(gate.state())).toBe(true);
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: VOTES_REQUIRED,
      required: VOTES_REQUIRED,
    });
  });

  it("opens for a Voter who must first agree to the Consent, and counts once Arena lists Votes", async () => {
    const { fetchLike } = arena({
      past: [
        refusal(403, "consent-required"),
        refusal(403, "consent-required"),
        // Agreed in Arena's window: Votes from an earlier Consent, one new.
        past(
          [
            ["n1", after(40)],
            ["old2", BEFORE],
            ["old1", BEFORE],
          ],
          "Mon, 12 Oct 2026 10:01:00 GMT",
        ),
      ],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    expect(await gate.start()).toEqual({
      status: "voting",
      voted: 0,
      required: 5,
    });
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 0,
      required: 5,
    });
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 1,
      required: 5,
    });
  });

  it("never counts down when answers arrive out of order", async () => {
    const { fetchLike } = arena({
      past: [
        past([]),
        past([
          ["n2", after(2)],
          ["n1", after(1)],
        ]),
        past([["n1", after(1)]]),
      ],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    await gate.recount();
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 2,
      required: 5,
    });
  });

  it("reads once for recounts asked while one is reading", async () => {
    const { fetchLike, asked } = arena({ past: [past([])] });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    asked.length = 0;
    await Promise.all([gate.recount(), gate.recount()]);
    expect(asked).toEqual(["/api/arena/battles/past", "/api/arena/session"]);
  });
});

describe("the Arena gate never traps anyone", () => {
  it("is closable at once when Arena fails or cannot be reached as it opens", async () => {
    for (const answer of [
      refusal(503, "arena-unavailable"),
      new TypeError("Failed to fetch"),
    ]) {
      const gate = createArenaGate(
        arena({ past: [answer] }).fetchLike,
        dayFromOpening,
      );
      const state = await gate.start();
      expect(state).toEqual({ status: "free", reason: "unavailable" });
      expect(gateClosable(state)).toBe(true);
    }
  });

  it(`unlocks after ${FAILURES_ALLOWED} failed reads in a row while counting, not after one`, async () => {
    const down = new TypeError("Failed to fetch");
    const { fetchLike } = arena({
      past: [past([]), down, past([["n1", after(1)]]), down, down, down],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 0,
      required: 5,
    });
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 1,
      required: 5,
    });
    for (let failure = 1; failure < FAILURES_ALLOWED; failure++)
      expect(await gate.recount()).toEqual({
        status: "voting",
        voted: 1,
        required: 5,
      });
    expect(await gate.recount()).toEqual({
      status: "free",
      reason: "unavailable",
    });
  });

  it("shows no panel when Arena has no battle left for the Voter, no Season open included", async () => {
    const shown: unknown[] = [];
    const gate = createArenaGate(
      arena({ past: [past([])], session: [voter(0)] }).fetchLike,
      dayFromOpening,
    );
    expect(await startArenaGate(gate, (state) => shown.push(state))).toBe(
      false,
    );
    expect(shown).toEqual([]);
  });

  it("asks only for the battles left when fewer than five are", async () => {
    const { fetchLike } = arena({
      past: [
        past([]),
        past([
          ["n3", after(3)],
          ["n2", after(2)],
          ["n1", after(1)],
        ]),
      ],
      session: [voter(3), voter(0)],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    expect(await gate.start()).toEqual({
      status: "voting",
      voted: 0,
      required: 3,
    });
    const state = await gate.recount();
    expect(state).toEqual({ status: "voting", voted: 3, required: 3 });
    expect(gateClosable(state)).toBe(true);
  });

  it("lets the person go when the battles left run out before the votes are in", async () => {
    const { fetchLike } = arena({
      past: [past([]), past([["n1", after(1)]])],
      session: [voter(7), voter(0)],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    expect(await gate.recount()).toEqual({
      status: "free",
      reason: "no-battle",
    });
  });

  it("takes battlesLeft only as a whole number of at least 0, as a failed read otherwise", async () => {
    for (const battlesLeft of [-1, 2.5, "3", null, undefined]) {
      const opening = createArenaGate(
        arena({
          past: [past([])],
          session: [{ ...voter(0), battlesLeft }],
        }).fetchLike,
      );
      expect(await opening.start()).toEqual({
        status: "free",
        reason: "unavailable",
      });
    }
    const { fetchLike } = arena({
      past: [past([])],
      session: [voter(9), { ...voter(9), battlesLeft: -2 }],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    // Not "none left": one failed read of the 3 allowed.
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 0,
      required: 5,
    });
  });

  it("counts a failed session read like a failed count", async () => {
    const down = new TypeError("Failed to fetch");
    for (const answer of [down, refusal(503, "arena-unavailable")]) {
      const opening = createArenaGate(
        arena({ past: [past([])], session: [answer] }).fetchLike,
        dayFromOpening,
      );
      expect(await opening.start()).toEqual({
        status: "free",
        reason: "unavailable",
      });
    }
    const { fetchLike } = arena({
      past: [past([])],
      session: [voter(9), down, voter(9), down],
    });
    const gate = createArenaGate(fetchLike, dayFromOpening);
    await gate.start();
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 0,
      required: 5,
    });
    expect(await gate.recount()).toEqual({
      status: "voting",
      voted: 0,
      required: 5,
    });
    for (let failure = 1; failure < FAILURES_ALLOWED; failure++)
      await gate.recount();
    expect(await gate.recount()).toEqual({
      status: "free",
      reason: "unavailable",
    });
  });

  it("shows no panel to an AI account, a signed-out visitor or where no Arena answers", async () => {
    const html = () =>
      new Response("<!doctype html>", {
        headers: { "content-type": "text/html" },
      });
    for (const [answer, session] of [
      [refusal(403, "ai-account"), { ...voter(0), aiAccount: true }],
      [refusal(401, "signed-out"), { signedIn: false }],
      [past([]), { ...voter(4), aiAccount: true }],
      [past([]), { signedIn: false }],
      [html(), html()],
    ] as const) {
      const shown: unknown[] = [];
      const gate = createArenaGate(
        arena({ past: [answer], session: [session] }).fetchLike,
        dayFromOpening,
      );
      expect(await startArenaGate(gate, (state) => shown.push(state))).toBe(
        false,
      );
      expect(gate.state()).toEqual({ status: "closed" });
      // Nothing of the panel is made for them.
      expect(shown).toEqual([]);
    }
  });

  it("shows the panel once, with its first state, to a Voter", async () => {
    const shown: unknown[] = [];
    const gate = createArenaGate(
      arena({ past: [past([])] }).fetchLike,
      dayFromOpening,
    );
    expect(await startArenaGate(gate, (state) => shown.push(state))).toBe(true);
    expect(shown).toEqual([{ status: "voting", voted: 0, required: 5 }]);
  });

  it("frees a person signed out, or switched to an AI account, while counting, saying which", async () => {
    for (const [answer, session, reason] of [
      [refusal(401, "signed-out"), { signedIn: false }, "signed-out"],
      [
        refusal(403, "ai-account"),
        { ...voter(0), aiAccount: true },
        "ai-account",
      ],
      [past([]), { signedIn: false }, "signed-out"],
    ] as const) {
      const gate = createArenaGate(
        arena({ past: [past([]), answer], session: [voter(9), session] })
          .fetchLike,
        dayFromOpening,
      );
      await gate.start();
      expect(await gate.recount()).toEqual({ status: "free", reason });
    }
  });
});

describe("the battle page the gate opens", () => {
  it("is the Schematic Arena's page, marked so Arena records its Votes as the gate's", () => {
    const address = new URL(ARENA_GATE_PAGE, "https://analog-canvas.test");
    // On Analog Canvas's host /schematic hands the visitor on to
    // chip-arena.com signed in, query kept (docs/specs/analog-arena.md).
    expect(address.origin).toBe("https://analog-canvas.test");
    expect(address.pathname).toBe("/schematic");
    // Arcadia-1/chip-arena#234: Votes cast on a page opened with
    // from=canvas-gate keep the source "canvas-gate".
    expect(address.searchParams.get("from")).toBe("canvas-gate");
  });
});

describe("the Arena gate, once a day", () => {
  // Arena's clock says 10:00; this browser's day began ten hours before.
  const tenHours = () => 10 * 3_600_000;
  const yesterday = "2026-10-11T23:00:00.000Z";

  it("asks only for the day's Votes still owed, and nothing once five are in", async () => {
    const opened = (battles: [string, string][]) =>
      createArenaGate(arena({ past: [past(battles)] }).fetchLike, tenHours);
    // Two cast today, one yesterday: three more today.
    const partly = opened([
      ["b-3", BEFORE],
      ["b-2", "2026-10-12T08:00:00.000Z"],
      ["b-1", yesterday],
    ]);
    expect(await partly.start()).toEqual({
      status: "voting",
      voted: 0,
      required: VOTES_REQUIRED - 2,
    });
    // Five today, in the gate or in Arena: no panel until tomorrow.
    const done = opened(
      Array.from({ length: VOTES_REQUIRED }, (_, index): [string, string] => [
        `t-${index}`,
        "2026-10-12T09:00:00.000Z",
      ]),
    );
    expect(await done.start()).toEqual({ status: "closed" });
    // Yesterday's Votes are yesterday's.
    const fresh = opened([["y-1", yesterday]]);
    expect(await fresh.start()).toEqual({
      status: "voting",
      voted: 0,
      required: VOTES_REQUIRED,
    });
  });
});
