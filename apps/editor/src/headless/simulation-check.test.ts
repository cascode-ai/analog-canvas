import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createEmptyProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import sg13g2Profile from "../../../../containers/ngspice/sg13g2/profile.json" with { type: "json" };
import { dividerProjectText } from "../../../../worker/gallery-simulation-checks.test-support";
import {
  LOCAL_SG13G2_MODELS_ID,
  LOCAL_SG13G2_PROFILE_ID,
  LOCAL_SIMULATION_PROFILE_ID,
  localSimulationCheck,
  sg13g2Startup,
} from "./simulation-check";

/**
 * The divider's testbench under the SG13G2 Profile, mounting its models as
 * an SG13G2 testbench does.
 */
function sg13g2DividerText(spec: string): string {
  const project = parseProject(
    dividerProjectText("Divider", spec).replaceAll(
      LOCAL_SIMULATION_PROFILE_ID,
      LOCAL_SG13G2_PROFILE_ID,
    ),
  );
  const folder = project.simulationFolders[0]!;
  folder.input.dependencies.push({
    id: sg13g2Profile.models.id,
    sha256: sg13g2Profile.models.contentSha256,
    mountPath: "sg13.lib",
  });
  folder.input.files = folder.input.files.map((file) =>
    file.path === folder.input.entry
      ? {
          ...file,
          text: file.text.replace(
            '.include "circuit.spice"',
            '.lib "sg13.lib" nominal\n.include "circuit.spice"',
          ),
        }
      : file,
  );
  return serializeProject(project);
}

/**
 * A stand-in for ngspice: it says its version, and for a deck copies its
 * startup file and the library mounted at sg13.lib to `seen`, then reports
 * vmid as ngspice's `meas` does.
 */
function fakeNgspice(directory: string, seen: string): string {
  const binary = join(directory, "ngspice");
  writeFileSync(
    binary,
    [
      "#!/usr/bin/env node",
      'const fs = require("node:fs");',
      'if (process.argv[2] === "--version") { console.log("ngspice-46 : Circuit level simulation program"); process.exit(0); }',
      `fs.writeFileSync(${JSON.stringify(seen)}, JSON.stringify({ startup: fs.readFileSync(".spiceinit", "utf8"), library: fs.readFileSync("sg13.lib", "utf8"), deck: fs.readFileSync(process.argv[3], "utf8") }));`,
      'console.log("Circuit: divider");',
      'console.log("vmid                =  5.000000e-01");',
      "",
    ].join("\n"),
  );
  chmodSync(binary, 0o755);
  return binary;
}

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

describe("an SG13G2 testbench checked on this machine", () => {
  it("starts ngspice as the hosted SG13G2 image does, from this machine's model root", () => {
    expect(sg13g2Startup("/opt/sg13g2")).toBe(
      readFileSync(
        new URL(
          "../../../../containers/ngspice/sg13g2/hosted.spiceinit",
          import.meta.url,
        ),
        "utf8",
      ),
    );
  });

  it("runs under the SG13G2 Profile with its models and OSDI from where they are kept here", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sg13g2-check-"));
    const seen = join(directory, "seen.json");
    const root = join(directory, "sg13g2");
    const models = join(root, "sg13g2.lib.spice");
    mkdirSync(root);
    writeFileSync(models, ".lib nominal\n.endl nominal\n");
    const simulator = {
      ngspice: fakeNgspice(directory, seen),
      libraries: { [LOCAL_SG13G2_MODELS_ID]: models },
    };
    const pass = await localSimulationCheck(
      sg13g2DividerText("vmid range 0.45 0.55 unit=V"),
      simulator,
      at,
    );
    expect(pass).toMatchObject({
      kind: "verdict",
      check: {
        status: "pass",
        origin: "local",
        simulator: "ngspice ngspice-46",
        folders: [
          {
            name: "Divider DC",
            status: "pass",
            profileId: LOCAL_SG13G2_PROFILE_ID,
            specs: [{ name: "vmid", value: 0.5, judgment: "pass" }],
          },
        ],
      },
    });
    const run = JSON.parse(readFileSync(seen, "utf8"));
    expect(run.startup).toBe(sg13g2Startup(root));
    expect(run.library).toBe(readFileSync(models, "utf8"));
    expect(run.deck).toMatch(/^\.lib "sg13\.lib" nominal$/mu);
    expect(
      await localSimulationCheck(
        sg13g2DividerText("vmid > 0.9 unit=V"),
        simulator,
        at,
      ),
    ).toMatchObject({
      kind: "verdict",
      check: { status: "fail", reason: "outside-spec" },
    });
  });

  it("cannot run without the SG13G2 models", async () => {
    const directory = mkdtempSync(join(tmpdir(), "sg13g2-check-"));
    expect(
      await localSimulationCheck(
        sg13g2DividerText("vmid > 0 unit=V"),
        {
          ngspice: fakeNgspice(directory, join(directory, "seen.json")),
          libraries: {},
        },
        at,
      ),
    ).toMatchObject({
      kind: "cannot-run",
      folder: "Divider DC",
      code: "simulation-dependency-unavailable",
    });
  });
});
