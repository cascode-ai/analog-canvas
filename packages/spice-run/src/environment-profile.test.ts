import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

import {
  hostedProfileMismatches,
  validateHostedSimulationProfile,
} from "./environment-profile.js";

const HOSTED_SKY130_PROFILE = validateHostedSimulationProfile(
  JSON.parse(
    readFileSync(
      new URL(
        "../../../containers/ngspice/hosted-sky130-profile.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ),
);

describe("hosted simulation Profile", () => {
  it("is a complete named contract for the deployed SKY130 environment", () => {
    expect(validateHostedSimulationProfile(HOSTED_SKY130_PROFILE)).toBe(
      HOSTED_SKY130_PROFILE,
    );
    expect(HOSTED_SKY130_PROFILE.id).toBe(
      "sky130-core-continuous-ngspice46-v1",
    );
    expect(HOSTED_SKY130_PROFILE.models.library).toMatchObject({
      directive: "lib",
      runtimePath: "/opt/sky130/continuous/sky130.lib.spice",
      sections: ["tt"],
    });
    expect(HOSTED_SKY130_PROFILE.qualifiedScope.analyses).toEqual(["op", "ac"]);
  });

  it("accepts exact observed identity and names every drift", () => {
    const observed = {
      platform: HOSTED_SKY130_PROFILE.platform,
      simulatorVersion: HOSTED_SKY130_PROFILE.simulator.version,
      simulatorBinarySha256: HOSTED_SKY130_PROFILE.simulator.binarySha256,
      modelTreeSha256: HOSTED_SKY130_PROFILE.models.contentSha256,
      startupSha256: HOSTED_SKY130_PROFILE.startup.contentSha256,
    };
    expect(hostedProfileMismatches(HOSTED_SKY130_PROFILE, observed)).toEqual(
      [],
    );
    expect(
      hostedProfileMismatches(HOSTED_SKY130_PROFILE, {
        ...observed,
        simulatorVersion: "ngspice-47",
        startupSha256: "0".repeat(64),
      }),
    ).toEqual([
      "simulator version: expected ngspice-46, observed ngspice-47",
      `startup SHA-256: expected ${HOSTED_SKY130_PROFILE.startup.contentSha256}, observed ${"0".repeat(64)}`,
    ]);
  });

  it("rejects an incomplete contract", () => {
    expect(() =>
      validateHostedSimulationProfile({
        ...HOSTED_SKY130_PROFILE,
        simulator: { name: "ngspice", version: "ngspice-46" },
      }),
    ).toThrow(/incomplete or malformed/u);
  });
});
