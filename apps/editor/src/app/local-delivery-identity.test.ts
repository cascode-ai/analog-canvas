import { describe, expect, it } from "vitest";

import {
  canonicalModelTypes,
  matchesLocalDelivery,
} from "./local-delivery-identity";

const version = "a".repeat(64);
const delivered = (
  format: "spice" | "spectre" | "rnl" | "project",
  extra: Record<string, unknown> = {},
) => ({ source: { version, format }, ...extra });
const request = (extra: Record<string, unknown> = {}) => ({
  sourceVersion: version,
  rnlAppearance: "canvas" as const,
  ...extra,
});

describe("which open copy a local delivery reuses", () => {
  it("reuses the copy of the same files delivered the same way", () => {
    expect(matchesLocalDelivery(delivered("spectre"), request())).toBe(true);
    expect(
      matchesLocalDelivery(
        delivered("spectre"),
        request({ sourceVersion: "b".repeat(64) }),
      ),
    ).toBe(false);
  });

  it("keeps a copy imported without device types apart from one imported with them (#2377)", () => {
    const types = { nch_mac: "nmos", pch_mac: "pmos" } as const;
    expect(
      matchesLocalDelivery(
        delivered("spectre"),
        request({ modelTypes: types }),
      ),
    ).toBe(false);
    expect(
      matchesLocalDelivery(
        delivered("spectre", { modelTypes: types }),
        request(),
      ),
    ).toBe(false);
    expect(
      matchesLocalDelivery(
        delivered("spectre", { modelTypes: types }),
        request({ modelTypes: { nch_mac: "nmos", pch_mac: "nmos" } }),
      ),
    ).toBe(false);
  });

  it("reads model names in any case or order, as the import does", () => {
    expect(
      matchesLocalDelivery(
        delivered("spice", {
          modelTypes: canonicalModelTypes({ nch_mac: "nmos", pch_mac: "pmos" }),
        }),
        request({ modelTypes: { PCH_MAC: "pmos", NCH_MAC: "nmos" } }),
      ),
    ).toBe(true);
    // No types and an empty set of them are the same delivery.
    expect(
      matchesLocalDelivery(delivered("spice"), request({ modelTypes: {} })),
    ).toBe(true);
    expect(canonicalModelTypes({})).toBeUndefined();
    expect(canonicalModelTypes({ B: "pmos", a: "nmos" })).toEqual({
      a: "nmos",
      b: "pmos",
    });
  });

  it("gives a native Project, which takes no device types, no such distinction", () => {
    expect(
      matchesLocalDelivery(
        delivered("project"),
        request({ modelTypes: { nch_mac: "nmos" } }),
      ),
    ).toBe(true);
  });

  it("still tells RNL appearances and Agent tasks apart", () => {
    expect(
      matchesLocalDelivery(
        delivered("rnl", { rnlAppearance: "source" }),
        request(),
      ),
    ).toBe(false);
    expect(
      matchesLocalDelivery(
        delivered("spice", { taskRef: "task-1" }),
        request({ taskRef: "task-2" }),
      ),
    ).toBe(false);
    expect(
      matchesLocalDelivery(delivered("spice"), request({ taskRef: "task-2" })),
    ).toBe(true);
  });
});
