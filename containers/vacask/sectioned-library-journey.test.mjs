import { expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import { prepareSourceExecutionInput } from "@icm/simulation-service";
import { validateNativeExampleResult } from "../../scripts/lib/native-example-acceptance.mjs";
import { startVacaskService } from "./entrypoint.mjs";

it.skipIf(
  !process.env.ICM_VACASK_SECTIONED_MANIFEST ||
    !process.env.VACASK_BIN ||
    !process.env.VACASK_MODULES,
)(
  "runs five native corners and OP/DC/AC/TRAN/Noise through one runtime Profile without changing authored source",
  async () => {
    const manifestPath = resolve(process.env.ICM_VACASK_SECTIONED_MANIFEST);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(manifest.status).toBe("packaged-not-executed");
    expect(manifest.sections).toEqual(["tt", "ff", "ss", "fs", "sf"]);
    const root = await mkdtemp(join(tmpdir(), "vacask-corner-profile-"));
    let service;
    const evidence = [];
    try {
      const startupPath = join(root, "startup.toml");
      await writeFile(startupPath, "# Explicit local sectioned native proof\n");
      const profile = {
        id: "vacask-sky130-candidate",
        corners: manifest.sections,
        dependencies: [manifest.dependency],
        modelSymbols: manifest.modelSymbols,
        modelLibrary: {
          dependencyId: manifest.dependency.id,
          defaultSection: "tt",
          defaultScale: 1e-6,
        },
      };
      const limits = {
        maxInputBytes: 65536,
        maxInputFiles: 12,
        maxOutputBytes: 8388608,
        maxLogBytes: 65536,
        maxRawFiles: 16,
        maxEntries: 256,
      };
      const capabilities = {
        configured: true,
        rawfileCollection: "native-multi-ascii",
        inputs: ["source"],
        analyses: ["op", "dc", "ac", "tran", "noise"],
        parsedAnalyses: ["op", "dc", "ac", "tran", "noise"],
        profiles: [profile],
        maxTimeoutMs: 30000,
        maxInputBytes: limits.maxInputBytes,
        maxInputFiles: limits.maxInputFiles,
        maxOutputBytes: limits.maxOutputBytes,
        cancel: true,
      };
      service = await startVacaskService({
        runtime: {
          executor: "local-host",
          profileId: profile.id,
          binary: resolve(process.env.VACASK_BIN),
          modules: resolve(process.env.VACASK_MODULES),
          startupPath,
          runRoot: root,
          dependencies: [
            {
              ...manifest.dependency,
              runtimePath: join(dirname(manifestPath), manifest.library),
            },
          ],
          ...(process.env.ICM_VACASK_LIBRARY_PATH
            ? { libraryPath: process.env.ICM_VACASK_LIBRARY_PATH }
            : {}),
        },
        capabilities,
        limits,
      });
      const runtime = await service.ready;
      const base = `http://127.0.0.1:${service.server.address().port}`;
      const project = createEmptyProject("corner-proof", "Native corner proof");
      const folder = createSimulationFolder({
        id: "s",
        name: "Proof",
        profileId: profile.id,
      });
      folder.input.dependencies = [
        { ...manifest.dependency, mountPath: "models.inc" },
      ];
      folder.input.files.find((f) => f.path === folder.input.entry).text =
        await readFile(
          resolve("netlists/native-corner-profile/proof.sim"),
          "utf8",
        );
      const before = structuredClone(folder);
      for (const corner of manifest.sections) {
        const compiled = await prepareSourceExecutionInput(
          project,
          folder,
          capabilities,
          { environment: { corner } },
        );
        if (!compiled.ok) throw Error(JSON.stringify(compiled.error));
        expect(compiled.input.preparedDeck).toContain(
          `include "models.inc" section=${corner}`,
        );
        expect(compiled.input.environment.profileId).toBe(profile.id);
        const response = await fetch(base + "/run", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(compiled.input),
          signal: AbortSignal.timeout(45000),
        });
        const result = await response.json();
        evidence.push({ corner, input: compiled.input, result });
        expect(response.status, JSON.stringify(result)).toBe(200);
        expect(result.outcome.status, JSON.stringify(result)).toBe("completed");
        validateNativeExampleResult(result);
        expect(result.metadata.environment).toEqual(runtime.environment);
        expect(new Set(result.data.analyses.map((a) => a.analysis))).toEqual(
          new Set(capabilities.analyses),
        );
        expect(result.executedFiles).toEqual(
          expect.arrayContaining(compiled.input.files),
        );
        expect(result.rawfiles.length).toBeGreaterThanOrEqual(5);
        expect(folder).toEqual(before);
      }
      const unsupported = await prepareSourceExecutionInput(
        project,
        folder,
        capabilities,
        { environment: { corner: "unknown" } },
      );
      expect(unsupported.ok).toBe(false);
      expect(folder).toEqual(before);
    } finally {
      if (process.env.ICM_VACASK_EVIDENCE_DIR) {
        const directory = await mkdtemp(
          join(
            resolve(process.env.ICM_VACASK_EVIDENCE_DIR),
            "sectioned-profile-",
          ),
        );
        await writeFile(join(directory, "runs.json"), JSON.stringify(evidence));
        console.info("Sectioned native Profile evidence", directory);
      }
      if (service) await service.stop();
      await rm(root, { recursive: true, force: true });
    }
  },
  180000,
);
