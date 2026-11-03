import { spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const compose = readFileSync("containers/ngspice/host/compose.yaml", "utf8");
const deploy = readFileSync("containers/ngspice/host/deploy.sh", "utf8");

describe("the operator simulator host", () => {
  it("keeps the untrusted executor private, unprivileged, bounded and without the host token", () => {
    expect(compose).toContain("read_only: true");
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/u);
    expect(compose).toContain("internal: true");
    expect(compose).not.toMatch(/^\s*ports:/mu);
    const executor = compose.slice(
      compose.indexOf("  executor:"),
      compose.indexOf("  simulator:"),
    );
    const gateway = compose.slice(
      compose.indexOf("  simulator:"),
      compose.indexOf("  tunnel:"),
    );
    expect(executor).toContain("pids_limit: 256");
    expect(executor).toContain("cpus: 8.0");
    expect(executor).toContain("mem_limit: 16g");
    expect(executor).not.toContain("SIMULATION_ACCESS_TOKEN");
    expect(gateway).toContain("SIMULATION_ACCESS_TOKEN");
  });

  it("never prunes the host's other Docker data", () => {
    expect(deploy).not.toMatch(/docker (?:system|volume|network) prune/u);
  });

  it.skipIf(process.platform === "win32")(
    "accepts separate executor scratch volumes and rejects a shared volume",
    () => {
      const directory = mkdtempSync(join(tmpdir(), "simulator-host-inspect-"));
      // Docker is the external boundary; execute the actual verifier with
      // inspect responses from an otherwise valid host configuration.
      const docker = join(directory, "docker");
      writeFileSync(
        docker,
        `#!/bin/sh
case "$3" in
  *RestartPolicy*) echo unless-stopped ;;
  *ReadonlyRootfs*|*.RW*) echo true ;;
  *CapDrop*) echo '["ALL"]' ;;
  *PidsLimit*) echo 256 ;;
  *PortBindings*) echo '{}' ;;
  *NanoCpus*) echo 8000000000 ;;
  *Memory*) echo 17179869184 ;;
  *.Type*) echo tmpfs ;;
  *.Source*)
    if [ "$SHARED_VOLUME" = 1 ] || { [ "$SHARED_VOLUME" = 2 ] && [ "$4" != analog-canvas-ngspice-executor ]; }; then echo /volumes/shared;
    else echo "/volumes/$4"; fi ;;
  *.Config.Env*)
    if [ "$4" = analog-canvas-ngspice ]; then echo '["SIMULATION_ACCESS_TOKEN=fixture"]';
    else echo '[]'; fi ;;
  *) exit 2 ;;
esac
`,
      );
      chmodSync(docker, 0o755);
      try {
        const verify = (shared) =>
          spawnSync(
            "sh",
            [resolve("containers/ngspice/verify-host-runtime.sh")],
            {
              encoding: "utf8",
              env: {
                ...process.env,
                PATH: `${directory}${delimiter}${process.env.PATH}`,
                SHARED_VOLUME: String(shared),
              },
            },
          );
        const isolated = verify(0);
        expect(isolated.status, isolated.stderr).toBe(0);
        expect(isolated.stdout).toContain("simulator host runtime verified");
        for (const overlap of [1, 2]) {
          const shared = verify(overlap);
          expect(shared.status).toBe(1);
          expect(shared.stderr).toContain("Profiles share a run-root volume");
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
