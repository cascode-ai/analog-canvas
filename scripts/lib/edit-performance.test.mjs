import { expect, it } from "vitest";
import { sampleEditWorkload, editBudgets } from "./edit-performance.mjs";

it("derives independent ceilings from this run's baseline and rejects missing measurements", () => {
  expect(
    editBudgets({ rotate: { medianMs: 10 }, undo: { medianMs: 4 } }, [
      "rotate",
      "undo",
    ]),
  ).toEqual({ rotate: 15, undo: 6 });
  expect(() =>
    editBudgets({ rotate: { medianMs: 10 } }, ["rotate", "undo"]),
  ).toThrow(/undo/);
  expect(() => editBudgets({ rotate: { medianMs: 0 } }, ["rotate"])).toThrow(
    /rotate/,
  );
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
