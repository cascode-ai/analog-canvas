import { describe, expect, it } from "vitest";
import type { Capabilities } from "./contract.js";
import type { ExecutionInput, Executor } from "./executor.js";
import { createProfileRoutedExecutor } from "./profile-routed-executor.js";

const capabilities = (...ids: string[]): Capabilities => ({
  configured: true,
  inputs: ["source"],
  analyses: ["op"],
  parsedAnalyses: ["op"],
  profiles: ids.map((id) => ({ id, label: `${id} label`, corners: [] })),
  maxTimeoutMs: 120000,
  maxInputBytes: 1024,
  cancel: true,
});

/** An Executor port that records what reached it. */
function recording(name: string, profiles: string[], fail = false) {
  const calls: string[] = [];
  const executor: Executor = {
    async capabilities(profileId) {
      calls.push(`capabilities:${profileId ?? "*"}`);
      if (fail) throw new Error(`${name} unreachable`);
      return capabilities(...profiles);
    },
    async execute(input, runToken) {
      calls.push(`execute:${runToken}`);
      return { profileId: input.environment.profileId, by: name } as never;
    },
    async cancel(runToken) {
      calls.push(`cancel:${runToken}`);
    },
  };
  return { executor, calls };
}

const input = (profileId: string): ExecutionInput => ({
  mode: "raw",
  netlist: "",
  testbench: "* t",
  files: [],
  dependencies: [],
  inputRevision: "r",
  environment: { profileId },
});

describe("Profile-routed execution", () => {
  it("runs and cancels a local Profile locally and every other Profile on the hosted executor", async () => {
    const local = recording("local", ["sky"]);
    const hosted = recording("hosted", ["sky", "sg13"]);
    const executor = createProfileRoutedExecutor(
      { profileIds: ["sky"], executor: local.executor },
      hosted.executor,
    );
    await expect(executor.execute(input("sky"), "a")).resolves.toMatchObject({
      by: "local",
    });
    await expect(executor.execute(input("sg13"), "b")).resolves.toMatchObject({
      by: "hosted",
    });
    await executor.cancel("a", "sky");
    await executor.cancel("b", "sg13");
    expect(local.calls).toEqual(["execute:a", "cancel:a"]);
    expect(hosted.calls).toEqual(["execute:b", "cancel:b"]);
  });

  it("cancels a local run locally even when the caller names no Profile", async () => {
    const local = recording("local", ["sky"]);
    const hosted = recording("hosted", []);
    let release!: () => void;
    local.executor.execute = async () =>
      new Promise((resolve) => (release = () => resolve({} as never)));
    const executor = createProfileRoutedExecutor(
      { profileIds: ["sky"], executor: local.executor },
      hosted.executor,
    );
    const running = executor.execute(input("sky"), "a");
    await executor.cancel("a");
    release();
    await running;
    expect(local.calls).toEqual(["cancel:a"]);
    expect(hosted.calls).toEqual([]);
  });

  it("asks each executor only for its own Profiles", async () => {
    const local = recording("local", ["sky"]);
    const hosted = recording("hosted", ["sg13"]);
    const executor = createProfileRoutedExecutor(
      { profileIds: ["sky"], executor: local.executor },
      hosted.executor,
    );
    await executor.capabilities("sky");
    await executor.capabilities("sg13");
    expect(local.calls).toEqual(["capabilities:sky"]);
    expect(hosted.calls).toEqual(["capabilities:sg13"]);
  });

  it("lists the local Profiles in place of the hosted ones, and alone when the hosted executor is unreachable", async () => {
    const local = recording("local", ["sky"]);
    const hosted = recording("hosted", ["sg13", "sky"]);
    const routed = createProfileRoutedExecutor(
      { profileIds: ["sky"], executor: local.executor },
      hosted.executor,
    );
    expect((await routed.capabilities()).profiles.map((p) => p.id)).toEqual([
      "sky",
      "sg13",
    ]);
    const offline = createProfileRoutedExecutor(
      { profileIds: ["sky"], executor: local.executor },
      recording("hosted", [], true).executor,
    );
    expect((await offline.capabilities()).profiles.map((p) => p.id)).toEqual([
      "sky",
    ]);
  });
});
