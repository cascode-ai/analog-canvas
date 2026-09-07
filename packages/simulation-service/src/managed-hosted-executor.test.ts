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
