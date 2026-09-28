import { expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

const input = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

it("imports a reviewed master drawn outside the approved catalog as an ordinary block", async () => {
  // SKY130's drain-extended devices are reviewed for the DMOS symbols, which
  // SPICE import cannot draw; they keep positional pins and raw values.
  const text = [
    "* high-voltage devices",
    ".subckt top d g s b d2 g2 s2 b2",
    "XM1 d g s b sky130_fd_pr__nfet_g5v0d16v0 w=5 l=0.7 nf=1 m=1",
    "XM2 d2 g2 s2 b2 sky130_fd_pr__pfet_20v0 m=2",
    ".ends top",
    ".end",
    "",
  ].join("\n");
  const result = await importSpiceSources([input("hv.spi", text)], "hv.spi");
  expect(result.diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const project = result.project!;
  const top = project.documents.find((document) => document.name === "top")!;
  expect(
    top.instances.find((instance) => instance.id === "XM1")?.netlist
      ?.parameters,
  ).toEqual({ w: "5", l: "0.7", nf: "1", m: "1" });
  for (const name of [
    "sky130_fd_pr__nfet_g5v0d16v0",
    "sky130_fd_pr__pfet_20v0",
  ]) {
    const definition = project.externalSubcircuitDefinitions.find(
      (item) => item.name === name,
    )!;
    expect(definition.interfaceStatus).toBe("inferred-positional");
    expect(definition.formalParameters).toEqual([]);
    expect(definition.terminals.map((terminal) => terminal.name)).not.toEqual([
      "D",
      "G",
      "S",
      "B",
    ]);
  }
});
