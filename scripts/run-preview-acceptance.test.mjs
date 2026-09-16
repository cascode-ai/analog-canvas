import { EventEmitter } from "node:events";

import { describe, expect, it } from "vitest";

import {
  previewAcceptanceGroups,
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
      [
        "scripts/preview-dual-engine-smoke.mjs",
        "scripts/preview-simulation-smoke.mjs",
      ],
      [
        "scripts/preview-agent-simulation-journey.mjs",
        "scripts/preview-source-gui-journey.mjs",
        "scripts/preview-cross-project-simulation-journey.mjs",
      ],
    ]);
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
      "scripts/preview-simulation-smoke.mjs",
      "scripts/preview-source-gui-journey.mjs",
    ]);

    children[2].emit("exit", 0, null);
    children[3].emit("exit", 0, null);
    await flush();
    expect(started.at(-1)).toBe(
      "scripts/preview-cross-project-simulation-journey.mjs",
    );
    children[4].emit("exit", 0, null);
    await running;
  });
});
