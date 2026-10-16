import { useCallback, useEffect, useRef, useState } from "react";
import type { Ref } from "react";
import { createRoot } from "react-dom/client";

import {
  ARENA_GATE_PAGE,
  createArenaGate,
  gateSettled,
  startArenaGate,
  VOTES_REQUIRED,
  type ArenaGate,
  type ArenaGateState,
} from "./arena-gate";
import "./arena-gate.css";

/** How often an open gate reads the count again while the page is seen. */
const RECOUNT_MS = 4000;

/**
 * Chip Arena's animated Battle, the page its own front page frames: a fixed
 * Battle of the five-transistor OTA, A and B chosen in turn, never cast. It
 * reads and records nothing. It is framed from chip-arena.com itself, so
 * Arena's code never runs on Analog Canvas's origin (#1683).
 */
export const ARENA_PREVIEW = "https://chip-arena.com/schematic/preview";

/** The size Arena lays the preview out at, scaled to the panel's width. */
const PREVIEW = { width: 832, height: 520 };

/**
 * Asks Arena first, and shows the gate over the page only when there is a
 * panel to show, in a root of its own, so every page that opens it (the
 * editor, the Gallery's shelf, the account page) shows the same panel.
 * While it shows, the rest of the page is inert, as under any dialog; Not
 * now, Close, Escape and the backdrop all close it (#1718).
 */
export async function mountArenaGate({
  saved,
  shown,
  closed,
}: {
  /** Opened after a Cloud Save, rather than as the shelf opened. */
  saved: boolean;
  shown(): void;
  closed(): void;
}): Promise<void> {
  const gate = createArenaGate();
  const showed = await startArenaGate(gate, (state) => {
    const host = document.createElement("div");
    document.body.append(host);
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    const madeInert = [...document.body.children].filter(
      (element) => element !== host && !element.hasAttribute("inert"),
    );
    for (const element of madeInert) element.setAttribute("inert", "");
    const root = createRoot(host);
    let closing = false;
    const close = () => {
      if (closing) return;
      closing = true;
      for (const element of madeInert) element.removeAttribute("inert");
      // Never from inside the root's own render or effects.
      queueMicrotask(() => {
        root.unmount();
        host.remove();
        focused?.focus({ preventScroll: true });
        closed();
      });
    };
    root.render(
      <ArenaGatePanel
        gate={gate}
        first={state}
        saved={saved}
        onClose={close}
      />,
    );
    shown();
  });
  if (!showed) closed();
}

/** Why the gate stopped asking before the Votes were in. */
const FREE_REASONS: Record<
  Extract<ArenaGateState, { status: "free" }>["reason"],
  string
> = {
  "no-battle": "Arena has no more Battles for you right now.",
  "signed-out": "You're no longer signed in to Arena.",
  "ai-account": "AI accounts can't vote in Arena.",
  unavailable: "Arena can't be reached right now.",
};

/**
 * Arena's animated Battle, laid out at its own size and scaled to the
 * panel's width. It only shows: it takes no pointer (arena-gate.css) and no
 * focus. Nothing in the dialog depends on it: a frame that cannot load shows
 * the browser's own error page in its reserved space, and the title, dots
 * and buttons work as ever.
 */
function ArenaPreview() {
  const box = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const element = box.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const fit = () =>
      element.style.setProperty(
        "--fit",
        String(element.clientWidth / PREVIEW.width),
      );
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return (
    <div
      className="arena-gate-preview"
      ref={box}
      style={{ aspectRatio: `${PREVIEW.width} / ${PREVIEW.height}` }}
    >
      <iframe
        src={ARENA_PREVIEW}
        title="A Battle in the Schematic Arena"
        aria-hidden="true"
        width={PREVIEW.width}
        height={PREVIEW.height}
        tabIndex={-1}
        // Its own scripts on its own origin, chip-arena.com; nothing else.
        sandbox="allow-scripts allow-same-origin"
        referrerPolicy="no-referrer"
      />
    </div>
  );
}

/** What the gate shows, from its state; the panel below keeps the state. */
export function ArenaGateView({
  state,
  required,
  saved,
  onClose,
  dialogRef,
}: {
  state: ArenaGateState;
  /** The Votes this gate asks for: five, or the Battles left if fewer. */
  required: number;
  saved: boolean;
  onClose(): void;
  /** The dialog, which takes focus as it shows. */
  dialogRef?: Ref<HTMLElement>;
}) {
  const asking = state.status === "voting" && !gateSettled(state);
  const voted = state.status === "voting" ? Math.min(state.voted, required) : 0;
  return (
    <section
      ref={dialogRef}
      className="arena-gate"
      role="dialog"
      aria-modal="true"
      aria-labelledby="arena-gate-title"
      tabIndex={-1}
      data-testid="arena-gate"
    >
      <h2 id="arena-gate-title">
        {`Vote on ${required} Battle${required === 1 ? "" : "s"} in the Schematic Arena`}
      </h2>
      <ArenaPreview />
      {state.status === "voting" ? (
        <div className="arena-gate-dots" data-testid="arena-gate-count">
          {Array.from({ length: required }, (_, index) => (
            <span
              key={index}
              aria-hidden="true"
              data-filled={index < voted ? "" : undefined}
            />
          ))}
          <span className="arena-gate-hidden" aria-live="polite">
            {`Voted ${voted} of ${required}`}
          </span>
        </div>
      ) : null}
      {/* Always there, so a reason that appears as the gate stops is
          announced. */}
      <p className="arena-gate-note" aria-live="polite">
        {state.status === "free"
          ? FREE_REASONS[state.reason]
          : saved
            ? "Your work is saved."
            : ""}
      </p>
      <div className="arena-gate-actions">
        {asking ? (
          // A link opened by the person's own click: a new tab or window
          // that no popup blocker stops, on chip-arena.com signed in.
          <a
            className="arena-gate-open"
            href={ARENA_GATE_PAGE}
            target="_blank"
            rel="noopener"
          >
            Start voting →
          </a>
        ) : null}
        <button type="button" className="arena-gate-close" onClick={onClose}>
          {asking ? "Not now" : "Close"}
        </button>
      </div>
    </section>
  );
}

function ArenaGatePanel({
  gate,
  first,
  saved,
  onClose,
}: {
  gate: ArenaGate;
  first: ArenaGateState;
  saved: boolean;
  onClose(): void;
}) {
  const [state, setState] = useState(first);
  const dialogRef = useRef<HTMLElement | null>(null);
  useEffect(() => dialogRef.current?.focus(), []);

  const required = first.status === "voting" ? first.required : VOTES_REQUIRED;
  const counting = state.status === "voting" && !gateSettled(state);
  const recount = useCallback(() => {
    void gate.recount().then(setState);
  }, [gate]);
  // Read again every few seconds while the page is seen, and at once when
  // the person comes back from Arena's window.
  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") recount();
    }, RECOUNT_MS);
    const returned = () => {
      if (document.visibilityState === "visible") recount();
    };
    window.addEventListener("focus", returned);
    document.addEventListener("visibilitychange", returned);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", returned);
      document.removeEventListener("visibilitychange", returned);
    };
  }, [counting, recount]);
  // Escape, wherever focus is, closes the gate. No page under it sees the
  // key.
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [onClose]);

  return (
    <div
      className="arena-gate-backdrop"
      // Focus stays in the panel: a press outside it moves nothing.
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) event.preventDefault();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <ArenaGateView
        state={state}
        required={required}
        saved={saved}
        dialogRef={dialogRef}
        onClose={onClose}
      />
    </div>
  );
}
