import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  upgradeReferenceModelVersions,
  referenceModelTreeSha256,
  otaReferenceDeck,
} from "./vacask-sky130-reference.mjs";

describe("independent OTA reference sampling", () => {
  const input = { circuit: "* DUT", testbench: "* TB", corner: "ff" };
  it("changes only noise sampling and capture, not other electrical settings", () => {
    const original = otaReferenceDeck(input);
    expect(original).toContain('"../models/sky130.lib.spice" ff');
    expect(original).toContain("noise v(vout) VINP dec 20 1 1g\n");
    const dense = otaReferenceDeck({
      ...input,
      noisePointsPerDecade: 2000,
      noiseSourceDetails: true,
    });
    expect(dense).toBe(
      original
        .replace("dec 20 1 1g\n", "dec 2000 1 1g 1\n")
        .replace("noise.raw onoise_spectrum inoise_spectrum", "noise.raw all")
        .replace(
          "integrated.raw onoise_total inoise_total",
          "integrated.raw all",
        ),
    );
  });
  it.each([0, -1, 2.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
    "refuses invalid sampling %s instead of acquiring an accidental reference",
    (noisePointsPerDecade) => {
      expect(() =>
        otaReferenceDeck({ ...input, noisePointsPerDecade }),
      ).toThrow("positive safe integer");
    },
  );
});

describe("explicit reference model upgrade", () => {
  it("hashes the complete tree with the hosted byte/path convention", () => {
    const root = mkdtempSync(join(tmpdir(), "icm-reference-hash-"));
    try {
      mkdirSync(join(root, "continuous"));
      writeFileSync(join(root, "z"), "old");
      writeFileSync(join(root, "continuous", "a"), "VA\r\n");
      const hash = createHash("sha256");
      for (const [name, bytes] of [
        ["continuous/a", "VA\r\n"],
        ["z", "old"],
      ]) {
        hash.update(JSON.stringify(name));
        hash.update("\0" + Buffer.byteLength(bytes) + "\0");
        hash.update(bytes);
        hash.update("\0");
      }
      const before = referenceModelTreeSha256(root);
      expect(before).toBe(hash.digest("hex"));
      writeFileSync(join(root, "z"), "new");
      expect(referenceModelTreeSha256(root)).not.toBe(before);
    } finally {
      rmSync(root, { recursive: true });
    }
  });
  it("changes only the declared equation selector and records original versions", () => {
    const source =
      "* version = 4.5 is historical\r\n.model n nmos\r\n+ version = 4.5 vth0=0.4\r\n.model p pmos version=4.62\r\n.param w=10 l=0.5\r\n";
    const result = upgradeReferenceModelVersions(source);
    expect(result.counts).toEqual({ 4.5: 1, 4.62: 1 });
    expect(result.text).toBe(
      "* version = 4.5 is historical\r\n.model n nmos\r\n+ version = 4.8.3 vth0=0.4\r\n.model p pmos version=4.8.3\r\n.param w=10 l=0.5\r\n",
    );
  });
  it("refuses unknown or already upgraded references instead of disguising provenance", () => {
    expect(() => upgradeReferenceModelVersions("+ version=4.7")).toThrow(
      "Unexpected reference BSIM version",
    );
    expect(() => upgradeReferenceModelVersions("+ version=4.8.3")).toThrow(
      "Unexpected reference BSIM version",
    );
    expect(upgradeReferenceModelVersions("R1 a b 1k\n")).toEqual({
      text: "R1 a b 1k\n",
      counts: {},
    });
    expect(upgradeReferenceModelVersions("+ VERSION = 4.5\n")).toEqual({
      text: "+ VERSION = 4.8.3\n",
      counts: { 4.5: 1 },
    });
  });
});
