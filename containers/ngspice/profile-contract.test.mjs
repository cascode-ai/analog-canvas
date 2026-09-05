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
      sections: ["tt"],
    });
  });

  it("qualifies only the scope backed by the tracked hosted fixture", () => {
    expect(profile.qualifiedScope).toEqual({
      devices: ["sky130_fd_pr__nfet_01v8", "sky130_fd_pr__pfet_01v8"],
      sections: ["tt"],
      analyses: ["op", "ac", "tran"],
    });
  });
});
