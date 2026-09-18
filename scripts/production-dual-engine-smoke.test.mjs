import { describe, expect, it, vi } from "vitest";

import {
  NGSPICE_PROFILE_ID,
  runProductionDualEngineSmoke,
  VACASK_PROFILE_ID,
} from "./production-dual-engine-smoke.mjs";

describe("dependency-free Production dual-engine smoke", () => {
  it("discovers both Profiles and executes a native divider", async () => {
    const fetchImpl = vi.fn(async (_url, init) => {
      const body = JSON.parse(init.body);
      if (body.operation === "capabilities")
        return Response.json({
          profiles: [
            { id: NGSPICE_PROFILE_ID, engine: "ngspice" },
            { id: VACASK_PROFILE_ID, engine: "vacask" },
          ],
        });
      expect(body).toMatchObject({
        language: "vacask",
        environment: { profileId: VACASK_PROFILE_ID },
        collection: { kind: "native-multi-ascii" },
      });
      expect(body.testbench.endsWith("\n")).toBe(true);
      return Response.json({
        outcome: { status: "completed" },
        metadata: {
          environment: {
            profileId: VACASK_PROFILE_ID,
            simulator: { name: "vacask" },
            fingerprint: "native-fingerprint",
          },
        },
        rawfiles: [
          {
            path: "divider_op.raw",
            text: "Values:\n 0\t-5.000000000000000e-04\n\t1.000000000000000e+00\n\t5.000000000000000e-01\n",
          },
        ],
      });
    });

    await expect(
      runProductionDualEngineSmoke({
        baseUrl: "https://canvas.test",
        fetchImpl,
      }),
    ).resolves.toEqual({
      profiles: [NGSPICE_PROFILE_ID, VACASK_PROFILE_ID],
      environmentFingerprint: "native-fingerprint",
      midpoint: 0.5,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("fails when Production advertises only one engine", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json({
        profiles: [{ id: NGSPICE_PROFILE_ID, engine: "ngspice" }],
      }),
    );
    await expect(
      runProductionDualEngineSmoke({
        baseUrl: "https://canvas.test",
        fetchImpl,
      }),
    ).rejects.toThrow();
  });
});
