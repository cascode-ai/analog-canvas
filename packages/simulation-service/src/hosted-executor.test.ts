import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { readSimulationData } from "@icm/spice-run";
import {
  createHostedExecutor,
  decodeHostedExecutionPayload,
} from "./hosted-executor.js";
import type { ExecutionInput } from "./executor.js";
const input: ExecutionInput = {
  mode: "raw",
  netlist: "",
  testbench: "* test",
  files: [],
  dependencies: [],
  inputRevision: "rev",
  environment: { profileId: "p" },
};
describe("hosted executor recovery", () => {
  it("normalizes scalar dimensions from an older executor without losing raw evidence or reviving withheld data", () => {
    const rawfile = readFileSync(
      new URL(
        "../../../fixtures/ngspice-rawfile/native-scalars-ac.raw",
        import.meta.url,
      ),
      "utf8",
    );
    const old = readSimulationData(rawfile.replaceAll(" dims=1", ""));
    if (old.status !== "read") throw Error("read expected");
    const payload = {
      outcome: { status: "completed" },
      diagnostics: [],
      log: "done",
      durationMs: 1,
      metadata: {
        schemaVersion: 1,
        input: {
          inputRevision: "rev",
          netlistSha256: "a".repeat(64),
          testbenchSha256: "b".repeat(64),
          deckSha256: "c".repeat(64),
        },
        configuration: { modelLibrary: null },
        environment: {
          executor: "hosted-container",
          reproducibility: "pinned",
          profileId: "p",
          platform: "linux/x64",
          simulator: { name: "ngspice", version: "46", binarySha256: null },
          models: null,
          startupSha256: null,
          fingerprint: "fixture",
        },
      },
      data: old.data,
      rawfile,
    };
    const normalized = decodeHostedExecutionPayload(input, payload);
    expect(normalized.result.data?.analyses[0]?.scalars?.[0]?.value).toBe(4);
    expect(normalized.result.data?.analyses[0]?.probes).toHaveLength(2);
    expect(normalized.rawfile).toBe(rawfile);
    expect(normalized.result.outcome.status).toBe("completed");
    const { data: _data, ...withheld } = payload;
    expect(
      decodeHostedExecutionPayload(input, withheld).result.data,
    ).toBeUndefined();
    const invalid = decodeHostedExecutionPayload(input, {
      ...payload,
      rawfile: rawfile.replace("dims=1", "dims=2"),
    });
    expect(invalid.result.outcome.status).toBe("failed");
    expect(invalid.result.data).toBeUndefined();
    expect(invalid.rawfile).toContain("dims=2");
  });
  it("preserves cancellation uncertainty and the executor retry delay", async () => {
    const executor = createHostedExecutor(async () =>
      Response.json({ error: "cancel-response-unknown" }, { status: 502 }),
    );
    await expect(executor.cancel("token")).rejects.toMatchObject({
      problem: { stage: "cancel", recovery: "retry-same-request" },
    });
    const busy = createHostedExecutor(async () =>
      Response.json(
        { error: "simulator-busy" },
        { status: 503, headers: { "retry-after": "7" } },
      ),
    );
    await expect(busy.execute(input, "token")).rejects.toMatchObject({
      problem: { retryAfterMs: 7000 },
    });
  });
  it("reports unavailable capability transport as retryable, not an internal/session failure", async () => {
    const executor = createHostedExecutor(async () => {
      throw Error("offline");
    });
    await expect(executor.capabilities()).rejects.toMatchObject({
      problem: {
        code: "SIMULATION_CAPABILITIES_UNAVAILABLE",
        recovery: "retry-after",
      },
    });
  });
  it.each([
    ["simulation-not-configured", "retry-after"],
    ["prepared-environment-changed", "reprepare"],
    ["simulator-busy", "retry-after"],
  ])("classifies %s without blaming circuit input", async (code, recovery) => {
    const executor = createHostedExecutor(async () =>
      Response.json({ error: code }, { status: 503 }),
    );
    await expect(executor.execute(input, "token")).rejects.toMatchObject({
      acceptedUnknown: false,
      problem: { code, recovery },
    });
  });
});
