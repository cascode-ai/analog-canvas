import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

import {
  SIMULATION_SESSION_COOKIE,
  SimulationControlDO,
} from "./simulation-control-do";

function sqliteState() {
  const db = new DatabaseSync(":memory:");
  return {
    storage: {
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
    const firstInstance = new SimulationControlDO(state);
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

    const restoredInstance = new SimulationControlDO(state);
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
