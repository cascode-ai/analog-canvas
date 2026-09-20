import { describe, expect, it, vi } from "vitest";

import type { ExecutionInput } from "./executor.js";
import { createManagedHostedExecutor } from "./managed-hosted-executor.js";

const input: ExecutionInput = {
  mode: "raw",
  netlist: "",
  testbench: "* test\n.end",
  files: [],
  dependencies: [],
  inputRevision: "revision-a",
  environment: { profileId: "profile-a" },
};

const baseRun = {
  schemaVersion: 1 as const,
  id: "server-run-a",
  ownerId: "owner-a",
  requestId: "request-a",
  requestFingerprint: "a".repeat(64),
  preparedId: "prepared-a",
  preparedDigest: "b".repeat(64),
  inputRevision: "revision-a",
  environment: { profileId: "profile-a" },
  timeoutMs: 60_000,
  attempt: 1,
  maxAttempts: 3,
  createdAt: 1,
  updatedAt: 2,
  queuedAt: 1,
  startedAt: 2,
  artifacts: [],
};

const result = {
  outcome: { status: "completed" },
  diagnostics: [],
  log: "done",
  durationMs: 5,
  metadata: {
    schemaVersion: 1,
    input: {
      inputRevision: "revision-a",
      netlistSha256: "c".repeat(64),
      testbenchSha256: "d".repeat(64),
      deckSha256: "e".repeat(64),
    },
    configuration: { modelLibrary: null },
    environment: {
      executor: "hosted-container",
      reproducibility: "pinned",
      profileId: "profile-a",
      platform: "linux/x64",
      simulator: {
        name: "ngspice",
        version: "47",
        binarySha256: "f".repeat(64),
      },
      models: null,
      startupSha256: null,
      fingerprint: "fixture",
    },
  },
};

describe("managed hosted executor", () => {
  it("reports broken result streams as uncertain and preserves admission identity on retry", async () => {
    let resultReads = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (path) => {
      if (String(path).endsWith("/result")) {
        if (++resultReads === 1)
          return new Response(
            new ReadableStream({
              start(controller) {
                controller.error(new Error("connection lost"));
              },
            }),
          );
        return Response.json(result);
      }
      return Response.json({
        run: { ...baseRun, state: "succeeded", finishedAt: 3 },
      });
    });
    const executor = createManagedHostedExecutor({ fetch });
    const identity = {
      preparedId: "prepared-a",
      preparedDigest: "b".repeat(64),
    };
    await expect(
      executor.execute(input, "request-a", undefined, identity),
    ).rejects.toMatchObject({
      problem: {
        code: "RUN_RESPONSE_UNKNOWN",
        recovery: "retry-same-request",
        stage: "read",
      },
    });
    await expect(
      executor.execute(input, "request-a", undefined, identity),
    ).resolves.toMatchObject({ result: { outcome: { status: "completed" } } });
    const admissions = fetch.mock.calls.filter(
      ([, init]) => init?.method === "POST",
    );
    expect(admissions).toHaveLength(2);
    // Re-admission uses the same request and immutable input, so the server's
    // existing idempotency record resolves to the original run, not a new run.
    expect(admissions[0]?.[1]?.body).toBe(admissions[1]?.[1]?.body);
    expect(resultReads).toBe(2);
  });
  it("keeps a failed analysis result instead of replacing its evidence with the run error", async () => {
    const failed = {
      ...result,
      outcome: { status: "failed" },
      log: "analysis did not converge",
    };
    const fetch = vi.fn<typeof globalThis.fetch>(async (path) =>
      String(path).endsWith("/result")
        ? Response.json(failed)
        : Response.json({
            run: {
              ...baseRun,
              state: "failed",
              finishedAt: 3,
              error: {
                code: "SIMULATION_FAILED",
                message: "Analysis failed",
                stage: "start",
                recovery: "fix-input",
              },
              artifacts: [
                {
                  id: "reply",
                  name: "response.json",
                  mediaType: "application/json",
                  byteLength: 1,
                  sha256: "a".repeat(64),
                },
              ],
            },
          }),
    );
    const executor = createManagedHostedExecutor({ fetch });
    await expect(
      executor.execute(input, "request-a", undefined, {
        preparedId: "prepared-a",
        preparedDigest: "b".repeat(64),
      }),
    ).resolves.toMatchObject({
      result: { outcome: { status: "failed" }, log: failed.log },
    });
  });
  it.each(["refused", "missing-input", "cancelled"])(
    "preserves a terminal %s without pretending it has numeric output",
    async (kind) => {
      const problem = {
        code: "prepared-input-changed",
        message: "Prepare the changed input again.",
        stage: "start",
        recovery: "reprepare",
      };
      const fetch = vi.fn<typeof globalThis.fetch>(async (path) => {
        if (String(path).endsWith("/result"))
          return Response.json({
            error: problem.code,
            message: problem.message,
          });
        return Response.json({
          run: {
            ...baseRun,
            state: kind === "cancelled" ? "cancelled" : "failed",
            finishedAt: 3,
            ...(kind === "cancelled" ? {} : { error: problem }),
            artifacts:
              kind === "refused"
                ? [
                    {
                      id: "reply",
                      name: "response.json",
                      mediaType: "application/json",
                      byteLength: 1,
                      sha256: "a".repeat(64),
                    },
                  ]
                : [],
          },
        });
      });
      const executor = createManagedHostedExecutor({ fetch });
      await expect(
        executor.execute(input, "request-a", undefined, {
          preparedId: "prepared-a",
          preparedDigest: "b".repeat(64),
        }),
      ).rejects.toMatchObject({
        problem:
          kind === "cancelled"
            ? { code: "run-cancelled", stage: "cancel" }
            : problem,
      });
      expect(
        fetch.mock.calls.filter(([path]) => String(path).endsWith("/result")),
      ).toHaveLength(kind === "refused" ? 1 : 0);
      expect(
        fetch.mock.calls.filter(([, init]) => init?.method === "POST"),
      ).toHaveLength(1);
    },
  );
  it("submits immutable identity, polls the server run, and reads its result", async () => {
    let reads = 0;
    const fetch = vi.fn<typeof globalThis.fetch>(async (request, init) => {
      const path =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.toString()
            : request.url;
      if (path === "/api/simulation/runs") {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          requestId: "request-a",
          preparedId: "prepared-a",
          preparedDigest: "b".repeat(64),
          input: { inputRevision: "revision-a", timeoutMs: 10_000 },
        });
        return Response.json({ run: { ...baseRun, state: "queued" } });
      }
      if (path === "/api/simulation/runs/server-run-a/result")
        return Response.json(result);
      if (path === "/api/simulation/runs/server-run-a") {
        reads++;
        return Response.json({
          run: {
            ...baseRun,
            state: reads === 1 ? "running" : "succeeded",
            ...(reads === 1 ? {} : { finishedAt: 3 }),
          },
        });
      }
      throw new Error(`unexpected ${path}`);
    });
    const executor = createManagedHostedExecutor({
      fetch,
      sleep: async () => undefined,
    });
    await expect(
      executor.execute(input, "request-a", 10_000, {
        preparedId: "prepared-a",
        preparedDigest: "b".repeat(64),
      }),
    ).resolves.toMatchObject({ result: { outcome: { status: "completed" } } });
    expect(reads).toBe(2);
  });

  it("cancels the server run identity rather than resubmitting work", async () => {
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const fetch = vi.fn<typeof globalThis.fetch>(async (request) => {
      const path =
        typeof request === "string"
          ? request
          : request instanceof URL
            ? request.toString()
            : request.url;
      if (path === "/api/simulation/runs") {
        await startGate;
        return Response.json({ run: { ...baseRun, state: "queued" } });
      }
      if (path === "/api/simulation/runs/server-run-a/cancel")
        return Response.json({
          run: { ...baseRun, state: "cancelled", finishedAt: 3 },
        });
      if (path === "/api/simulation/runs/server-run-a")
        return Response.json({
          run: { ...baseRun, state: "infrastructure-failed", finishedAt: 3 },
        });
      throw new Error(`unexpected ${path}`);
    });
    const executor = createManagedHostedExecutor({
      fetch,
      sleep: async () => undefined,
    });
    const running = executor.execute(input, "request-a", undefined, {
      preparedId: "prepared-a",
      preparedDigest: "b".repeat(64),
    });
    const cancelling = executor.cancel("request-a");
    releaseStart();
    await cancelling;
    await expect(running).rejects.toMatchObject({
      problem: { code: "MANAGED_RUN_UNAVAILABLE" },
    });
    expect(fetch).toHaveBeenCalledWith(
      "/api/simulation/runs/server-run-a/cancel",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
