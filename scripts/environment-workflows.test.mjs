import { describe, expect, it } from "vitest";
import { matchesAny } from "./lib/validation-gates.mjs";

import { permitsCondition, workflow } from "./test-support/workflow.mjs";

function permits(job, event, action) {
  return permitsCondition(job.if, {
    github: { event_name: event },
    inputs: { action },
    contains: (list, item) => list.includes(item),
    fromJSON: JSON.parse,
  });
}

describe("environment workflow execution boundaries", () => {
  it("does not expose retired hosted VACASK preview or compat jobs in the simulator host workflow", async () => {
    const config = await workflow(".github/workflows/simulator-host.yml");
    expect(Object.keys(config.jobs).sort()).toEqual(["host", "ssh-key"]);
    expect(config.on.workflow_dispatch.inputs.action.options).toEqual([
      "probe",
      "bootstrap-tunnel",
      "deploy",
      "authorize-ssh-key",
      "retire-ssh-key",
    ]);
  });

  it("measures browser latency only by explicit dispatch against a production build", async () => {
    const config = await workflow(".github/workflows/performance.yml");
    expect(Object.keys(config.on)).toEqual(["workflow_dispatch"]);
    const job = config.jobs.measure;
    expect(job.env.ICM_PERF).toBe("1");
    expect(job.environment).toBeUndefined();
    const commands = job.steps.map((step) => step.run ?? "");
    const build = commands.indexOf("pnpm build");
    const run = commands.indexOf(
      "node scripts/run-environment-tests.mjs browser-performance",
    );
    expect(build).toBeGreaterThanOrEqual(0);
    expect(run).toBeGreaterThan(build);
    expect(
      job.steps.some((step) => step.with?.path?.includes("output/performance")),
    ).toBe(true);
  });

  it("routes Windows-only assertions to a Windows runner without packaging a release", async () => {
    const config = await workflow(".github/workflows/platform-tests.yml");
    for (const path of [
      "apps/desktop/src/windows-association.ts",
      "scripts/gallery-private-snapshot.mjs",
      "scripts/run-environment-tests.mjs",
    ])
      expect(matchesAny(path, config.on.pull_request.paths), path).toBe(true);
    expect(
      matchesAny(
        "packages/netlist/src/extract.ts",
        config.on.pull_request.paths,
      ),
    ).toBe(false);
    expect(config.jobs.windows["runs-on"]).toBe("windows-latest");
    expect(config.jobs.windows.environment).toBeUndefined();
    const commands = config.jobs.windows.steps
      .map((step) => step.run ?? "")
      .join("\n");
    expect(commands).toContain(
      "node scripts/run-environment-tests.mjs windows",
    );
    expect(commands).not.toContain("package:preview");
    expect(config.permissions.contents).toBe("read");
  });

  it("runs simulations in CI only by hand, never on PRs or the merge queue", async () => {
    for (const file of ["ngspice-tests", "sg13g2-tests", "container"]) {
      const config = await workflow(`.github/workflows/${file}.yml`);
      expect(Object.keys(config.on), file).toEqual(["workflow_dispatch"]);
    }
    const config = await workflow(".github/workflows/ngspice-tests.yml");
    const job = config.jobs.qualify;
    expect(job.environment).toBeUndefined();
    expect(job.env.NGSPICE_BIN).toBe("/usr/bin/ngspice");
    expect(job.steps.map((step) => step.run ?? "").join("\n")).toContain(
      "node scripts/run-environment-tests.mjs ngspice",
    );
    expect(config.permissions.contents).toBe("read");
  });

  it("deploys only runtime main pushes or explicit host actions", async () => {
    const config = await workflow(".github/workflows/simulator-host.yml");
    const push = (branch, path) =>
      config.on.push.branches.includes(branch) &&
      matchesAny(path, config.on.push.paths) &&
      permits(config.jobs.host, "push");
    expect(push("main", ".github/workflows/simulator-host.yml")).toBe(false);
    for (const path of [
      "containers/ngspice/entrypoint.mjs",
      "containers/simulation/run-local-files.mjs",
      "packages/spice-run/src/rawfile.ts",
      "packages/simulation-service/src/execution-receipt.ts",
      "scripts/package-ngspice-harness.mjs",
    ]) {
      expect(push("main", path), path).toBe(true);
      expect(push("codex/example", path), path).toBe(false);
    }
    for (const action of ["probe", "bootstrap-tunnel", "deploy"])
      expect(
        permits(config.jobs.host, "workflow_dispatch", action),
        action,
      ).toBe(true);
    for (const action of [
      "vacask-compat-build",
      "vacask-preview",
      "vacask-diagnostics",
      "authorize-ssh-key",
      "retire-ssh-key",
    ])
      expect(
        permits(config.jobs.host, "workflow_dispatch", action),
        action,
      ).toBe(false);
    for (const event of ["pull_request", "merge_group"]) {
      expect(config.on).not.toHaveProperty(event);
      expect(permits(config.jobs.host, event)).toBe(false);
    }
  });
});
