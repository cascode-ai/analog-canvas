import { importSpiceSources } from "@icm/spice";
import { describe, expect, it } from "vitest";

import { createDesignNetlistExport } from "./export.js";

async function imported(text: string, path = "amp.sp") {
  const result = await importSpiceSources(
    [{ path, bytes: new TextEncoder().encode(text) }],
    path,
  );
  expect(result.successful, JSON.stringify(result.diagnostics)).toBe(true);
  return result.project!;
}

const printed = (
  project: Awaited<ReturnType<typeof imported>>,
  format: "spice" | "spectre",
) => {
  const result = createDesignNetlistExport(project, { format });
  if (result.status !== "ready")
    throw new Error(JSON.stringify(result.diagnostics));
  return result.file.text;
};

describe("the model cards of the imported files", () => {
  it("prints the cards the circuit calls, as the file wrote them", async () => {
    const project = await imported(
      [
        "* amp",
        ".model nch nmos level=1 vto=0.5",
        "+ kp=200u",
        ".model unused pmos level=1",
        ".lib corner",
        ".model nch nmos level=1 vto=0.9",
        ".endl",
        "M1 d g 0 0 nch w=1u l=1u",
        "R1 vdd d 1k",
        ".end",
        "",
      ].join("\n"),
    );
    const spice = printed(project, "spice");
    expect(spice).toContain(".model nch nmos level=1 vto=0.5\n+ kp=200u");
    // Only what the circuit calls, from the file's own level.
    expect(spice).not.toContain("unused");
    expect(spice).not.toContain("vto=0.9");
    // Spectre reads the card in its own words.
    // Spectre reads the card as SPICE, in a section of its own.
    expect(printed(project, "spectre")).toContain(
      "\nsimulator lang=spice\n.model nch nmos level=1 vto=0.5 kp=200u\nsimulator lang=spectre\n",
    );
  });

  it("prints each card once when its own netlist is read again", async () => {
    const text =
      "* amp\n.model nch nmos level=1\nM1 d g 0 0 nch w=1u l=1u\nR1 vdd d 1k\n.end\n";
    const again = await imported(printed(await imported(text), "spice"));
    expect(printed(again, "spice").match(/^\.model nch /gmu)).toHaveLength(1);
  });
});
