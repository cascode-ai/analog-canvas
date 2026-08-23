import { createEmptyProject } from "@icm/model";
import { describe, expect, it } from "vitest";

import { planCheckBulkDefaults } from "./check-and-save";

function documentWith(options: {
  nets: { id: string; powerDomain?: "vdd" | "ground" }[];
  instances: { id: string; symbolId: "nmos" | "pmos"; bound?: boolean }[];
  defaults?: { nmosNetId?: string; pmosNetId?: string };
}) {
  const document = createEmptyProject("check", "Check").documents[0]!;
  document.nets = options.nets.map((net) => ({
    id: net.id,
    scope: "local" as const,
    terminals: [],
    ...(net.powerDomain ? { powerDomain: net.powerDomain } : {}),
  }));
  document.instances = options.instances.map((instance) => ({
    id: instance.id,
    symbolId: instance.symbolId,
    reference: instance.id,
    parameters: {},
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    ...(instance.bound
      ? { mosBulkBinding: { netId: "n-gnd", origin: "explicit" as const } }
      : {}),
  })) as unknown as typeof document.instances;
  if (options.defaults) document.mosBulkDefaults = options.defaults;
  return document;
}

describe("check-time MOS bulk defaults", () => {
  it("adopts the one ground and the one supply on the sheet", () => {
    const plan = planCheckBulkDefaults(
      documentWith({
        nets: [
          { id: "n-gnd", powerDomain: "ground" },
          { id: "n-vdd", powerDomain: "vdd" },
          { id: "n-sig" },
        ],
        instances: [
          { id: "M1", symbolId: "nmos" },
          { id: "M2", symbolId: "pmos" },
        ],
      }),
    );
    expect(plan.edits).toEqual([
      { kind: "set_mos_bulk_defaults", nmosNetId: "n-gnd" },
      { kind: "set_mos_bulk_defaults", pmosNetId: "n-vdd" },
      { kind: "reconcile_mos_bulk" },
    ]);
    expect(plan.ambiguous).toEqual({ nmos: false, pmos: false });
  });

  it("refuses to choose between two supplies and says so", () => {
    // AVDD versus VDD is a decision. A check is no better placed to guess at
    // it than anything else, so it reports instead of picking.
    const plan = planCheckBulkDefaults(
      documentWith({
        nets: [
          { id: "n-gnd", powerDomain: "ground" },
          { id: "n-vdd", powerDomain: "vdd" },
          { id: "n-avdd", powerDomain: "vdd" },
        ],
        instances: [
          { id: "M1", symbolId: "nmos" },
          { id: "M2", symbolId: "pmos" },
        ],
      }),
    );
    expect(plan.ambiguous).toEqual({ nmos: false, pmos: true });
    expect(plan.edits).toEqual([
      { kind: "set_mos_bulk_defaults", nmosNetId: "n-gnd" },
      { kind: "reconcile_mos_bulk" },
    ]);
  });

  it("leaves a cell default that is already chosen alone", () => {
    const plan = planCheckBulkDefaults(
      documentWith({
        nets: [
          { id: "n-gnd", powerDomain: "ground" },
          { id: "n-avdd", powerDomain: "ground" },
        ],
        instances: [{ id: "M1", symbolId: "nmos" }],
        defaults: { nmosNetId: "n-gnd" },
      }),
    );
    // Two grounds would be ambiguous, but nothing has to be chosen: the cell
    // already named one, so the check only settles the bodies.
    expect(plan.edits).toEqual([{ kind: "reconcile_mos_bulk" }]);
    expect(plan.ambiguous).toEqual({ nmos: false, pmos: false });
  });

  it("plans nothing when every body is already wired", () => {
    const plan = planCheckBulkDefaults(
      documentWith({
        nets: [{ id: "n-gnd", powerDomain: "ground" }],
        instances: [{ id: "M1", symbolId: "nmos", bound: true }],
      }),
    );
    expect(plan.edits).toEqual([]);
    expect(plan.ambiguous).toEqual({ nmos: false, pmos: false });
  });
});
