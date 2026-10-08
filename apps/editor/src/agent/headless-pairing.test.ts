import { describe, expect, it } from "vitest";
import {
  AgentPairing,
  agentPairingRequested,
  exposeAgentPairing,
  type AgentPairingView,
} from "./headless-pairing";

const view = (patch: Partial<AgentPairingView>): AgentPairingView => ({
  status: "idle",
  claimCode: null,
  claimExpiresAt: null,
  error: null,
  ...patch,
});

/** Whether a promise has settled, and how, after pending work has run. */
async function state(promise: Promise<string>) {
  const outcome = await Promise.race([
    promise.then(
      (claimCode) => ({ claimCode }),
      (error: Error) => ({ error: error.message }),
    ),
    new Promise<"pending">((resolve) => setTimeout(() => resolve("pending"))),
  ]);
  return outcome;
}

describe("headless pairing (#1523)", () => {
  it("is asked for only with agent=pair in the page's query", () => {
    expect(agentPairingRequested("?agent=pair")).toBe(true);
    expect(agentPairingRequested("?project=p1&agent=pair")).toBe(true);
    expect(agentPairingRequested("")).toBe(false);
    expect(agentPairingRequested("?agent=1")).toBe(false);
    expect(agentPairingRequested("?pair=agent")).toBe(false);
  });

  it("hands over the claim code once the page's connection has one", async () => {
    const pairing = new AgentPairing(() => 1_000);
    const early = pairing.claimCode();
    pairing.observe(view({}));
    pairing.start();
    pairing.observe(view({ status: "creating" }));
    expect(await state(early)).toBe("pending");
    pairing.observe(
      view({
        status: "waiting-for-agent",
        claimCode: "session-1.code",
        claimExpiresAt: 2_000,
      }),
    );
    expect(await state(early)).toEqual({ claimCode: "session-1.code" });
    // Asked again before an Agent redeems it, the same code.
    expect(await state(pairing.claimCode())).toEqual({
      claimCode: "session-1.code",
    });
  });

  it("waits through a connection that ended before the page started its own", async () => {
    const pairing = new AgentPairing(() => 1_000);
    // A recovery that failed is not this pairing's answer ...
    pairing.observe(view({ error: "Session expired" }));
    const waiting = pairing.claimCode();
    expect(await state(waiting)).toBe("pending");
    // ... nor is it once the page starts, before the new view arrives.
    pairing.start();
    expect(await state(pairing.claimCode())).toBe("pending");
    pairing.observe(
      view({ status: "reconnecting", claimCode: "c", claimExpiresAt: 5_000 }),
    );
    expect(await state(waiting)).toEqual({ claimCode: "c" });
  });

  it("says why there is no code: connecting failed, it expired, or the page is paired", async () => {
    const failed = new AgentPairing(() => 1_000);
    failed.start();
    const waiting = failed.claimCode();
    failed.observe(view({ error: "Could not create an Agent connection" }));
    expect(await state(waiting)).toEqual({
      error: "Could not create an Agent connection",
    });

    const expired = new AgentPairing(() => 3_000);
    expired.start();
    expired.observe(
      view({
        status: "waiting-for-agent",
        claimCode: "old",
        claimExpiresAt: 2_000,
      }),
    );
    expect(await state(expired.claimCode())).toEqual({
      error: expect.stringContaining("expired"),
    });

    // A redeemed code still shown is not offered again.
    const paired = new AgentPairing(() => 1_000);
    paired.observe(
      view({ status: "connected", claimCode: "used", claimExpiresAt: 2_000 }),
    );
    expect(await state(paired.claimCode())).toEqual({
      error: "This page is already paired with an Agent",
    });
  });

  it("offers claimCode() on the window while the page lives, and only that", async () => {
    const pairing = new AgentPairing(() => 1_000);
    pairing.observe(view({ status: "waiting-for-agent", claimCode: "c" }));
    const page: { analogCanvasAgent?: { claimCode: () => Promise<string> } } =
      {};
    const withdraw = exposeAgentPairing(page, pairing);
    expect(Object.keys(page.analogCanvasAgent!)).toEqual(["claimCode"]);
    expect(await page.analogCanvasAgent!.claimCode()).toBe("c");
    withdraw();
    expect(page).not.toHaveProperty("analogCanvasAgent");

    // Withdrawing leaves a later page's handle alone.
    const first = exposeAgentPairing(page, pairing);
    const second = exposeAgentPairing(page, pairing);
    first();
    expect(page).toHaveProperty("analogCanvasAgent");
    second();
    expect(page).not.toHaveProperty("analogCanvasAgent");
  });
});
