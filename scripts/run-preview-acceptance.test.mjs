import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  deepPreviewSerialCommands,
  fastPreviewAcceptanceGroups,
  previewAcceptanceGroups,
  previewAcceptanceGroupsForMode,
  runPreviewAcceptance,
} from "./run-preview-acceptance.mjs";

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe("Preview acceptance runner", () => {
  it("covers every hosted acceptance journey in two parallel lanes", () => {
    expect(
      previewAcceptanceGroups.map((group) =>
        group.commands.map((command) => command.script),
      ),
    ).toEqual([
      ["scripts/preview-dual-engine-smoke.mjs"],
      [
        "scripts/preview-agent-simulation-journey.mjs",
        "scripts/preview-source-gui-journey.mjs",
        "scripts/preview-cross-project-simulation-journey.mjs",
      ],
    ]);
    expect(deepPreviewSerialCommands).toEqual([
      { script: "scripts/preview-simulation-smoke.mjs", args: [] },
    ]);
  });

  it("keeps the fast path to one managed-engine and one GUI journey", () => {
    expect(
      fastPreviewAcceptanceGroups.map((group) =>
        group.commands.map((command) => [command.script, ...command.args]),
      ),
    ).toEqual([
      [["scripts/preview-dual-engine-smoke.mjs"]],
      [["scripts/preview-source-gui-journey.mjs"]],
    ]);
    expect(previewAcceptanceGroupsForMode("fast")).toBe(
      fastPreviewAcceptanceGroups,
    );
    expect(previewAcceptanceGroupsForMode("deep")).toBe(
      previewAcceptanceGroups,
    );
  });

  it("starts both lanes together while retaining order inside each lane", async () => {
    const started = [];
    const children = [];
    const spawnProcess = (_executable, args) => {
      const child = new EventEmitter();
      started.push(args[0]);
      children.push(child);
      return child;
    };
    const running = runPreviewAcceptance("https://preview.example", {
      spawnProcess,
      environment: {},
      logger: { log() {} },
    });

    await flush();
    expect(started).toEqual([
      "scripts/preview-dual-engine-smoke.mjs",
      "scripts/preview-agent-simulation-journey.mjs",
    ]);

    children[0].emit("exit", 0, null);
    children[1].emit("exit", 0, null);
    await flush();
    expect(started.slice(2)).toEqual([
      "scripts/preview-source-gui-journey.mjs",
    ]);

    children[2].emit("exit", 0, null);
    await flush();
    expect(started.at(-1)).toBe(
      "scripts/preview-cross-project-simulation-journey.mjs",
    );
    children[3].emit("exit", 0, null);
    await flush();
    expect(started.at(-1)).toBe("scripts/preview-simulation-smoke.mjs");
    children[4].emit("exit", 0, null);
    await running;
  });

  it("runs both fast smoke lanes together", async () => {
    const started = [];
    const children = [];
    const spawnProcess = (_executable, args) => {
      const child = new EventEmitter();
      started.push(args[0]);
      children.push(child);
      return child;
    };
    const running = runPreviewAcceptance("https://preview.example", {
      mode: "fast",
      spawnProcess,
      environment: {},
      logger: { log() {} },
    });

    await flush();
    expect(started).toEqual([
      "scripts/preview-dual-engine-smoke.mjs",
      "scripts/preview-source-gui-journey.mjs",
    ]);
    for (const child of children) child.emit("exit", 0, null);
    await running;
  });
});
