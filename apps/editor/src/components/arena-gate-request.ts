// The Arena gate's way in (#1681). The pages that open it hold only this:
// the panel, its count and its styles load when a gate opens, so no page's
// first load grows. One gate at a time; a request while one is open, or
// still deciding whether to show, changes nothing. Once a gate has shown,
// none opens again that browser day, however it was closed (#1718).

import type { mountArenaGate } from "./arena-gate-panel";

/** Loads the panel's code; tests hand in their own. */
type PanelLoader = () => Promise<{ mountArenaGate: typeof mountArenaGate }>;

const loadPanel: PanelLoader = () => import("./arena-gate-panel");

let gate: "idle" | "deciding" | "shown" = "idle";

/** The browser day a gate last showed on, kept in localStorage. */
export const ARENA_GATE_DAY_KEY = "icm.arena-gate-day";

function today(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function shownToday(): boolean {
  try {
    return localStorage.getItem(ARENA_GATE_DAY_KEY) === today();
  } catch {
    return false;
  }
}

function noteShown(): void {
  try {
    localStorage.setItem(ARENA_GATE_DAY_KEY, today());
  } catch {
    // Without storage the gate may show again; it still closes at once.
  }
}

/**
 * Opens the Arena gate over whatever page is showing, after a Cloud Save or
 * as the Cloud shelf opens.
 */
function requestArenaGate(after: "save" | "shelf", load: PanelLoader): void {
  if (gate !== "idle" || typeof document === "undefined" || shownToday())
    return;
  gate = "deciding";
  void load()
    .then((panel) =>
      panel.mountArenaGate({
        saved: after === "save",
        shown: () => {
          gate = "shown";
          noteShown();
        },
        closed: () => {
          gate = "idle";
        },
      }),
    )
    // A gate that cannot load never stands in anyone's way.
    .catch(() => {
      gate = "idle";
    });
}

/**
 * Whether the gate's panel is over the page. The page under it takes no
 * keys meanwhile, wherever focus is.
 */
export function arenaGateShown(): boolean {
  return gate === "shown";
}

/**
 * A manual Cloud Save's outcome, after which the gate opens if the save
 * completed. The save itself never waits for the gate.
 */
export function gateAfterManualCloudSave<Outcome extends { status: string }>(
  outcome: Outcome,
  load: PanelLoader = loadPanel,
): Outcome {
  if (outcome.status === "saved") requestArenaGate("save", load);
  return outcome;
}

/**
 * The person opened the Cloud shelf: the editor's Shelf menu, the Gallery's
 * My shelf tab or the account page's Cloud Projects tab. Such an opening
 * opens the gate unless the day's Votes are in (arena-gate.ts) or a gate
 * already showed today. A page that loads on the shelf, as on a reload,
 * does not call this.
 */
export function cloudShelfOpened(load: PanelLoader = loadPanel): void {
  requestArenaGate("shelf", load);
}
