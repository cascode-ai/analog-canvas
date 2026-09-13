import { describe, expect, it } from "vitest";
import { createSimulationFolder } from "./simulation-source-authoring";

describe("experiment starter instructions", () => {
  it.each(["canvas", "mixed", "text"] as const)(
    "guides %s authoring without imposing a DUT",
    (kind) => {
      const folder = createSimulationFolder({
        id: "test",
        name: "Test",
        profileId: "test",
        ...(kind !== "text" ? { documentId: "dut" } : {}),
        ...(kind === "mixed"
          ? { dut: { name: "amp", ports: ["in", "out", "vss"] } }
          : {}),
      });
      const text = folder.input.files.find(
        (file) => file.path === "run.cir",
      )!.text;
      expect(text).toContain("* 2. Click Run.");
      expect(text).toContain("* 3. Open Operating Point");
      expect(text).toContain(
        kind === "canvas"
          ? "Check Canvas sources"
          : kind === "mixed"
            ? "Complete sources, loads"
            : "Add your circuit",
      );
      if (kind === "text") expect(text).not.toContain(".include");
      if (kind === "mixed")
        expect(folder.input.files[0]!.text).toContain(
          "* DUT port order: in out vss",
        );
    },
  );
});
