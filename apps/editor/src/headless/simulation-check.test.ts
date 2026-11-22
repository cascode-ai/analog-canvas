import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";
import { dividerProjectText } from "../../../../worker/gallery-simulation-checks.test-support";
import {
  LOCAL_SIMULATION_PROFILE_ID,
  localSimulationCheck,
} from "./simulation-check";

function ngspiceOnPath(): boolean {
  return spawnSync("ngspice", ["--version"], { encoding: "utf8" }).status === 0;
}

const local = { ngspice: "ngspice", libraries: {} };
const at = () => new Date("2026-11-22T10:00:00.000Z");

describe("a Gallery testbench checked on this machine", () => {
  it("has nothing to run without a testbench", async () => {
    const empty = serializeProject(createEmptyProject("p", "Empty", "top"));
    expect(await localSimulationCheck(empty, local, at)).toEqual({
      kind: "verdict",
      check: {
        status: "no-testbench",
        checkedAt: "2026-11-22T10:00:00.000Z",
        rule: 1,
        simulator: null,
        reason: "no-testbench",
        origin: "local",
        folders: [],
      },
    });
  });

  it("cannot run a folder of another Profile, or without ngspice", async () => {
    const divider = dividerProjectText("Divider", "vmid > 0 unit=V");
    expect(
      await localSimulationCheck(
        divider.replaceAll(LOCAL_SIMULATION_PROFILE_ID, "sg13g2-other"),
        local,
      ),
    ).toMatchObject({
      kind: "cannot-run",
      folder: "Divider DC",
      code: "profile-not-local",
    });
    expect(
      await localSimulationCheck(divider, {
        ngspice: "/nonexistent/ngspice",
        libraries: {},
      }),
    ).toMatchObject({ kind: "cannot-run", code: "ngspice-unavailable" });
  });

  // Skips cleanly where ngspice is absent.
  it.skipIf(!ngspiceOnPath())(
    "runs each folder with ngspice and judges it as the hosted check does",
    async () => {
      const pass = await localSimulationCheck(
        dividerProjectText("Divider", "vmid range 0.45 0.55 unit=V"),
        local,
        at,
      );
      expect(pass).toMatchObject({
        kind: "verdict",
        check: {
          status: "pass",
          rule: 1,
          origin: "local",
          simulator: expect.stringMatching(/^ngspice ngspice-/u),
          folders: [
            {
              name: "Divider DC",
              status: "pass",
              profileId: LOCAL_SIMULATION_PROFILE_ID,
              specs: [
                {
                  name: "vmid",
                  expected: "[0.45, 0.55]",
                  value: 0.5,
                  unit: "V",
                  judgment: "pass",
                },
              ],
            },
          ],
        },
      });
      const fail = await localSimulationCheck(
        dividerProjectText("Divider, tight", "vmid > 0.9 unit=V"),
        local,
        at,
      );
      expect(fail).toMatchObject({
        kind: "verdict",
        check: {
          status: "fail",
          reason: "outside-spec",
          folders: [
            {
              status: "fail",
              code: "outside-spec",
              specs: [{ name: "vmid", judgment: "failed", value: 0.5 }],
            },
          ],
        },
      });
    },
  );
});
