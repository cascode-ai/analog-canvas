import { describe, expect, it } from "vitest";

import { isDailyAllowanceRefusal } from "./daily-allowance";

describe("isDailyAllowanceRefusal", () => {
  it("tells a daily allowance from the minute-long flood limit", async () => {
    const refusal = (error: string) =>
      Response.json({ error }, { status: 429 });
    expect(await isDailyAllowanceRefusal(refusal("rate-limited"))).toBe(true);
    expect(await isDailyAllowanceRefusal(refusal("daily-open-limit"))).toBe(
      true,
    );
    expect(await isDailyAllowanceRefusal(refusal("too-many-requests"))).toBe(
      false,
    );
    expect(
      await isDailyAllowanceRefusal(Response.json({}, { status: 503 })),
    ).toBe(false);
  });
});
