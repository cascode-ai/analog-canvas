import { expect, it } from "vitest";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { once } from "node:events";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { prepareSourceExecutionInput } from "@icm/simulation-service";

// This launches the actual CLI and VACASK; no HTTP or simulator mocks. Build
// workspace packages first, since the child Node process consumes package dist.
it.skipIf(!process.env.VACASK_BIN || !process.env.VACASK_MODULES)(
  "boots a standalone native executor, rejects bad input, then runs and returns real OP/AC evidence",
  async () => {
    const root = await mkdtemp(join(tmpdir(), "vacask-cli-"));
    let child, closed;
    try {
      const startupPath = join(root, "startup.toml");
      await writeFile(startupPath, "# Native CLI acceptance\n");
      const limits = {
        maxInputBytes: 1048576,
        maxInputFiles: 12,
        maxOutputBytes: 8388608,
        maxLogBytes: 65536,
        maxRawFiles: 16,
        maxEntries: 4096,
      };
      const capabilities = {
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["op", "ac"],
        parsedAnalyses: ["op", "ac"],
        profiles: [{ id: "cli-proof", corners: [] }],
        maxTimeoutMs: 15000,
        maxInputBytes: limits.maxInputBytes,
        maxInputFiles: limits.maxInputFiles,
        maxOutputBytes: limits.maxOutputBytes,
        cancel: true,
      };
      const configPath = join(root, "operator.json");
      await writeFile(
        configPath,
        JSON.stringify({
          listen: { host: "127.0.0.1", port: 0 },
          runtime: {
            executor: "local-host",
            profileId: "cli-proof",
            binary: resolve(process.env.VACASK_BIN),
            modules: resolve(process.env.VACASK_MODULES),
            startupPath,
            runRoot: root,
            ...(process.env.ICM_VACASK_LIBRARY_PATH
              ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
              : {}),
          },
          capabilities,
          limits,
        }),
      );
      child = spawn(
        process.execPath,
        [
          resolve(
            process.env.ICM_VACASK_HARNESS_ENTRY ??
              "containers/vacask/entrypoint.mjs",
          ),
          configPath,
        ],
        {
          cwd: root,
          stdio: ["ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );
      closed = once(child, "close");
      let stdout = "",
        stderr = "";
      child.stdout.on("data", (chunk) => {
        stdout = (stdout + chunk).slice(-65536);
      });
      child.stderr.on("data", (chunk) => {
        stderr = (stderr + chunk).slice(-65536);
      });
      await expect
        .poll(
          () => {
            if (child.exitCode !== null) throw Error(`CLI exited: ${stderr}`);
            return stdout.includes('"event":"vacask-listening"');
          },
          { timeout: 20000 },
        )
        .toBe(true);
      const ready = JSON.parse(stdout.trim());
      const origin = `http://127.0.0.1:${ready.port}`;
      await expect
        .poll(async () => (await fetch(origin + "/health")).status, {
          timeout: 20000,
        })
        .toBe(200);
      const health = await (await fetch(origin + "/health")).json();
      expect(health.environment.simulator.name).toBe("vacask");
      const post = (body) =>
        fetch(origin + "/api/simulate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(20000),
        });
      expect((await post({ operation: "unsupported" })).status).toBe(400);
      const advertised = await (
        await post({ operation: "capabilities" })
      ).json();
      const project = createEmptyProject("cli", "Native CLI");
      const folder = createSimulationFolder({
        id: "s",
        name: "Native",
        profileId: "cli-proof",
      });
      folder.input.files.find((f) => f.path === folder.input.entry).text =
        await readFile(
          resolve("netlists/vacask-agent-divider/agent.sim"),
          "utf8",
        );
      const compiled = await prepareSourceExecutionInput(
        project,
        folder,
        advertised,
      );
      if (!compiled.ok) throw Error(JSON.stringify(compiled.error));
      const response = await post(compiled.input);
      const result = await response.json();
      expect(response.status, JSON.stringify(result)).toBe(200);
      expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
      expect(result.metadata.environment).toEqual(health.environment);
      expect(result.rawfiles.map((f) => f.path)).toEqual(
        expect.arrayContaining(["agent_op.raw", "agent_ac.raw"]),
      );
      const op = result.data.analyses.find((a) => a.analysis === "op");
      expect(op.probes.find((p) => p.name === "mid").value).toBeCloseTo(
        0.5,
        10,
      );
      expect(result.executedFiles).toEqual(
        expect.arrayContaining(compiled.input.files),
      );
      expect((await fetch(origin + "/health")).status).toBe(200);
    } finally {
      if (child && child.exitCode === null) child.kill("SIGTERM");
      if (closed) await closed;
      await rm(root, { recursive: true, force: true });
    }
  },
  45000,
);
