import { describe, expect, it } from "vitest";
import {
  createSimulationEnvironmentMetadata,
  isRawMultiFileTestbench,
  verifySimulationEnvironmentMetadata,
} from "./metadata.js";

describe("simulation environment identity", () => {
  it("fingerprints ngspice honestly and rejects tampered or unknown simulator names", async () => {
    const measured = await createSimulationEnvironmentMetadata({
      executor: "local-host",
      reproducibility: "observed",
      profileId: null,
      platform: "linux/x64",
      simulator: {
        name: "ngspice",
        version: "46",
        binarySha256: "a".repeat(64),
      },
      models: null,
      startupSha256: "b".repeat(64),
    });
    expect(await verifySimulationEnvironmentMetadata(measured)).toEqual(
      measured,
    );
    expect(measured.reproducibility).toBe("observed");
    const bumped = await createSimulationEnvironmentMetadata({
      ...measured,
      simulator: { ...measured.simulator, version: "47" },
    });
    expect(await verifySimulationEnvironmentMetadata(bumped)).toEqual(bumped);
    expect(bumped.fingerprint).not.toBe(measured.fingerprint);
    expect(
      await verifySimulationEnvironmentMetadata({
        ...measured,
        simulator: { ...measured.simulator, version: "47" },
      }),
    ).toBeNull();
    for (const name of ["vacask", "other"])
      expect(
        await verifySimulationEnvironmentMetadata({
          ...measured,
          simulator: { ...measured.simulator, name },
        }),
      ).toBeNull();
  });

  it("binds raw testbench metadata text to unique submitted file slices", () => {
    const files = [
      {
        path: "run.cir",
        text: '* entry\n.include "tb.spice"\n.include "circuit.spice"\n.end\n',
      },
      { path: "tb.spice", text: "* tb\nV1 in 0 1\n" },
      { path: "circuit.spice", text: "* circuit\nR1 in 0 1k\n" },
    ];
    const authored = `${files[0]!.text}\n${files[1]!.text}`;
    expect(
      isRawMultiFileTestbench(authored, files[0]!.text, files, "run.cir"),
    ).toBe(true);
    // createSimulationFolder places testbench.spice before run.cir (entryIndex = 1).
    const entrySecond = [files[1]!, files[0]!, files[2]!];
    const authoredSecond = `${files[1]!.text}\n${files[0]!.text}`;
    expect(
      isRawMultiFileTestbench(
        authoredSecond,
        files[0]!.text,
        entrySecond,
        "run.cir",
      ),
    ).toBe(true);
    // Rejects duplicate file paths (unexecuted bytes could otherwise be signed).
    expect(
      isRawMultiFileTestbench(
        authored,
        files[0]!.text,
        [...files, { path: "tb.spice", text: "* override\n" }],
        "run.cir",
      ),
    ).toBe(false);
    // Rejects empty deck, wrong order, or missing entry slice.
    expect(
      isRawMultiFileTestbench(
        "x",
        "",
        [{ path: "run.cir", text: "" }],
        "run.cir",
      ),
    ).toBe(false);
    expect(
      isRawMultiFileTestbench(
        `${files[1]!.text}\n${files[0]!.text}`,
        files[0]!.text,
        files,
        "run.cir",
      ),
    ).toBe(false);
    expect(
      isRawMultiFileTestbench(files[2]!.text, files[0]!.text, files, "run.cir"),
    ).toBe(false);
  });
});
