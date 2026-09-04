import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const workflow = readFileSync(".github/workflows/simulator-host.yml", "utf8");
const compose = readFileSync("containers/ngspice/host/compose.yaml", "utf8");
const bootstrap = readFileSync("containers/ngspice/host/bootstrap.sh", "utf8");
const deploy = readFileSync("containers/ngspice/host/deploy.sh", "utf8");
const health = readFileSync("containers/ngspice/host/health.sh", "utf8");
const numericalSmoke = readFileSync(
  "containers/ngspice/host/numerical-smoke.mjs",
  "utf8",
);
const runtimeVerification = readFileSync(
  "containers/ngspice/verify-host-runtime.sh",
  "utf8",
);

describe("the operator simulator host", () => {
  it("installs and invokes only repository-owned lifecycle scripts", () => {
    expect(workflow).toContain("tar -cf - containers/ngspice");
    expect(workflow).toContain("containers/ngspice/host/bootstrap.sh");
    expect(workflow).toContain("containers/ngspice/host/deploy.sh");
    expect(workflow).toContain("containers/ngspice/host/health.sh");
    expect(workflow).toContain("containers/ngspice/verify-host-runtime.sh");
    expect(workflow).not.toMatch(
      /analog-canvas-sim\/(?:bin\/)?(?:up|rebuild|health)\.sh/u,
    );
  });

  it("can provision the pinned Compose v2 dependency", () => {
    expect(bootstrap).toContain("docker compose version");
    expect(bootstrap).toContain('compose_version="2.33.1"');
    expect(bootstrap).toContain(
      "docker/compose/releases/download/v$compose_version",
    );
    expect(bootstrap).toContain("sha256sum --check --status");
    expect(bootstrap).toContain("$HOME/.docker/cli-plugins");
    expect(bootstrap).not.toContain("sudo");
  });

  it("keeps the harness private and resource bounded in one desired-state file", () => {
    expect(compose).toContain("container_name: analog-canvas-ngspice");
    expect(compose).toContain("read_only: true");
    expect(compose).toContain(
      "/tmp:rw,noexec,nosuid,nodev,size=64m,uid=10001,gid=10001,mode=0700",
    );
    expect(compose).toMatch(/cap_drop:\s*\n\s*- ALL/u);
    expect(compose).toContain("pids_limit: 256");
    expect(compose).toContain("cpus: 8.0");
    expect(compose).toContain("mem_limit: 16g");
    expect(compose).toContain("internal: true");
    expect(compose).not.toMatch(/^\s*ports:/mu);
    expect(compose).toContain(
      "cloudflare/cloudflared:2025.8.1@sha256:b77d84e8704db38db22c22661cf7e56468c526e3a6a5fe9c8b7c151452fa1472",
    );
  });

  it("proves a real numerical run can use private temporary storage", () => {
    expect(health).toContain("numerical-smoke.mjs");
    expect(numericalSmoke).toContain('fetchImpl("http://127.0.0.1:8080/run"');
    expect(numericalSmoke).toContain("write out.raw v(mid)");
    expect(numericalSmoke).toContain("Math.abs(midpoint - 0.5) > 1e-12");
    expect(runtimeVerification).toContain("the private /tmp tmpfs is absent");
  });

  it("uses the tracked topology instead of repeating docker run flags", () => {
    expect(deploy).toContain('compose_file="$script_dir/compose.yaml"');
    expect(deploy).toContain("docker compose");
    expect(deploy).not.toContain("docker run");
    expect(deploy).not.toContain("--cpus");
    expect(deploy).not.toContain("--memory");
    expect(deploy).not.toContain("--cap-drop");
  });

  it("bounds the one-time legacy takeover to the two known containers", () => {
    expect(deploy).toContain("replace_legacy_container analog-canvas-ngspice");
    expect(deploy).toContain("replace_legacy_container analog-canvas-tunnel");
    expect(deploy).not.toMatch(/docker (?:system|volume|network) prune/u);
  });
});
