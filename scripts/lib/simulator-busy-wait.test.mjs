import { describe, expect, it } from "vitest";
import { waitingWhileBusy } from "./simulator-busy-wait.mjs";

const busy = () =>
  Response.json(
    { error: "simulator-refused", reason: "simulator-busy" },
    { status: 502 },
  );

function clock() {
  let at = 0;
  return {
    now: () => at,
    sleep: async (ms) => {
      at += ms;
    },
  };
}

describe("waitingWhileBusy (#1507)", () => {
  it("tries again while the simulator runs another circuit", async () => {
    const answers = [busy(), busy(), Response.json({ ok: true })];
    const calls = [];
    const fetchImpl = async (input, init) => {
      calls.push(init);
      return answers.shift();
    };
    const response = await waitingWhileBusy(fetchImpl, {
      ...clock(),
      log: () => {},
    })("https://example.test/api/simulate", { method: "POST", body: "{}" });
    expect(await response.json()).toEqual({ ok: true });
    expect(calls).toHaveLength(3);
    // Each later attempt carries a time limit of its own.
    expect(calls[1].signal).toBeInstanceOf(AbortSignal);
    expect(calls[1].body).toBe("{}");
  });

  it("returns any other refusal at once, and the busy answer once patience runs out", async () => {
    const other = Response.json(
      { error: "simulator-refused", reason: "run-directory-unavailable" },
      { status: 502 },
    );
    let calls = 0;
    const refused = await waitingWhileBusy(
      async () => {
        calls += 1;
        return other;
      },
      { ...clock(), log: () => {} },
    )("https://example.test/api/simulate", {});
    expect(refused.status).toBe(502);
    expect(calls).toBe(1);

    calls = 0;
    const stillBusy = await waitingWhileBusy(
      async () => {
        calls += 1;
        return busy();
      },
      { ...clock(), log: () => {}, patienceMs: 60_000, intervalMs: 15_000 },
    )("https://example.test/api/simulate", {});
    expect(stillBusy.status).toBe(502);
    expect(calls).toBe(5);
  });
});
