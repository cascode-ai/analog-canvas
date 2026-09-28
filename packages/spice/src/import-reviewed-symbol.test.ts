import { expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

const input = (path: string, text: string) => ({
  path,
  bytes: new TextEncoder().encode(text),
});

it("imports SKY130's drain-extended devices as the Extended Devices DMOS", async () => {
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
  const nmos = top.instances.find((instance) => instance.id === "XM1")!;
  const pmos = top.instances.find((instance) => instance.id === "XM2")!;
  expect(nmos.symbolId).toBe("ndmos");
  expect(pmos.symbolId).toBe("pdmos");
  // Reviewed geometry arrives in canonical metres; 20 V takes only its count.
  expect(nmos.netlist?.parameters).toEqual({
    w: "5u",
    l: "700n",
    nf: "1",
    m: "1",
  });
  expect(pmos.netlist?.parameters).toEqual({ m: "2" });
  // The drawn D G S B pins carry the source's nets, in the wrapper's order.
  const netOf = (instanceId: string, pinName: string) =>
    top.nets.find((net) =>
      net.terminals.some(
        (terminal) =>
          terminal.instanceId === instanceId && terminal.pinName === pinName,
      ),
    );
  for (const pinName of ["D", "G", "S", "B"])
    expect(netOf("XM1", pinName), pinName).toBeDefined();
  const definition = project.externalSubcircuitDefinitions.find(
    (item) => item.name === "sky130_fd_pr__nfet_g5v0d16v0",
  )!;
  expect(definition.interfaceStatus).toBe("declared");
  expect(definition.terminals.map((terminal) => terminal.name)).toEqual([
    "D",
    "G",
    "S",
    "B",
  ]);
});
