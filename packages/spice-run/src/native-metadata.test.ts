import { describe, expect, it } from "vitest";
import {
  createSimulationEnvironmentMetadata,
  isRawMultiFileTestbench,
  isValidRawExecutionInputMetadata,
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

  it("binds raw netlist and testbench metadata texts to unique submitted file slices (#1407)", () => {
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
    expect(
      isValidRawExecutionInputMetadata(
        {
          netlist: files[2]!.text,
          testbench: authoredSecond,
          deck: files[0]!.text,
        },
        entrySecond,
        "run.cir",
      ),
    ).toBe(true);
    expect(
      isValidRawExecutionInputMetadata(
        { netlist: files[2]!.text, testbench: authored, deck: files[0]!.text },
        files,
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
    // Rejects empty deck, overlapping netlist/testbench, bridging across entry, wrong order.
    expect(
      isRawMultiFileTestbench(
        "x",
        "",
        [{ path: "run.cir", text: "" }],
        "run.cir",
      ),
    ).toBe(false);
    expect(
      isValidRawExecutionInputMetadata(
        { netlist: files[1]!.text, testbench: authored, deck: files[0]!.text },
        files,
        "run.cir",
      ),
    ).toBe(false);
    const sandwiched = [
      { path: "a.inc", text: "A\n" },
      { path: "run.cir", text: "ENTRY\n" },
      { path: "b.inc", text: "B\n" },
    ];
    expect(
      isValidRawExecutionInputMetadata(
        { netlist: "A\n\nB\n", testbench: "ENTRY\n", deck: "ENTRY\n" },
        sandwiched,
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
