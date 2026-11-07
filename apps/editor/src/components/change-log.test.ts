import { describe, expect, it } from "vitest";

import { CHANGE_LOG } from "./change-log";
import { changeLogMonths } from "./change-log-page";

describe("the change log", () => {
  it("lists each day once, newest first, in one short line", () => {
    const dates = CHANGE_LOG.map((day) => day.date);
    expect(dates.every((date) => /^\d{4}-\d{2}-\d{2}$/u.test(date))).toBe(true);
    expect([...dates].sort().reverse()).toEqual(dates);
    expect(new Set(dates).size).toBe(dates.length);
    for (const { summary } of CHANGE_LOG) {
      expect(summary).toMatch(/\.$/u);
      expect(summary.length).toBeLessThanOrEqual(300);
    }
  });

  it("groups the days by month, newest month first", () => {
    const months = changeLogMonths([
      { date: "2026-11-02", summary: "B." },
      { date: "2026-11-01", summary: "A." },
      { date: "2026-10-31", summary: "Z." },
    ]);
    expect(months.map((month) => month.month)).toEqual([
      "November 2026",
      "October 2026",
    ]);
    expect(months[0]!.days.map((day) => day.date)).toEqual([
      "2026-11-02",
      "2026-11-01",
    ]);
  });
});
