import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { analyzeDesignNetlistForAuthoring } from "@icm/netlist";

import {
  EDITOR_PROJECT_TRANSACTION_OPTIONS,
  EditorDocumentController,
} from "../document/document-controller";
import {
  applyProjectCopyPlacement,
  captureProjectCopy,
  planProjectCopyPlacement,
} from "../features/clipboard/project-copy";
import { copyWorkspaceCell } from "./workspace-copy";
import { finiteGainProject } from "../../test-fixtures/finite-gain-copy";
import {
  decodeCircuitClipboard,
  encodeCircuitClipboard,
} from "../features/clipboard/system-clipboard";

describe("copyWorkspaceCell", () => {
  it.each([
    ["Agent", true],
    ["canvas", true],
    ["system clipboard", true],
    ["Agent", false],
    ["canvas", false],
    ["system clipboard", false],
  ] as const)(
    "%s copies finite_gain twice without outside names (target has matching names: %s)",
    (path, matching) => {
      const source = new EditorDocumentController(finiteGainProject("source"));
      const sourceBefore = structuredClone(source.project);
      const destination = new EditorDocumentController(
        matching
          ? finiteGainProject("target")
          : createEmptyProject("target", "Target"),
      );
      const targetBefore = structuredClone(destination.project);
      const targetNets = structuredClone(destination.document.nets);
      const selection = {
        instanceIds: ["X1"],
        routeIds: [],
        junctionIds: [],
        annotationIds: [],
        draftingIds: [],
      };
      for (const x of [2000, 4000]) {
        if (path !== "Agent") {
          const clipboard =
            path === "canvas"
              ? captureProjectCopy(source.project, source.document, selection)!
              : decodeCircuitClipboard(
                  encodeCircuitClipboard(
                    source.project,
                    source.document,
                    selection,
                  )!,
                )!;
          destination.commitProjectStructure(
            applyProjectCopyPlacement(
              planProjectCopyPlacement(
                destination.project,
                destination.document,
                clipboard,
                { x, y: 0 },
                1,
              ),
              undefined,
              EDITOR_PROJECT_TRANSACTION_OPTIONS,
            ),
            destination.document.id,
          );
          continue;
        }
        const copied = copyWorkspaceCell(
          {
            action: "copy",
            sourceWorkspaceId: "source-tab",
            sourceDocumentId: source.document.id,
            sourceRevision: source.document.revision,
            sourceStructureRevision: source.project.structureRevision,
            targetWorkspaceId: "target-tab",
            targetDocumentId: destination.document.id,
            expectedStructureRevision: destination.project.structureRevision,
            expectedRevision: destination.document.revision,
            selection,
            offset: { x, y: 0 },
          },
          source,
          destination,
          {
            captureProjectCopy,
            planProjectCopyPlacement,
            applyProjectCopyPlacement: (plan, actor) =>
              applyProjectCopyPlacement(
                plan,
                actor,
                EDITOR_PROJECT_TRANSACTION_OPTIONS,
              ),
          },
        );
        expect(copied).toHaveProperty("result");
      }
      expect(destination.document.instances).toHaveLength(matching ? 3 : 2);
      expect(destination.document.annotations).toEqual(
        targetBefore.documents[0]!.annotations,
      );
      expect(destination.document.nets).toEqual(targetNets);
      expect(destination.document.connectivityEvidence).toEqual(
        targetBefore.documents[0]!.connectivityEvidence,
      );
      expect(destination.project.modelSources).toHaveLength(1);
      expect(destination.project.modelSources?.[0]?.files).toEqual(
        sourceBefore.modelSources?.[0]?.files,
      );
      const reopened = parseProject(serializeProject(destination.project));
      const netlist = analyzeDesignNetlistForAuthoring(reopened, {
        format: "spectre",
      });
      expect(netlist.ir, JSON.stringify(netlist.diagnostics)).not.toBeNull();
      const instances = netlist.ir!.cells.find(
        (cell) => cell.id === reopened.topDocumentId,
      )!.instances;
      const floatingCopies = instances.filter(
        (instance) => !matching || instance.id !== "X1",
      );
      // The authoring projection marks disconnected pins explicitly; these are
      // placeholders, not simulator node names that could join the copies.
      for (const instance of floatingCopies)
        expect(instance.nodes).toEqual([
          { pinName: "IN", netName: "<unconnected:IN>" },
          { pinName: "OUT", netName: "<unconnected:OUT>" },
          { pinName: "VSS", netName: "<unconnected:VSS>" },
        ]);
      const resolver = createProjectSymbolResolver(reopened, builtInSymbols);
      for (const instance of reopened.documents[0]!.instances) {
        expect(
          resolver
            .resolve(instance.symbolId)
            ?.definition.pins.map((pin) => pin.name),
        ).toEqual(["IN", "OUT", "VSS"]);
        expect(instance.netlist?.parameters).toEqual({ GAIN: "10" });
      }
      expect(source.project).toEqual(sourceBefore);
      expect(destination.transact([{ kind: "undo" }]).ok).toBe(true);
      expect(destination.document.instances).toHaveLength(matching ? 2 : 1);
      expect(destination.transact([{ kind: "redo" }]).ok).toBe(true);
      expect(destination.document.nets).toEqual(targetNets);
      expect(destination.document.annotations).toEqual(
        targetBefore.documents[0]!.annotations,
      );
      expect(destination.document.instances).toHaveLength(matching ? 3 : 2);
    },
  );

  it("marks the Project an Agent copies into, not the one it copies from", () => {
    const drawn = createEmptyProject("source", "Source");
    drawn.documents[0]!.instances = [
      {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    ];
    const source = new EditorDocumentController(drawn);
    const destination = new EditorDocumentController(
      createEmptyProject("target", "Target"),
    );

    const copied = copyWorkspaceCell(
      {
        action: "copy",
        sourceWorkspaceId: "source-tab",
        sourceDocumentId: source.document.id,
        sourceRevision: source.document.revision,
        sourceStructureRevision: source.project.structureRevision,
        targetWorkspaceId: "target-tab",
        targetDocumentId: destination.document.id,
        expectedStructureRevision: destination.project.structureRevision,
        expectedRevision: destination.document.revision,
        offset: { x: 0, y: 0 },
      },
      source,
      destination,
      {
        captureProjectCopy,
        planProjectCopyPlacement,
        applyProjectCopyPlacement: (plan, actor) =>
          applyProjectCopyPlacement(
            plan,
            actor,
            EDITOR_PROJECT_TRANSACTION_OPTIONS,
          ),
      },
    );

    expect(copied).toHaveProperty("result");
    expect(destination.document.instances).toHaveLength(1);
    expect(destination.agentEdited).toBe(true);
    expect(source.agentEdited).toBe(false);
  });
});
