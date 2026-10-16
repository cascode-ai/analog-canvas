import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ARENA_GATE_DAY_KEY,
  cloudShelfOpened,
  gateAfterManualCloudSave,
} from "./arena-gate-request";
import type { mountArenaGate } from "./arena-gate-panel";

type Mounted = Parameters<typeof mountArenaGate>[0];

/** A stand-in for the panel's code that keeps each gate it is asked for. */
function panel() {
  const mounted: Mounted[] = [];
  const load = async () => ({
    mountArenaGate: async (options: Mounted) => {
      mounted.push(options);
    },
  });
  return { mounted, load };
}

const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** This browser's storage, as the gate keeps its day in it. */
function storage() {
  const items = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  });
  return items;
}

describe("opening the Arena gate", () => {
  it("opens once a manual Cloud Save has completed, saying the work is saved", async () => {
    vi.stubGlobal("document", {});
    const { mounted, load } = panel();
    const outcome = { status: "saved" as const };
    expect(gateAfterManualCloudSave(outcome, load)).toBe(outcome);
    await settled();
    expect(mounted.map((gate) => gate.saved)).toEqual([true]);
    mounted[0]!.closed();
  });

  it("stays shut when nothing was saved", async () => {
    vi.stubGlobal("document", {});
    const { mounted, load } = panel();
    for (const status of ["conflict", "unreachable", "unauthorized", "failed"])
      gateAfterManualCloudSave({ status }, load);
    await settled();
    expect(mounted).toEqual([]);
  });

  it("opens on a shelf opening without claiming a save, and once at a time", async () => {
    vi.stubGlobal("document", {});
    const { mounted, load } = panel();
    cloudShelfOpened(load);
    cloudShelfOpened(load);
    await settled();
    expect(mounted.map((gate) => gate.saved)).toEqual([false]);
    mounted[0]!.closed();
    cloudShelfOpened(load);
    await settled();
    expect(mounted).toHaveLength(2);
    mounted[1]!.closed();
  });

  it("shows at most once a browser day, however it was closed (#1718)", async () => {
    vi.stubGlobal("document", {});
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 9, 14, 9));
    const items = storage();
    const { mounted, load } = panel();
    cloudShelfOpened(load);
    await settled();
    mounted[0]!.shown();
    mounted[0]!.closed();
    expect(items.get(ARENA_GATE_DAY_KEY)).toBe("2026-10-14");
    // Later that day, a save or a shelf opening asks for nothing.
    gateAfterManualCloudSave({ status: "saved" }, load);
    cloudShelfOpened(load);
    await settled();
    expect(mounted).toHaveLength(1);
    // The next day it may show again.
    vi.setSystemTime(new Date(2026, 9, 15, 9));
    cloudShelfOpened(load);
    await settled();
    expect(mounted).toHaveLength(2);
    mounted[1]!.closed();
  });
});
