import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";

import {
  SIMULATION_SESSION_COOKIE,
  SimulationControlDO,
} from "./simulation-control-do";

function sqliteState() {
  const db = new DatabaseSync(":memory:");
  return {
    storage: {
      getAlarm: vi.fn(async () => null as number | null),
      setAlarm: vi.fn(async (_time: number) => {}),
      sql: {
        exec<T>(query: string, ...bindings: unknown[]) {
          const statement = db.prepare(query);
          if (/^\s*(select|with|pragma)/iu.test(query)) {
            const rows = statement.all(
              ...(bindings as (string | number | null)[]),
            ) as T[];
            return {
              toArray: () => rows,
              one: () => {
                if (rows.length !== 1) throw new Error("expected one row");
                return rows[0]!;
              },
            };
          }
          statement.run(...(bindings as (string | number | null)[]));
          return {
            toArray: () => [] as T[],
            one: () => {
              throw new Error("no rows");
            },
          };
        },
      },
      transactionSync<T>(callback: () => T): T {
        return callback();
      },
    },
  };
}

const digest = (character: string) => character.repeat(64);
const admission = (requestId = "request-a") => ({
  ownerId: "owner-a",
  requestId,
  requestFingerprint: digest("a"),
  preparedId: "prepared-a",
  preparedDigest: digest("b"),
  inputRevision: "revision-a",
  environment: { profileId: "profile-a" },
  timeoutMs: 60_000,
  maxAttempts: 3,
  artifacts: [],
});

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

describe("simulation control durable object", () => {
  it("wakes a held result read when the run becomes terminal", async () => {
    const control = new SimulationControlDO(sqliteState(), {}, () => 100);
    const accepted = await body<{ run: { id: string } }>(
      await control.fetch(
        new Request("https://control/accept", {
          method: "POST",
          body: JSON.stringify(admission()),
        }),
      ),
    );
    const path = `https://control/runs/${accepted.run.id}`;
    expect((await control.fetch(new Request(`${path}?waitMs=20001`))).status).toBe(
      400,
    );
    const waiting = control.fetch(new Request(`${path}?waitMs=20000`));
    await control.fetch(
      new Request(path, {
        method: "POST",
        body: JSON.stringify({
          kind: "lease-acquired",
          lease: { id: "lease", acquiredAt: 100, expiresAt: 1_000 },
        }),
      }),
    );
    await control.fetch(
      new Request(path, {
        method: "POST",
        body: JSON.stringify({
          kind: "completed",
          leaseId: "lease",
          at: 101,
          artifacts: [],
        }),
      }),
    );
    expect(await body(await waiting)).toMatchObject({
      run: { state: "succeeded" },
    });
  });

  it("uses policy defaults with Cloudflare env bindings and independently expires abandoned leases", async () => {
    let now = 100;
    const state = sqliteState();
    const control = new SimulationControlDO(
      state,
      { SIMULATION_ARTIFACTS: {} },
      () => now,
    );
    const accept = (requestId: string) =>
      control.fetch(
        new Request("https://control/accept", {
          method: "POST",
          body: JSON.stringify(admission(requestId)),
        }),
      );
    const first = await body<{ run: { id: string } }>(await accept("a"));
    expect(await body(await accept("b"))).toMatchObject({
      error: "OWNER_QUEUE_LIMIT",
    });
    await control.fetch(
      new Request(`https://control/runs/${first.run.id}`, {
        method: "POST",
        body: JSON.stringify({
          kind: "lease-acquired",
          lease: { id: "lease", acquiredAt: 100, expiresAt: 200 },
        }),
      }),
    );
    expect(await body(await accept("b"))).toMatchObject({
      error: "OWNER_ACTIVE_LIMIT",
    });
    expect(state.storage.setAlarm).toHaveBeenCalledWith(30_100);
    now = 30_100;
    await control.alarm();
    expect(
      await body(
        await control.fetch(
          new Request(`https://control/runs/${first.run.id}`),
        ),
      ),
    ).toMatchObject({
      run: {
        state: "infrastructure-failed",
        error: { code: "RUN_LEASE_EXPIRED", recovery: "not-retryable" },
      },
    });
    expect((await accept("b")).status).toBe(201);
    // The old idempotency key still resolves to its original terminal record.
    expect(await body(await accept("a"))).toMatchObject({
      accepted: false,
      run: { id: first.run.id, state: "infrastructure-failed" },
    });
  });

  it("expires the requested record before a delayed alarm without scanning history on every read", async () => {
    let now = 100;
    const state = sqliteState();
    const sql = vi.spyOn(state.storage.sql, "exec");
    const control = new SimulationControlDO(state, {}, () => now);
    const first = await body<{ run: { id: string } }>(
      await control.fetch(
        new Request("https://control/accept", {
          method: "POST",
          body: JSON.stringify(admission()),
        }),
      ),
    );
    const url = `https://control/runs/${first.run.id}`;
    await control.fetch(
      new Request(url, {
        method: "POST",
        body: JSON.stringify({
          kind: "lease-acquired",
          lease: { id: "lease", acquiredAt: 100, expiresAt: 200 },
        }),
      }),
    );
    now = 201;
    sql.mockClear();
    expect(await body(await control.fetch(new Request(url)))).toMatchObject({
      run: { state: "infrastructure-failed" },
    });
    expect(
      sql.mock.calls.some(
        ([query]) =>
          query.includes("SELECT record_json FROM simulation_runs") &&
          query.includes("finished_at"),
      ),
    ).toBe(false);
  });

  it("does not postpone an existing alarm after object reactivation", async () => {
    const state = sqliteState();
    state.storage.getAlarm.mockResolvedValue(150);
    const control = new SimulationControlDO(state, {}, () => 100);
    await control.fetch(new Request("https://control/operations"));
    expect(state.storage.setAlarm).not.toHaveBeenCalled();
  });

  it("issues an opaque anonymous owner capability and resolves it later", async () => {
    const control = new SimulationControlDO(
      sqliteState(),
      undefined,
      () => 100,
    );
    const issued = await control.fetch(
      new Request("https://control/anonymous-session", { method: "POST" }),
    );
    expect(issued.status).toBe(201);
    const cookie = issued.headers.get("set-cookie");
    expect(cookie).toContain(`${SIMULATION_SESSION_COOKIE}=`);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("Secure");
    const principal = await body<{ principal: { id: string } }>(issued);
    expect(principal.principal.id).toMatch(/^anonymous-/u);

    const resolved = await control.fetch(
      new Request("https://control/anonymous-session", {
        headers: { cookie: cookie!.split(";")[0]! },
      }),
    );
    expect(resolved.status).toBe(200);
    expect(await body(resolved)).toEqual(principal);
  });

  it("persists idempotent admission and lifecycle transitions", async () => {
    const state = sqliteState();
    const firstInstance = new SimulationControlDO(state, {}, () => 100);
    const acceptedResponse = await firstInstance.fetch(
      new Request("https://control/accept", {
        method: "POST",
        body: JSON.stringify(admission()),
      }),
    );
    expect(acceptedResponse.status).toBe(201);
    const accepted = await body<{
      accepted: boolean;
      run: { id: string; state: string };
    }>(acceptedResponse);
    expect(accepted).toMatchObject({
      accepted: true,
      run: { state: "queued" },
    });

    const restoredInstance = new SimulationControlDO(state, {}, () => 100);
    const retry = await body<{ accepted: boolean; run: { id: string } }>(
      await restoredInstance.fetch(
        new Request("https://control/accept", {
          method: "POST",
          body: JSON.stringify(admission()),
        }),
      ),
    );
    expect(retry).toEqual({ accepted: false, run: accepted.run });

    const leased = await body<{ run: { state: string; attempt: number } }>(
      await restoredInstance.fetch(
        new Request(`https://control/runs/${accepted.run.id}`, {
          method: "POST",
          body: JSON.stringify({
            kind: "lease-acquired",
            lease: { id: "lease-a", acquiredAt: 100, expiresAt: 1_000 },
          }),
        }),
      ),
    );
    expect(leased.run).toMatchObject({ state: "running", attempt: 1 });

    const read = await body<{ run: { state: string; lease: { id: string } } }>(
      await restoredInstance.fetch(
        new Request(`https://control/runs/${accepted.run.id}`),
      ),
    );
    expect(read.run).toMatchObject({
      state: "running",
      lease: { id: "lease-a" },
    });
    const listed = await body<{ runs: { id: string }[] }>(
      await restoredInstance.fetch(
        new Request("https://control/runs?ownerId=owner-a"),
      ),
    );
    expect(listed.runs.map((run) => run.id)).toEqual([accepted.run.id]);
  });

  it("enforces the per-owner queue limit atomically", async () => {
    const control = new SimulationControlDO(sqliteState());
    expect(
      (
        await control.fetch(
          new Request("https://control/accept", {
            method: "POST",
            body: JSON.stringify(admission()),
          }),
        )
      ).status,
    ).toBe(201);
    const refused = await control.fetch(
      new Request("https://control/accept", {
        method: "POST",
        body: JSON.stringify({
          ...admission("request-b"),
          requestFingerprint: digest("c"),
        }),
      }),
    );
    expect(refused.status).toBe(409);
    expect(await body(refused)).toEqual({
      error: "OWNER_QUEUE_LIMIT",
      retryAfterMs: 2_000,
    });
  });

  it("drains new work without invalidating idempotent reads of accepted work", async () => {
    const control = new SimulationControlDO(sqliteState());
    const accepted = await body<{ run: { id: string } }>(
      await control.fetch(
        new Request("https://control/accept", {
          method: "POST",
          body: JSON.stringify(admission()),
        }),
      ),
    );
    const drained = await control.fetch(
      new Request("https://control/operations", {
        method: "POST",
        body: JSON.stringify({ accepting: false }),
      }),
    );
    expect(await body(drained)).toMatchObject({
      accepting: false,
      counts: { queued: 1 },
    });
    expect(
      (
        await body<{ run: { id: string } }>(
          await control.fetch(
            new Request("https://control/accept", {
              method: "POST",
              body: JSON.stringify(admission()),
            }),
          ),
        )
      ).run.id,
    ).toBe(accepted.run.id);
    const refused = await control.fetch(
      new Request("https://control/accept", {
        method: "POST",
        body: JSON.stringify({
          ...admission("request-new"),
          requestFingerprint: digest("c"),
        }),
      }),
    );
    expect(refused.status).toBe(409);
    expect(await body(refused)).toMatchObject({
      error: "SIMULATION_DRAINED",
      retryAfterMs: 30_000,
    });
  });
});
