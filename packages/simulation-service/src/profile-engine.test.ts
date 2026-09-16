import { expect, it } from "vitest";
import { createSimulationFolder } from "@icm/model";
import { resolveSimulationEngine } from "./profile-engine.js";

it("uses the selected Profile rather than profile order, filename or default collection", () => {
  const profiles = [
    { id: "ng", corners: [], engine: "ngspice" as const },
    { id: "va", corners: [], engine: "vacask" as const },
  ];
  for (const profile of profiles) {
    const folder = createSimulationFolder({
      id: "f",
      name: "f",
      profileId: profile.id,
      engine: profile.engine,
    });
    for (const ordered of [profiles, [...profiles].reverse()])
      expect(
        resolveSimulationEngine(folder, {
          profiles: ordered,
          rawfileCollection: "declared-single-ascii",
        }),
      ).toMatchObject({ ok: true, engine: profile.engine });
  }
});

it("refuses an unknown or undeclared engine without borrowing another Profile", () => {
  const folder = createSimulationFolder({
    id: "f",
    name: "f",
    profileId: "missing",
  });
  expect(resolveSimulationEngine(folder, { profiles: [] })).toMatchObject({
    ok: false,
    error: { code: "SIMULATION_PROFILE_UNKNOWN" },
  });
  expect(
    resolveSimulationEngine(folder, {
      profiles: [{ id: "missing", corners: [] }],
    }),
  ).toMatchObject({
    ok: false,
    error: { code: "SIMULATION_ENGINE_UNAVAILABLE" },
  });
});
