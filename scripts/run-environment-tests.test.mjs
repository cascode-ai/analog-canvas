import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

function verify(lane, report) {
  const directory = mkdtempSync(join(tmpdir(), "icm-environment-report-"));
  const path = join(directory, "report.json");
  try {
    writeFileSync(path, JSON.stringify(report));
    return spawnSync(
      process.execPath,
      ["scripts/run-environment-tests.mjs", lane, "--verify", path],
      { encoding: "utf8", windowsHide: true },
    );
  } finally {
    rmSync(path, { force: true });
    rmdirSync(directory);
  }
}

describe("environment test execution evidence", () => {
  it("requires pinned model sources before source conversion can count as executed", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-environment-tests.mjs", "vacask-source"],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          ICM_PYTHON: "python3",
          ICM_VACASK_BSIM4_SOURCE: process.execPath,
          ICM_VACASK_CONVERTER_SOURCE: process.cwd(),
          ICM_SKY130_MODEL_SOURCE: "",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("ICM_SKY130_MODEL_SOURCE is required");
    expect(result.stdout).not.toContain("RUN ");
  });

  it("accepts a passed browser report and rejects the same journey when skipped", () => {
    const test = {
      expectedStatus: "passed",
      status: "expected",
      results: [{ status: "passed" }],
    };
    const report = {
      config: { rootDir: resolve("apps/editor/e2e") },
      errors: [],
      suites: [
        {
          specs: [
            {
              file: "mcp-native-simulation.spec.ts",
              title:
                "public MCP connects to the real local relay and executes native source",
              tests: [test],
            },
          ],
        },
      ],
    };
    expect(verify("mcp-native", report).status).toBe(0);
    test.expectedStatus = "skipped";
    test.results = [{ status: "skipped" }];
    const skipped = verify("mcp-native", report);
    expect(skipped.status).toBe(1);
    expect(skipped.stderr).toContain("Target did not pass");
  });

  it("requires the native module tree even when VACASK_BIN exists", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-environment-tests.mjs", "vacask"],
      {
        encoding: "utf8",
        windowsHide: true,
        env: {
          ...process.env,
          VACASK_BIN: process.execPath,
          VACASK_MODULES: "",
        },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("VACASK_MODULES is required");
  });

  it("refuses missing ngspice resources before launching a test process", () => {
    const result = spawnSync(
      process.execPath,
      ["scripts/run-environment-tests.mjs", "ngspice"],
      {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, NGSPICE_BIN: "" },
      },
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("NGSPICE_BIN is required");
    expect(result.stdout).not.toContain("RUN ");
  });

  it("rejects a skipped target even when the same file has passing pure assertions", () => {
    const result = verify("windows", {
      testResults: [
        {
          name: resolve("apps/desktop/src/windows-association.test.ts"),
          assertionResults: [
            { fullName: "pure registry helper", status: "passed" },
            {
              fullName:
                "Windows project association registers and removes this executable only under an isolated per-user key",
              status: "pending",
            },
          ],
        },
      ],
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Target did not pass");
    expect(result.stderr).toContain("Windows project association");
  });

  it("rejects empty, missing and partially skipped target evidence", () => {
    const report = {
      success: true,
      testResults: [
        {
          name: resolve("apps/desktop/src/windows-association.test.ts"),
          assertionResults: [
            {
              fullName: "Windows project association registers the executable",
              status: "passed",
            },
          ],
        },
        {
          name: resolve("scripts/gallery-private-snapshot.test.mjs"),
          assertionResults: [
            {
              fullName:
                "refuses an exposed file inside a private Windows directory",
              status: "passed",
            },
          ],
        },
      ],
    };
    expect(verify("windows", report).status).toBe(0);
    expect(
      verify("windows", { success: true, testResults: [] }).stderr,
    ).toContain("Target not found");
    expect(
      verify("windows", { ...report, testResults: [report.testResults[0]] })
        .stderr,
    ).toContain("Target not found");
    report.testResults[0].assertionResults.push({
      fullName: "Windows project association unregisters the executable",
      status: "pending",
    });
    expect(verify("windows", report).stderr).toContain("Target did not pass");
  });
});
