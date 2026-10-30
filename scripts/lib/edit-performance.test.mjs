import { expect, it } from "vitest";
import { sampleEditWorkload } from "./edit-performance.mjs";

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
