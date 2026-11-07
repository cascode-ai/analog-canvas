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
const vacaskCompose = readFileSync(
  "containers/vacask/host/compose.yaml",
  "utf8",
);
const vacaskDeploy = readFileSync(
  "containers/vacask/host/deploy-preview.sh",
  "utf8",
);

describe("the operator simulator host", () => {
  it("keeps the untrusted executor private, unprivileged, bounded and without the host token", () => {
    expect(compose).toContain("read_only: true");
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/u);
    expect(compose).toContain("internal: true");
    // Production publishes no host port. Only the China region's gateway
    // listens, on loopback, for that region's operator SSH tunnel.
    const regional = compose.slice(compose.indexOf("  regional-executor:"));
    expect(
      compose.slice(0, compose.indexOf("  regional-executor:")),
    ).not.toMatch(/^\s*ports:/mu);
    expect(regional.match(/^\s*- "[^"]*:\d+:8080"/gmu)).toEqual([
      '      - "127.0.0.1:19094:8080"',
    ]);
    expect(
      regional.slice(0, regional.indexOf("  regional-gateway:")),
    ).not.toContain("ACCESS_TOKEN");
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

  it("starts the China region's profile only with its own credential file", () => {
    expect(deploy).toMatch(/regional_enabled=false\n/u);
    expect(deploy.indexOf("regional_enabled=false")).toBeLessThan(
      deploy.indexOf('"$regional_enabled" = true'),
    );
    expect(deploy).toContain('--env-file "$regional_env" --profile regional');
  });

  it("assigns the regional services a distinct host UID and matching scratch ownership", () => {
    for (const service of [
      "executor",
      "sg13g2",
      "simulator",
      "regional-executor",
      "regional-sg13g2",
      "regional-gateway",
    ]) {
      const start = compose.indexOf(`\n  ${service}:\n`);
      expect(start).toBeGreaterThan(0);
      const body = compose.slice(start + 1).split(/\n(?=\S| {2}\w)/u, 1)[0];
      const regional = service.startsWith("regional-");
      const uid = regional ? 10002 : 10001;
      expect(body).toContain(`user: "${uid}:${uid}"`);
      if (service.endsWith("executor") || service.endsWith("sg13g2")) {
        expect(body).toContain(`SIMULATION_OMP_THREADS: "${regional ? 2 : 8}"`);
        if (regional)
          expect(body).toMatch(
            /\/var\/lib\/simulation:[^\n]+uid=10002,gid=10002/u,
          );
      }
    }
    expect(
      vacaskCompose.match(
        /user: "\$\{VACASK_RUN_UID:-10001\}:\$\{VACASK_RUN_UID:-10001\}"/gu,
      ),
    ).toHaveLength(2);
    expect(vacaskDeploy).toMatch(
      /VACASK_RUN_UID=10002 docker compose -p icm-vacask-regional/u,
    );
    expect(vacaskDeploy).toMatch(
      /VACASK_RUN_UID=10001 docker compose -p icm-vacask-preview/u,
    );
  });

  it("never prunes the host's other Docker data", () => {
    expect(deploy).not.toMatch(/docker (?:system|volume|network) prune/u);
  });

  it.skipIf(process.platform === "win32").each([
    { tunnel: false, regionalThreads: 64, regionalStarts: true },
    { tunnel: true, regionalThreads: 65, regionalStarts: false },
  ])(
    "deploys Production and gates the regional stack with $regionalThreads existing threads",
    ({ tunnel, regionalThreads, regionalStarts }) => {
      const directory = mkdtempSync(join(tmpdir(), "simulator-host-upgrade-"));
      const source = join(directory, "source");
      const scripts = join(source, "containers/ngspice/host");
      const host = join(directory, "host");
      mkdirSync(scripts, { recursive: true });
      mkdirSync(join(host, "secrets"), { recursive: true });
      for (const name of [
        "deploy.sh",
        "bootstrap.sh",
        "health.sh",
        "check-regional-budget.sh",
      ]) {
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
      writeFileSync(
        join(host, "secrets/regional.env"),
        "REGIONAL_SIMULATION_ACCESS_TOKEN=fixture",
      );
      const retired = join(directory, "sg13g2-extended");
      const foreign = join(directory, "another-project");
      writeFileSync(retired, "retired executor");
      writeFileSync(foreign, "unrelated executor");
      const regional = join(directory, "regional-started");
      const ps = join(directory, "ps");
      writeFileSync(ps, '#!/bin/sh\nprintf "%s\\n" "$THREADS"\n');
      chmodSync(ps, 0o755);
      const curl = join(directory, "curl");
      writeFileSync(
        curl,
        '#!/bin/sh\nprintf "%s\\n" "$*" >> "$REGIONAL_PROBES"\n',
      );
      chmodSync(curl, 0o755);
      const probes = join(directory, "regional-probes");
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
    fi
    case " $* " in
      *" up -d regional-gateway "*|*" up -d --remove-orphans ") touch "$REGIONAL_STARTED" ;;
    esac ;;
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
            REGIONAL_STARTED: regional,
            REGIONAL_PROBES: probes,
            THREADS: [
              ...Array(100).fill(10001),
              ...Array(regionalThreads).fill(10002),
            ].join("\n"),
          },
        });
        expect(result.status, result.stderr).toBe(regionalStarts ? 0 : 1);
        if (!regionalStarts)
          expect(result.stderr).toContain("UID 10002 has 65 threads");
        expect(existsSync(regional)).toBe(regionalStarts);
        if (regionalStarts)
          expect(readFileSync(probes, "utf8")).toContain(
            "127.0.0.1:19094/sg13g2/health",
          );
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
