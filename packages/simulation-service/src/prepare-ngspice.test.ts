import { describe, expect, it } from "vitest";
import { CircuitProjectSchema, createSimulationFolder } from "@icm/model";
import { currentFiveTransistorOtaCircuitSource } from "../../../apps/editor/src/examples/five-transistor-ota.test-support.js";
import { CapabilitiesSchema } from "./contract.js";
import { ProjectInputIdentity } from "./input-identity.js";
import { prepareNgspiceExecutionInput } from "./prepare-ngspice.js";

describe("ngspice authored input identity", () => {
  it.each([undefined, "ff"])(
    "keeps Profile-resolved corner %s out of source identity",
    async (corner) => {
      const project = CircuitProjectSchema.parse(
        currentFiveTransistorOtaCircuitSource(),
      );
      const folder = createSimulationFolder({
        id: "native",
        name: "Native",
        profileId: "ngspice",
        engine: "ngspice",
        documentId: project.topDocumentId,
      });
      folder.input.files.find((f) => f.path === folder.input.configPath)!.text =
        JSON.stringify({
          version: 2,
          environment: { profileId: "ngspice" },
        });
      if (corner) {
        folder.input.dependencies = [
          { id: "models", sha256: "a".repeat(64), mountPath: "models.lib" },
        ];
        const entry = folder.input.files.find(
          (f) => f.path === folder.input.entry,
        )!;
        entry.text = entry.text.replace(
          "\n",
          `\n.lib "models.lib" ${corner}\n`,
        );
      }
      project.simulationFolders = [folder];
      const before = structuredClone(project);
      const caps = CapabilitiesSchema.parse({
        configured: true,
        rawfileCollection: "declared-single-ascii",
        inputs: ["source"],
        analyses: ["op"],
        parsedAnalyses: ["op"],
        profiles: [
          {
            id: "ngspice",
            corners: ["tt", "ff"],
            dependencies: [{ id: "models", sha256: "a".repeat(64) }],
          },
        ],
        modelLibrary: { path: "models.lib", section: "tt" },
        maxInputBytes: 2 * 1024 * 1024,
        maxOutputBytes: 1024 * 1024,
        maxTimeoutMs: 15000,
        cancel: true,
      });
      const prepared = await prepareNgspiceExecutionInput(
        project,
        folder,
        caps,
      );
      if (!prepared.ok) throw Error(JSON.stringify(prepared));
      expect(prepared.input.environment.corner).toBe(corner ?? "tt");
      const identity = new ProjectInputIdentity();
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).toBe(prepared.input.inputRevision);
      expect(project).toEqual(before);
      project.documents[0]!.revision++;
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).toBe(prepared.input.inputRevision);
      folder.input.files.find((f) => f.path === folder.input.entry)!.text +=
        "\n* source changed\n";
      project.structureRevision++;
      expect(
        await identity.read(project, folder.id, undefined, "ngspice"),
      ).not.toBe(prepared.input.inputRevision);
    },
  );
});
