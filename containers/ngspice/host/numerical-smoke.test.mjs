import { describe, expect, it, vi } from "vitest";

import { readMidpoint, runNumericalSmoke } from "./numerical-smoke.mjs";

const rawfile = [
  "Title: operator host smoke",
  "Plotname: Operating Point",
  "No. Variables: 2",
  "No. Points: 1",
  "Variables:",
  " 0 v(in) voltage",
  " 1 v(mid) voltage",
  "Values:",
  " 0 1.000000000000000e+00",
  "   5.000000000000000e-01",
  "",
].join("\n");

describe("the operator-host numerical smoke", () => {
  it("requires the equal divider's rawfile value", () => {
    expect(readMidpoint(rawfile)).toBe(0.5);
    expect(() =>
      readMidpoint(rawfile.replace("5.000000000000000e-01", "0.4")),
    ).toThrow("expected 0.5");
  });

  it("runs through the authenticated harness contract", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({ timedOut: false, rawfileFormat: "ascii", rawfile }),
    );

    await expect(
      runNumericalSmoke({ fetchImpl, token: "test-token" }),
    ).resolves.toBe(0.5);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:8080/run",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          authorization: "Bearer test-token",
        }),
      }),
    );
  });

  it("reports the filesystem symptom instead of accepting an empty result", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        timedOut: false,
        rawfileFormat: null,
        rawfile: null,
        log: "tmpfile(): Read-only file system",
      }),
    );

    await expect(
      runNumericalSmoke({ fetchImpl, token: "test-token" }),
    ).rejects.toThrow("tmpfile(): Read-only file system");
  });
});
