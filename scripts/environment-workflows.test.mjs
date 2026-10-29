import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { parsers } from "prettier/plugins/yaml";
import { describe, expect, it } from "vitest";
import { matchesAny } from "./lib/validation-gates.mjs";

// Read the checked-in workflow through the formatter's YAML parser. These
// tests exercise event/path/job routing; they never run a workflow step.
async function workflow(path) {
  const ast = await parsers.yaml.parse(await readFile(path, "utf8"));
  function value(node) {
    if (!node) return null;
    if (["mapping", "flowMapping"].includes(node.type))
      return Object.fromEntries(
        node.children.map((item) => item.children.map(value)),
      );
    if (["sequence", "flowSequence"].includes(node.type))
      return node.children.map(value);
    if (Object.hasOwn(node, "value")) return node.value;
    return value(node.children?.[0]);
  }
  return value(
    ast.children[0].children.find((node) => node.type === "documentBody"),
  );
}

function permits(job, event, action) {
  if (!job.if) return true;
  return Boolean(
    runInNewContext(
      job.if,
      {
        github: { event_name: event },
        inputs: { action },
        contains: (list, item) => list.includes(item),
        fromJSON: JSON.parse,
      },
      { timeout: 100 },
    ),
  );
}

describe("environment workflow execution boundaries", () => {
  it("qualifies native assertions, pinned source conversion and real MCP only on explicit compat dispatch", async () => {
    const config = await workflow(".github/workflows/simulator-host.yml");
    const job = config.jobs["vacask-compat-build"];
    expect(permits(job, "workflow_dispatch", "vacask-compat-build")).toBe(true);
    for (const event of ["push", "pull_request", "merge_group"])
      expect(permits(job, event, "vacask-compat-build"), event).toBe(false);
    expect(permits(job, "workflow_dispatch", "deploy")).toBe(false);
    expect(job.environment).toBeUndefined();
    const commands = job.steps.map((step) => step.run ?? "").join("\n");
    for (const lane of ["vacask", "vacask-source", "mcp-native"])
      expect(commands).toContain(
        `node scripts/run-environment-tests.mjs ${lane}`,
      );
    expect(job.env.ICM_E2E_VACASK_REAL).toBe("1");
    expect(job.env.VACASK_MODULES).toContain("compat-build/context/modules");
    expect(job.env.ICM_VACASK_BSIM4_SOURCE).toContain(
      "vacask/src/vacask/devices/spice/bsim4v8.va",
    );
    expect(
      job.steps.some(
        (step) =>
          step.if === "always()" &&
          step.with?.path?.includes("output/environment-tests"),
      ),
    ).toBe(true);
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

  it("runs ngspice model checks on affected PRs without a deployment environment", async () => {
    const config = await workflow(".github/workflows/ngspice-tests.yml");
    for (const path of [
      "packages/netlist/src/generated-models.ts",
      "packages/devices/src/reviewed-external.ts",
      "packages/edit-engine/src/bus-netlist.test.ts",
      "packages/components/definitions/inverter.json",
      "scripts/lib/environment-test-lanes.mjs",
    ])
      expect(matchesAny(path, config.on.pull_request.paths), path).toBe(true);
    expect(
      matchesAny("docs/user/getting-started.md", config.on.pull_request.paths),
    ).toBe(false);
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
