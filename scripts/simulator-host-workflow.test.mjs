import { spawnSync } from "node:child_process";
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
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

  it.skipIf(process.platform === "win32").each([false, true])(
    "removes the retired executor when deploying with tunnel=%s",
    (tunnel) => {
      const directory = mkdtempSync(join(tmpdir(), "simulator-host-upgrade-"));
      const source = join(directory, "source");
      const scripts = join(source, "containers/ngspice/host");
      const host = join(directory, "host");
      mkdirSync(scripts, { recursive: true });
      mkdirSync(join(host, "secrets"), { recursive: true });
      for (const name of ["deploy.sh", "bootstrap.sh", "health.sh"]) {
        copyFileSync(
          resolve("containers/ngspice/host", name),
          join(scripts, name),
        );
        chmodSync(join(scripts, name), 0o755);
      }
      writeFileSync(join(source, "SOURCE_COMMIT"), "a".repeat(40));
      writeFileSync(
        join(host, "secrets/runtime.env"),
        "SIMULATION_ACCESS_TOKEN=fixture",
      );
      if (tunnel)
        writeFileSync(join(host, "secrets/tunnel.env"), "TUNNEL_TOKEN=fixture");
      const retired = join(directory, "sg13g2-extended");
      const foreign = join(directory, "another-project");
      writeFileSync(retired, "retired executor");
      writeFileSync(foreign, "unrelated executor");
      const docker = join(directory, "docker");
      writeFileSync(
        docker,
        `#!/bin/sh
case "$1" in
  compose)
    if [ "$2" = version ]; then echo 2.33.1; exit 0; fi
    start=false
    clean=false
    for arg in "$@"; do
      [ "$arg" != up ] || start=true
      [ "$arg" != --remove-orphans ] || clean=true
    done
    if [ "$start" = true ] && [ "$clean" = true ]; then
      rm -f -- "$RETIRED_EXECUTOR"
    fi ;;
  inspect) echo analog-canvas-sim ;;
  exec) echo '{"status":"ready"}' ;;
  info) ;;
  *) exit 2 ;;
esac
`,
      );
      chmodSync(docker, 0o755);
      try {
        const result = spawnSync("sh", [join(scripts, "deploy.sh")], {
          encoding: "utf8",
          env: {
            ...process.env,
            PATH: `${directory}${delimiter}${process.env.PATH}`,
            SIMULATOR_HOST_HOME: host,
            RETIRED_EXECUTOR: retired,
          },
        });
        expect(result.status, result.stderr).toBe(0);
        expect(existsSync(retired)).toBe(false);
        expect(existsSync(foreign)).toBe(true);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );

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
    if [ "$SHARED_VOLUME" = 1 ]; then echo /volumes/shared;
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
        {
          const shared = verify(1);
          expect(shared.status).toBe(1);
          expect(shared.stderr).toContain("Profiles share a run-root volume");
        }
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  );
});
