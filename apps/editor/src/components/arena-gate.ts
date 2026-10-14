// The Arena gate's count (#1681): after a manual Cloud Save and whenever the
// person opens the Cloud shelf, Analog Canvas invites them to cast five
// Schematic Arena Votes a day. Votes already cast today (the browser's day,
// by Arena's clock), in the gate or in Arena, count toward them. The person
// votes in Arena's own window, on chip-arena.com; this side only counts.
// Arena lists a Voter's voted Battles newest first with the time each Vote
// was cast (GET /api/arena/battles/past, which this site's Worker forwards
// with the signed-in account). A Vote counts when its Battle was not listed
// as the gate opened and it was cast since then, by Arena's own clock.
//
// The gate never holds anyone (#1718): its panel closes whenever the person
// closes it, and shows at most once a browser day (arena-gate-request.ts).
// Arena's session says how many Battles the Voter has left (`battlesLeft`,
// read-only, chip-arena#238): the gate asks for at most that many Votes,
// shows nothing when none are left, and stops asking when they run out or
// Arena keeps failing. Someone Arena will not count (signed out, or an AI
// account, which may not vote) never sees it, and neither does anyone on a
// server with no Arena behind it.

/**
 * The Schematic Arena's battle page as the gate opens it. On Analog Canvas's
 * host /schematic hands the visitor on to chip-arena.com, signed in as here,
 * with the query kept; `from=canvas-gate` makes Arena record each Vote cast
 * there with the source `canvas-gate` (docs/specs/analog-arena.md#vote-source).
 */
export const ARENA_GATE_PAGE = "/schematic?from=canvas-gate";

/** The Votes a day asks for, at most: fewer when fewer Battles are left. */
export const VOTES_REQUIRED = 5;

/** How long ago this browser's day began, in milliseconds. */
function sinceLocalMidnight(): number {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return now.getTime() - midnight.getTime();
}

/** Failed reads in a row, while counting, after which the gate stops. */
export const FAILURES_ALLOWED = 3;

const PAST_PATH = "/api/arena/battles/past";
const SESSION_PATH = "/api/arena/session";

/** Why the gate stopped asking before the Votes were in. */
export type ArenaGateFreeReason =
  "unavailable" | "no-battle" | "signed-out" | "ai-account";

export type ArenaGateState =
  | { status: "checking" }
  /** Nothing to show: no Arena here, or nobody Arena would count. */
  | { status: "closed" }
  | { status: "voting"; voted: number; required: number }
  | { status: "free"; reason: ArenaGateFreeReason };

type VotedBattle = { id: string; castAt: number };

type PastRead =
  /** Arena's clock as it answered, where it said, and the voted Battles. */
  | { kind: "listed"; at: number | null; battles: VotedBattle[] }
  /** A Voter who must agree to the Consent first, in Arena's window. */
  | { kind: "consent"; at: number | null }
  | { kind: "signed-out" }
  | { kind: "ai-account" }
  | { kind: "unavailable" }
  | { kind: "absent" };

const READ_OPTIONS = {
  credentials: "same-origin",
  headers: { accept: "application/json" },
  cache: "no-store",
} as const;

type ArenaAnswer =
  | { kind: "answered"; response: Response; body: Record<string, unknown> }
  | { kind: "unavailable" }
  | { kind: "absent" };

/**
 * One of Arena's answers through this site's Worker: unavailable when the
 * request fails, absent when the answer is not a JSON object. Arena and the
 * Worker answer JSON on every /api/arena path, failures included, so
 * anything else is a server with no Arena behind it.
 */
async function askArena(
  fetchLike: typeof fetch,
  path: string,
): Promise<ArenaAnswer> {
  let response: Response;
  try {
    response = await fetchLike(path, READ_OPTIONS);
  } catch {
    return { kind: "unavailable" };
  }
  try {
    const body: unknown = await response.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body))
      return {
        kind: "answered",
        response,
        body: body as Record<string, unknown>,
      };
  } catch {
    // Not JSON: below.
  }
  return { kind: "absent" };
}

async function readPast(fetchLike: typeof fetch): Promise<PastRead> {
  const answer = await askArena(fetchLike, PAST_PATH);
  if (answer.kind !== "answered") return answer;
  const { response, body } = answer;
  const date = Date.parse(response.headers.get("date") ?? "");
  const at = Number.isNaN(date) ? null : date;
  if (response.status === 401) return { kind: "signed-out" };
  if (response.status === 403)
    return body.error === "consent-required"
      ? { kind: "consent", at }
      : { kind: "ai-account" };
  const battles = body.battles;
  if (!response.ok || !Array.isArray(battles)) return { kind: "unavailable" };
  return {
    kind: "listed",
    at,
    battles: battles.map((battle) => {
      const { id, castAt } = battle as { id?: unknown; castAt?: unknown };
      return { id: String(id), castAt: Date.parse(String(castAt)) };
    }),
  };
}

type SessionRead =
  /** A Voter, and the Battles Arena has left for them. */
  | { kind: "voter"; battlesLeft: number }
  | { kind: "signed-out" }
  | { kind: "ai-account" }
  | { kind: "unavailable" }
  | { kind: "absent" };

/**
 * Arena's session: who is visiting and, for a Voter, `battlesLeft`, the
 * active Season's pairings they have no Vote on (0 with no Season open), a
 * whole number of at least 0; any other answer is a failed read. A read,
 * never an assignment (docs/specs/analog-arena.md#counting).
 */
async function readSession(fetchLike: typeof fetch): Promise<SessionRead> {
  const answer = await askArena(fetchLike, SESSION_PATH);
  if (answer.kind !== "answered") return answer;
  const { response, body } = answer;
  if (!response.ok || typeof body.signedIn !== "boolean")
    return { kind: "unavailable" };
  if (!body.signedIn) return { kind: "signed-out" };
  if (body.aiAccount === true) return { kind: "ai-account" };
  const { battlesLeft } = body;
  if (
    typeof battlesLeft !== "number" ||
    !Number.isInteger(battlesLeft) ||
    battlesLeft < 0
  )
    return { kind: "unavailable" };
  return { kind: "voter", battlesLeft };
}

/** Whether the gate is done asking: the Votes are in, or it stopped. */
export function gateSettled(state: ArenaGateState): boolean {
  return (
    state.status === "free" ||
    state.status === "closed" ||
    (state.status === "voting" && state.voted >= state.required)
  );
}

/**
 * One opening of the gate. `start` notes what Arena listed as it opened and
 * how many Votes to ask for; `recount` reads the count and the Battles left
 * again. A recount asked while one is reading joins it. Once settled, the
 * gate stays settled.
 */
export function createArenaGate(
  fetchLike: typeof fetch = fetch,
  sinceMidnight: () => number = sinceLocalMidnight,
) {
  let state: ArenaGateState = { status: "checking" };
  /** The Battles listed as the gate opened; none of them counts. */
  let seen = new Set<string>();
  /** When the gate opened, by Arena's clock; null where it did not say. */
  let since: number | null = null;
  /** The Votes this gate asks for: five, or the Battles left if fewer. */
  let required = VOTES_REQUIRED;
  let failures = 0;
  let reading: Promise<ArenaGateState> | null = null;

  const settle = (next: ArenaGateState) => {
    if (state.status === "checking" || !gateSettled(state)) state = next;
    return state;
  };
  const counted = (read: PastRead & { kind: "listed" | "consent" }) => {
    const voted =
      read.kind === "listed"
        ? read.battles.filter(
            (battle) =>
              !seen.has(battle.id) &&
              (since === null || battle.castAt >= since),
          ).length
        : 0;
    const before = state.status === "voting" ? state.voted : 0;
    return Math.min(Math.max(voted, before), required);
  };

  async function readAgain(): Promise<ArenaGateState> {
    const [read, session] = await Promise.all([
      readPast(fetchLike),
      readSession(fetchLike),
    ]);
    if (read.kind === "signed-out" || read.kind === "ai-account")
      return settle({ status: "free", reason: read.kind });
    if (session.kind === "signed-out" || session.kind === "ai-account")
      return settle({ status: "free", reason: session.kind });
    if (
      (read.kind !== "listed" && read.kind !== "consent") ||
      session.kind !== "voter"
    ) {
      failures += 1;
      return failures >= FAILURES_ALLOWED
        ? settle({ status: "free", reason: "unavailable" })
        : state;
    }
    failures = 0;
    const next = settle({
      status: "voting",
      voted: counted(read),
      required,
    });
    if (session.battlesLeft <= 0 && !gateSettled(next))
      return settle({ status: "free", reason: "no-battle" });
    return next;
  }

  return {
    state: () => state,
    async start(): Promise<ArenaGateState> {
      const [read, session] = await Promise.all([
        readPast(fetchLike),
        readSession(fetchLike),
      ]);
      // Nobody Arena counts, or no Arena here: no panel.
      const uncounted = (kind: PastRead["kind"] | SessionRead["kind"]) =>
        kind === "absent" || kind === "signed-out" || kind === "ai-account";
      if (uncounted(read.kind) || uncounted(session.kind))
        return settle({ status: "closed" });
      if (
        (read.kind !== "listed" && read.kind !== "consent") ||
        session.kind !== "voter"
      )
        return settle({ status: "free", reason: "unavailable" });
      // Nothing left to vote on, no Season open included: no panel.
      if (session.battlesLeft <= 0) return settle({ status: "closed" });
      // The day's Votes so far count: none owed, no panel.
      const dayStart = (read.at ?? Date.now()) - sinceMidnight();
      const votedToday =
        read.kind === "listed"
          ? read.battles.filter((battle) => battle.castAt >= dayStart).length
          : 0;
      if (votedToday >= VOTES_REQUIRED) return settle({ status: "closed" });
      required = Math.min(VOTES_REQUIRED - votedToday, session.battlesLeft);
      since = read.at;
      if (read.kind === "listed")
        seen = new Set(read.battles.map((battle) => battle.id));
      return settle({ status: "voting", voted: 0, required });
    },
    recount() {
      if (state.status !== "voting" || gateSettled(state))
        return Promise.resolve(state);
      reading ??= readAgain().finally(() => {
        reading = null;
      });
      return reading;
    },
  };
}

export type ArenaGate = ReturnType<typeof createArenaGate>;

/**
 * Starts `gate` and shows its panel only when there is one to show: nothing
 * of the panel exists, and focus stays where it was, for someone who never
 * sees it. True when it showed.
 */
export async function startArenaGate(
  gate: ArenaGate,
  show: (state: ArenaGateState) => void,
): Promise<boolean> {
  const state = await gate.start();
  if (state.status === "closed" || state.status === "checking") return false;
  show(state);
  return true;
}
