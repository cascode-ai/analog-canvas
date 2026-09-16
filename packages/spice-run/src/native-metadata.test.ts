import { describe, expect, it } from "vitest";
import {
  createSimulationEnvironmentMetadata,
  verifySimulationEnvironmentMetadata,
} from "./metadata.js";

describe("native environment identity", () => {
  it("fingerprints VACASK honestly and keeps legacy result identities readable", async () => {
    const native = await createSimulationEnvironmentMetadata({
      executor: "local-host",
      reproducibility: "observed",
      profileId: null,
      platform: "linux/x64",
      simulator: {
        name: "vacask",
        version: "0.3.4",
        binarySha256: "a".repeat(64),
      },
      models: null,
      startupSha256: "b".repeat(64),
    });
    expect(await verifySimulationEnvironmentMetadata(native)).toEqual(native);
    expect(native.reproducibility).toBe("observed");
    const tampered = {
      ...native,
      simulator: { ...native.simulator, name: "ngspice" as const },
    };
    expect(await verifySimulationEnvironmentMetadata(tampered)).toBeNull();
    const legacy = await createSimulationEnvironmentMetadata(tampered);
    expect(await verifySimulationEnvironmentMetadata(legacy)).toEqual(legacy);
    expect(legacy.fingerprint).not.toBe(native.fingerprint);
    expect(
      await verifySimulationEnvironmentMetadata({
        ...native,
        simulator: { ...native.simulator, name: "other" },
      }),
    ).toBeNull();
  });
});
