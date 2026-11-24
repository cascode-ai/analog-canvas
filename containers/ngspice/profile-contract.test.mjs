import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const directory = dirname(fileURLToPath(import.meta.url));
const profile = JSON.parse(
  await readFile(join(directory, "hosted-sky130-profile.json"), "utf8"),
);
const startup = await readFile(join(directory, "hosted.spiceinit"));
const dockerfile = await readFile(join(directory, "Dockerfile"), "utf8");

describe("the hosted SKY130 Profile", () => {
  it("pins the exact base image, startup policy and runtime paths", () => {
    expect(profile.id).toBe("sky130-core-continuous-ngspice46-v1");
    expect(profile.displayName).toBe("SKY130 qualified devices · ngspice 46");
    expect(dockerfile).toContain(`ARG BASE_IMAGE=${profile.sourceImage}`);
    expect(createHash("sha256").update(startup).digest("hex")).toBe(
      profile.startup.contentSha256,
    );
    expect(dockerfile).toContain(
      "SIMULATION_PROFILE_PATH=/opt/harness/hosted-sky130-profile.json",
    );
    expect(dockerfile).toContain(
      "SIMULATION_STARTUP_PATH=/opt/harness/hosted.spiceinit",
    );
    expect(profile.models.library).toEqual({
      directive: "lib",
      runtimePath: "/opt/sky130/continuous/sky130.lib.spice",
      sections: ["tt", "ff", "ss", "fs", "sf"],
    });
  });

  it("pins the vendored standard-cell library, outside the model tree (#1596)", async () => {
    expect(profile.cellLibraries).toEqual([
      {
        id: "sky130_fd_sc_hd",
        cells: "sky130_fd_sc_hd",
        contentSha256:
          "6dec6626decd1ee15afacafab9925b1a336ab344b7b5e1bec9d7483f2a6badc3",
        library: {
          directive: "include",
          runtimePath: "/opt/sky130-cells/sky130_fd_sc_hd.spice",
        },
      },
    ]);
    const [cells] = profile.cellLibraries;
    // The vendored bytes, the bytes the build checks and the bytes the
    // harness expects are one digest.
    expect(
      createHash("sha256")
        .update(await readFile(join(directory, "cells/sky130_fd_sc_hd.spice")))
        .digest("hex"),
    ).toBe(cells.contentSha256);
    expect(dockerfile).toContain(
      `ARG SKY130_HD_SPICE_SHA256=${cells.contentSha256}`,
    );
    expect(dockerfile).toContain(
      `COPY \${HARNESS_DIR}/cells/sky130_fd_sc_hd.spice ${cells.library.runtimePath}`,
    );
    // The model tree's digest covers SKY130_MODEL_ROOT; the cells are not in it.
    expect(dockerfile).toContain("SKY130_MODEL_ROOT=/opt/sky130 ");
    expect(cells.library.runtimePath.startsWith("/opt/sky130/")).toBe(false);
  });

  it("qualifies only the scope backed by tracked hosted acceptance", () => {
    expect(profile.qualifiedScope).toEqual({
      devices: [
        "sky130_fd_pr__nfet_01v8",
        "sky130_fd_pr__pfet_01v8",
        "sky130_fd_pr__nfet_01v8_lvt",
        "sky130_fd_pr__pfet_01v8_lvt",
        "sky130_fd_pr__pfet_01v8_hvt",
        "sky130_fd_pr__nfet_g5v0d10v5",
        "sky130_fd_pr__pfet_g5v0d10v5",
        "sky130_fd_pr__res_high_po",
        "sky130_fd_pr__cap_mim_m3_1",
        "sky130_fd_pr__pnp_05v5_W0p68L0p68",
      ],
      sections: ["tt", "ff", "ss", "fs", "sf"],
      analyses: ["op", "dc", "ac", "tran", "noise"],
    });
  });
});
