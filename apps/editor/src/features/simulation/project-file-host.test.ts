import { describe, expect, it, vi } from "vitest";
import {
  parseProject,
  serializeProject,
  canonicalConnectionIndexes,
} from "@icm/project-protocol";
import { generateCircuitSource } from "@icm/netlist";
import { createEmptyProject, createSimulationFolder } from "@icm/model";
import {
  executeProjectTransaction,
  createExternalSubcircuitInstance,
} from "@icm/edit-engine";
import { SimulationFiles, sha256 } from "@icm/simulation-service/files";
import ota from "../../../../../netlists/native-ota-library/legacy-source.icproj.json";
import { EditorDocumentController } from "../../document/document-controller";
import { createSimulationProjectFileHost } from "./project-file-host";

function fixture(actor: "human" | "agent" = "human") {
  const controller = new EditorDocumentController(
    parseProject(JSON.stringify(ota)),
  );
  const dispatch = vi.fn(
    (
      request: Parameters<
        EditorDocumentController["dispatchProjectTransaction"]
      >[0],
    ) => controller.dispatchProjectTransaction(request),
  );
  const host = createSimulationProjectFileHost({
    getProject: () => controller.project,
    getProjectSessionId: () => controller.projectSessionId,
    dispatch,
    actor: { kind: actor, id: actor },
  });
  const files = new SimulationFiles(Date.now, host);
  const folder = controller.project.simulationFolders[0]!;
  const generated = generateCircuitSource(
    controller.project,
    folder.input.circuitBindings[0]!,
  );
  if (!generated.ok) throw Error(JSON.stringify(generated.diagnostics));
  const source = generated.source;
  const span = source.parameters.find((span) => span.parameter === "w")!;
  const text =
    source.text.slice(0, span.startOffset) +
    "8" +
    source.text.slice(span.endOffset);
  return {
    controller,
    dispatch,
    files,
    folder,
    source,
    span,
    text,
    owner: { kind: "project-folder" as const, folderId: folder.id },
  };
}
describe("shared human/Agent generated Circuit File Resource", () => {
  it("writes a mapped model body to its undoable shared owner across experiments", async () => {
    const project = createEmptyProject("file-model", "File model");
    const applied = executeProjectTransaction(project, {
      projectId: project.id,
      expectedStructureRevision: 0,
      transactionId: "define",
      actor: { kind: "agent", id: "test" },
      edits: [
        {
          kind: "apply_model_source",
          source: {
            id: "source",
            language: "spice",
            entry: "model.spice",
            files: [
              {
                path: "model.spice",
                text: ".subckt finite_gain A OUT params: gain=20\nB1 OUT 0 V={gain*v(A)}\n.ends finite_gain\n",
              },
            ],
            dependencies: [],
            revision: 0,
          },
          definitions: [{ definitionId: "gain", entry: "finite_gain" }],
        },
      ],
    });
    if (!applied.ok) throw Error(JSON.stringify(applied));
    const owned = applied.project;
    owned.documents[0]!.instances.push(
      createExternalSubcircuitInstance(
        "X1",
        owned.externalSubcircuitDefinitions[0]!,
        { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      ),
    );
    owned.documents[0]!.noConnects.push(
      ...["A", "OUT"].map((pinName) => ({
        id: `nc-${pinName}`,
        endpoint: { kind: "terminal" as const, instanceId: "X1", pinName },
      })),
    );
    owned.simulationFolders = ["op", "ac"].map((id) =>
      createSimulationFolder({
        id,
        name: id,
        engine: "ngspice",
        profileId: "ngspice",
        documentId: owned.documents[0]!.id,
      }),
    );
    const controller = new EditorDocumentController(owned);
    const host = createSimulationProjectFileHost({
      getProject: () => controller.project,
      getProjectSessionId: () => controller.projectSessionId,
      dispatch: (request) => controller.dispatchProjectTransaction(request),
      actor: { kind: "agent", id: "test" },
    });
    const files = new SimulationFiles(Date.now, host, async () => "ngspice");
    const owner = { kind: "project-folder" as const, folderId: "op" };
    const read = await files.handle({
      action: "read",
      owner,
      path: "circuit.spice",
    });
    if (!read.ok || !("textDigest" in read)) throw Error(JSON.stringify(read));
    expect(read).toMatchObject({
      modelSources: [
        expect.objectContaining({
          sourceId: "source",
          revision: 1,
          path: "model.spice",
        }),
      ],
    });
    const folderBefore = structuredClone(controller.project.simulationFolders);
    const update = await files.handle({
      action: "update",
      owner,
      expectedRevision: controller.project.structureRevision,
      circuitEdits: [
        {
          path: "circuit.spice",
          textDigest: read.textDigest,
          text: read.text.replace("gain=20", "gain=35"),
        },
      ],
    });
    expect(update).toMatchObject({ ok: true });
    expect(controller.project.modelSources![0]!.files[0]!.text).toContain(
      "gain=35",
    );
    expect(controller.project.simulationFolders).toEqual(folderBefore);
    const second = await files.handle({
      action: "read",
      owner: { ...owner, folderId: "ac" },
      path: "circuit.spice",
    });
    expect(second).toMatchObject({
      ok: true,
      text: expect.stringContaining("gain=35"),
    });
    const stale = await files.handle({
      action: "update",
      owner,
      expectedRevision: controller.project.structureRevision,
      circuitEdits: [
        {
          path: "circuit.spice",
          textDigest: read.textDigest,
          text: read.text.replace("gain=20", "gain=50"),
        },
      ],
    });
    expect(stale.ok).toBe(false);
    controller.transact([{ kind: "undo" }]);
    expect(controller.project.modelSources![0]!.files[0]!.text).toContain(
      "gain=20",
    );
    controller.transact([{ kind: "redo" }]);
    expect(controller.project.modelSources![0]!.files[0]!.text).toContain(
      "gain=35",
    );
  });
  it("adds and unsets source clauses through the same atomic undoable transaction", async () => {
    const f = fixture();
    const before = f.controller.project;
    const source = f.source.sourceBodies!.find(
      (body) => body.instanceId === "VDD",
    )!;
    const write = async (text: string, original: string) =>
      f.files.handle({
        action: "update",
        owner: f.owner,
        expectedRevision: f.controller.project.structureRevision,
        circuitEdits: [
          {
            path: f.source.binding.path,
            textDigest: await sha256(original),
            text,
          },
        ],
      });
    const added =
      f.source.text.slice(0, source.endOffset) +
      " mag=1 phase=-90" +
      f.source.text.slice(source.endOffset);
    expect(await write(added, f.source.text)).toMatchObject({ ok: true });
    const parameters = () =>
      f.controller.project.documents
        .find((d) => d.id === source.documentId)!
        .instances.find((i) => i.id === source.instanceId)!.netlist!.parameters;
    expect(parameters()).toMatchObject({ acMagnitude: "1", acPhase: "-90" });
    const generated = generateCircuitSource(
      f.controller.project,
      f.source.binding,
    );
    if (!generated.ok) throw Error("Expected Circuit");
    expect(
      await write(
        generated.source.text.replace(" mag=1 phase=-90", ""),
        generated.source.text,
      ),
    ).toMatchObject({ ok: true });
    expect(parameters()).not.toHaveProperty("acMagnitude");
    expect(parameters()).not.toHaveProperty("acPhase");
    f.controller.transact([{ kind: "undo" }]);
    expect(parameters()).toMatchObject({ acMagnitude: "1", acPhase: "-90" });
    f.controller.transact([{ kind: "undo" }]);
    expect(
      f.controller.project.documents.map(
        ({ revision: _revision, ...document }) => document,
      ),
    ).toEqual(
      before.documents.map(({ revision: _revision, ...document }) => document),
    );
  });
  it.each(["human", "agent"] as const)(
    "commits source and mapped sizes atomically with normal undo/redo (%s)",
    async (actor) => {
      const f = fixture(actor),
        before = f.controller.project;
      const read = await f.files.handle({
        action: "read",
        owner: f.owner,
        path: f.source.binding.path,
      });
      expect(read).toMatchObject({
        ok: true,
        text: f.source.text,
        instances: f.source.instances,
        editableParameters: expect.arrayContaining([
          expect.objectContaining({ parameter: "w" }),
        ]),
      });
      const written = await f.files.handle({
        action: "update",
        owner: f.owner,
        expectedRevision: before.structureRevision,
        writes: [
          {
            path: f.folder.input.entry,
            text: "* 🧪\r\nunfinished code is saveable\r\n",
          },
        ],
        circuitEdits: [
          {
            path: f.source.binding.path,
            textDigest: await sha256(f.source.text),
            text: f.text,
          },
        ],
      });
      expect(written).toMatchObject({
        ok: true,
        source: { revision: before.structureRevision + 1 },
      });
      expect(f.dispatch).toHaveBeenCalledTimes(1);
      const after = f.controller.project;
      expect(
        after.documents
          .find((d) => d.id === f.span.documentId)!
          .instances.find((i) => i.id === f.span.instanceId)!.netlist!
          .parameters.w,
      ).not.toBe(
        before.documents
          .find((d) => d.id === f.span.documentId)!
          .instances.find((i) => i.id === f.span.instanceId)!.netlist!
          .parameters.w,
      );
      expect(
        canonicalConnectionIndexes(parseProject(serializeProject(after))),
      ).toEqual(canonicalConnectionIndexes(after));
      f.controller.transact([{ kind: "undo" }]);
      expect(
        f.controller.project.documents.map(
          ({ revision, ...content }) => content,
        ),
      ).toEqual(before.documents.map(({ revision, ...content }) => content));
      expect(f.controller.project.simulationFolders).toEqual(
        before.simulationFolders,
      );
      f.controller.transact([{ kind: "redo" }]);
      expect(f.controller.project.documents.map((d) => d.instances)).toEqual(
        after.documents.map((d) => d.instances),
      );
      expect(f.controller.project.simulationFolders).toEqual(
        after.simulationFolders,
      );
    },
  );
  it("rejects topology and stale generated bytes without applying any authored half", async () => {
    const f = fixture(),
      before = f.controller.project;
    for (const edit of [
      {
        textDigest: await sha256(f.source.text),
        text: f.text + "\nRextra a 0 1k",
      },
      { textDigest: "a".repeat(64), text: f.text },
    ]) {
      const result = await f.files.handle({
        action: "update",
        owner: f.owner,
        expectedRevision: before.structureRevision,
        writes: [
          {
            path: f.folder.input.configPath,
            text: "invalid JSON can be saved, but not half a rejected transaction",
          },
        ],
        circuitEdits: [{ path: f.source.binding.path, ...edit }],
      });
      expect(result.ok).toBe(false);
      expect(f.controller.project).toBe(before);
    }
    expect(f.dispatch).not.toHaveBeenCalled();
  });
  it("detects revision changes and allows repair without losing the session", async () => {
    const f = fixture(),
      revision = f.controller.project.structureRevision;
    const write = (expectedRevision: number) =>
      f.files.handle({
        action: "update",
        owner: f.owner,
        expectedRevision,
        writes: [{ path: f.folder.input.configPath, text: "{" }],
      });
    expect(
      f.controller.dispatchProjectTransaction({
        transactionId: "concurrent",
        projectId: f.controller.project.id,
        expectedStructureRevision: revision,
        actor: { kind: "human", id: "human" },
        edits: [{ kind: "rename_project", name: "Changed elsewhere" }],
      }).ok,
    ).toBe(true);
    expect(await write(revision)).toMatchObject({
      ok: false,
      error: { code: "PROJECT_REVISION_CONFLICT" },
    });
    expect(await write(f.controller.project.structureRevision)).toMatchObject({
      ok: true,
    });
    expect(
      parseProject(
        serializeProject(f.controller.project),
      ).simulationFolders[0]!.input.files.find(
        (file) => file.path === f.folder.input.configPath,
      )!.text,
    ).toBe("{");
  });
});
