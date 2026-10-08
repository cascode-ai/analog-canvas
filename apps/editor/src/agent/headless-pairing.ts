import type { AgentConnectionStatus } from "./connect-agent-panel";

/**
 * Headless pairing (#1523). Automation that opens the editor itself, a
 * headless browser driving batch workers for instance, has no person to
 * open Connect Agent and copy the message. It opens the editor with
 * `?agent=pair` instead: the page connects on load as Connect Agent does,
 * without opening its panel or adding a control, and hands the claim code
 * to that automation through `window.analogCanvasAgent.claimCode()`. The
 * code stays in the page's memory: never in a URL, storage or a log.
 */
export function agentPairingRequested(search: string): boolean {
  return new URLSearchParams(search).get("agent") === "pair";
}

/** The parts of the page's Agent connection a pairing waits on. */
export interface AgentPairingView {
  status: AgentConnectionStatus;
  claimCode: string | null;
  claimExpiresAt: number | null;
  error: string | null;
}

/** An Agent works through this page already. */
const PAIRED: readonly AgentConnectionStatus[] = ["connected", "working"];
/** No connection, and none on its way. */
const ENDED: readonly AgentConnectionStatus[] = ["idle", "revoked", "expired"];

/**
 * What a waiting automation gets: the claim code while it can be redeemed,
 * the reason there is none, or nothing yet. Before the page starts its own
 * connection, only a code or a pairing already in place answers: a
 * connection that ended before it, a recovery that failed for instance,
 * is what the page is about to replace.
 */
export function agentPairingOutcome(
  view: AgentPairingView,
  started: boolean,
  now: number,
): { claimCode: string } | { error: string } | null {
  if (PAIRED.includes(view.status))
    return { error: "This page is already paired with an Agent" };
  if (
    view.claimCode !== null &&
    (view.claimExpiresAt === null || now < view.claimExpiresAt)
  )
    return { claimCode: view.claimCode };
  if (!started) return null;
  if (ENDED.includes(view.status))
    return { error: view.error ?? `The Agent connection is ${view.status}` };
  if (view.claimExpiresAt !== null && now >= view.claimExpiresAt)
    return {
      error: "The claim code expired; open the page again to pair it",
    };
  return null;
}

/** The page's pairing for automation; claimCode() waits for its outcome. */
export class AgentPairing {
  private view: AgentPairingView = {
    status: "idle",
    claimCode: null,
    claimExpiresAt: null,
    error: null,
  };
  private started = false;
  private readonly waiting: Array<{
    resolve: (claimCode: string) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(private readonly now: () => number = Date.now) {}

  /** The page starts connecting for automation. */
  start(): void {
    this.started = true;
    // Whatever ended before is not this connection's answer.
    this.view = { ...this.view, status: "creating", error: null };
  }

  observe(view: AgentPairingView): void {
    this.view = { ...view };
    this.settle();
  }

  claimCode(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ resolve, reject });
      this.settle();
    });
  }

  private settle(): void {
    const outcome = agentPairingOutcome(this.view, this.started, this.now());
    if (!outcome) return;
    for (const waiter of this.waiting.splice(0)) {
      if ("claimCode" in outcome) waiter.resolve(outcome.claimCode);
      else waiter.reject(new Error(outcome.error));
    }
  }
}

/**
 * Offer the pairing to automation as `analogCanvasAgent.claimCode()` on
 * the given window; the returned function takes it back.
 */
export function exposeAgentPairing(
  target: object,
  pairing: AgentPairing,
): () => void {
  const slot = target as { analogCanvasAgent?: unknown };
  const handle = Object.freeze({
    claimCode: () => pairing.claimCode(),
  });
  slot.analogCanvasAgent = handle;
  return () => {
    if (slot.analogCanvasAgent === handle) delete slot.analogCanvasAgent;
  };
}
