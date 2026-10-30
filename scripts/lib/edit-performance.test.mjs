import { expect, it } from "vitest";
import {
  sampleEditWorkload,
  selectEditReference,
} from "./edit-performance.mjs";

it("keeps CI and local machine ceilings separate and refuses an uncalibrated environment", () => {
  const references = {
    "linux-x64-ci": {
      fast: { budgets: { rotate: 10 } },
      slow: { budgets: { rotate: 18 } },
    },
    "win32-x64-local": {
      workstation: { budgets: { rotate: 40 } },
    },
  };
  expect(
    selectEditReference(references, "linux", "x64", "fast", true).budgets
      .rotate,
  ).toBe(10);
  expect(
    selectEditReference(references, "linux", "x64", "slow", true).budgets
      .rotate,
  ).toBe(18);
  expect(
    selectEditReference(references, "win32", "x64", "workstation").budgets
      .rotate,
  ).toBe(40);
  expect(() =>
    selectEditReference(references, "win32", "x64", "workstation", true),
  ).toThrow(/No editing performance reference/);
  expect(() =>
    selectEditReference(references, "linux", "x64", "unknown", true),
  ).toThrow(/calibrate-edits/);
  expect(() =>
    selectEditReference(references, "darwin", "arm64", "M1"),
  ).toThrow(/calibrate-edits/);
});

it("budgets the median edit cost, excluding setup and verification, and rejects a doubled edit", () => {
  let now = 0;
  let iteration = 0;
  const factory = () => {
    now += 1000;
    return {
      run: () => {
        now += ++iteration % 5 === 0 ? 500 : 10;
      },
      verify: () => {
        now += 1000;
      },
    };
  };
  const options = {
    now: () => now,
    delay: (milliseconds) => {
      now += milliseconds;
    },
  };
  expect(sampleEditWorkload(factory, 15, options)).toMatchObject({
    medianMs: 10,
    passed: true,
  });
  expect(
    sampleEditWorkload(factory, 15, { ...options, slowdown: 2 }),
  ).toMatchObject({ medianMs: 20, passed: false });
});
