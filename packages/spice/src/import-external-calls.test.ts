import { describe, expect, it } from "vitest";

import { importSpiceSources } from "./importer.js";

async function parameters(text: string, reference: string) {
  const result = await importSpiceSources(
    [{ path: "top.sp", bytes: new TextEncoder().encode(text) }],
    "top.sp",
    {},
    { modelTypes: new Map([["nch_mac", "nmos"]]) },
  );
  return result.project?.documents
    .flatMap((document) => document.instances)
    .find((instance) => instance.reference === reference)?.netlist?.parameters;
}

describe("parameter names", () => {
  it("keeps each name of a call of a master outside the sources as written (#2294)", async () => {
    expect(
      await parameters(
        "* call\n.subckt top a b\nX1 a b ext_cell NF=2 W=1u multi={(2)}\n.ends top\n",
        "X1",
      ),
    ).toEqual({ NF: "2", W: "1u", multi: "{(2)}" });
  });

  it("reads a typed PDK part's own device names as the device's, and keeps the rest as written", async () => {
    expect(
      await parameters(
        "* device\n.subckt top d g s b\nM1 d g s b nch_mac W=1u L=30n AS=1p NRD=0.1\n.ends top\n",
        "M1",
      ),
    ).toEqual({ w: "1u", l: "30n", AS: "1p", NRD: "0.1" });
  });

  it("reads the names of a part whose model the sources declare as SPICE does", async () => {
    expect(
      await parameters(
        "* declared\n.model nfet nmos level=1\n.subckt top d g s b\nM1 d g s b nfet W=1u AS=1p\n.ends top\n",
        "M1",
      ),
    ).toEqual({ w: "1u", as: "1p" });
  });
});
