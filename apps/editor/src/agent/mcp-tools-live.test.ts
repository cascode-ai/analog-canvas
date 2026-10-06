import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  createSimulationFolder,
  readSimulationExperimentConfig,
  type CircuitProject,
} from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";
import { importSpiceSources } from "@icm/spice";
import type { Capabilities } from "@icm/simulation-service/contract";
import { callTool, type ToolSessionState } from "../../../mcp-server/src/tools";
import { compareExpectedNetlist } from "../../../mcp-server/src/netlist-comparison";
import { createDefaultNetlistExportPreferences } from "../features/netlist-export/netlist-export-preferences";
import {
  placementModelTarget,
  placementProcessFill,
} from "../features/netlist-export/netlist-process";
import {
  emptyAgentProject,
  liveAgentEditor,
  personEdits,
  type LiveAgentEditorOptions,
} from "./live-agent-editor.test-support";
import otaLibrary from "../../../../netlists/native-ota-library/legacy-source.icproj.json";

// Measuring a figure's crop needs a real browser layout; everything around
// it, the same formal SVG included, runs as it does in the Editor.
vi.mock("@icm/exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@icm/exporters")>();
  return {
    ...actual,
    createBrowserFormalExportSource: async (
      ...args: Parameters<typeof actual.createFormalExportSource>
    ) => actual.createFormalExportSource(...args),
  };
});

type LiveEditor = ReturnType<typeof liveAgentEditor>;

const dutDocumentId = "document-ota-5t";
const dutName = "ota_5t";
// The OTA Cell's exported order: the testbench connects by position.
const dutPorts = ["VDD", "VSS", "IBIAS", "VINN", "VINP", "VOUT"];

function parseText(result: { content: { type: string; text?: string }[] }) {
  expect(result.content[0]?.type).toBe("text");
  return JSON.parse(result.content[0]!.text!);
}

/** The OTA library Project, as the editor opens the file. */
function otaProject(): CircuitProject {
  return parseProject(JSON.stringify(otaLibrary));
}

/** The MCP server's tools, on a session with the live editor. */
function mcp(options: LiveAgentEditorOptions = {}) {
  const editor = liveAgentEditor(options);
  const session: ToolSessionState = { client: editor.client };
  const call = (name: string, args: unknown) => callTool(name, args, session);
  const tool = async (name: string, args: unknown) =>
    parseText(await call(name, args));
  return { ...editor, session, call, tool };
}

async function connected(options: LiveAgentEditorOptions = {}) {
  const editor = mcp(options);
  expect(
    await editor.tool("connect", { claimCode: "session-1.code" }),
  ).toMatchObject({ ok: true });
  return editor;
}

/** Each Snapshot request the editor answered, by projection. */
function snapshotReads(http: LiveEditor["http"]) {
  return http.circuitCalls.flatMap(({ request }) =>
    request.operation === "snapshot" ? [request.projection ?? "full"] : [],
  );
}

function transacts(http: LiveEditor["http"]) {
  return http.circuitCalls.filter(
    ({ request }) => request.operation === "transact",
  ).length;
}

const place = (
  symbol: string,
  reference: string,
  x: number,
  extra: Record<string, unknown> = {},
) => ({
  kind: "place-component",
  symbol,
  reference,
  position: { x, y: 100 },
  ...extra,
});
const pin = (instance: string, name: string) => ({
  kind: "pin",
  instance,
  pin: name,
});

/** A Cell Pin's own pin, found by its terminal's name. */
function cellPin(editor: LiveEditor, name: string) {
  const terminal = editor.controller.document.netlist!.terminals.find(
    (item) => item.name === name,
  )!;
  return {
    kind: "pin",
    instance: { kind: "instance", id: terminal.interfaceInstanceIds[0]! },
    pin: "P",
  };
}

async function apply(editor: LiveEditor, actions: unknown[]) {
  const report = await editor.client.applyActions(actions);
  expect(report.ok, report.message).toBe(true);
  return report;
}

/**
 * The simulation service the editor's Simulation resource calls over the
 * network. Only its answer is scripted: it offers these Profiles.
 */
function profileService(
  ...profiles: {
    id: string;
    engine: "ngspice" | "vacask";
    devices?: string[];
  }[]
): typeof fetch {
  return (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { operation?: string };
    if (body.operation !== "capabilities")
      return Response.json({ error: "unexpected" }, { status: 500 });
    return Response.json({
      configured: true,
      inputs: ["source"],
      analyses: ["op"],
      parsedAnalyses: ["op"],
      profiles: profiles.map((profile) => ({ ...profile, corners: [] })),
      maxTimeoutMs: 1000,
      maxInputBytes: 10000,
      maxOutputBytes: 10000,
      cancel: false,
    } satisfies Capabilities);
  }) as typeof fetch;
}

/** The Gallery service's answers over the network, for these entries. */
function galleryService(entries: Record<string, CircuitProject>) {
  return (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/gallery" || url.startsWith("/api/gallery?"))
      return Response.json({
        entries: Object.entries(entries).map(([id, project]) => ({
          id,
          name: project.name,
          author: "Magic Li",
          description: "",
          createdAt: "2026-09-20T00:00:00.000Z",
          schemaVersion: project.schemaVersion,
          tags: [],
        })),
        nextCursor: null,
        total: Object.keys(entries).length,
      });
    const id = decodeURIComponent(url.slice("/api/gallery/".length));
    const project = entries[id];
    return project
      ? Response.json({
          entry: { id, name: project.name },
          projectText: serializeProject(project),
        })
      : new Response(null, { status: 404 });
  }) as typeof fetch;
}

describe("MCP tools on the live editor", () => {
  it("inserts a Gallery drawing into the target Cell without opening or replacing a Project", async () => {
    const source = await connected();
    await apply(source, [
      place("port", "I", 50),
      place("resistor", "R1", 100, { parameters: { value: "1k" } }),
      place("port", "O", 250),
    ]);
    await apply(source, [
      { kind: "connect", from: cellPin(source, "I"), to: pin("R1", "1") },
      { kind: "connect", from: pin("R1", "2"), to: cellPin(source, "O") },
    ]);
    const sourceCode = serializeProject(source.controller.project);
    const editor = await connected({
      projectHost: { fetch: galleryService({ g1: source.controller.project }) },
    });
    const receipt = await editor.tool("gallery_circuits", {
      action: "insert",
      galleryEntryId: "g1",
      targetDocumentId: "main",
      position: { x: 300, y: 200 },
    });
    expect(receipt).toMatchObject({
      ok: true,
      operation: "insert-gallery-entry",
      galleryEntryId: "g1",
      sourceDocumentId: "main",
      targetDocumentId: "main",
      instanceIds: [expect.any(String), expect.any(String), expect.any(String)],
    });
    const read = await editor.client.refreshSnapshot();
    expect(read.snapshot.project.id).toBe("project-1");
    expect(read.snapshot.document.instances).toHaveLength(3);
    expect(editor.controller.document.routes).toHaveLength(2);
    expect(editor.controller.document.annotations.length).toBeGreaterThan(0);
    expect(
      editor.controller.document.instances[0]!.placement?.position,
    ).toEqual({ x: 300, y: 200 });
    expect(serializeProject(source.controller.project)).toBe(sourceCode);
    for (const format of ["spice", "spectre"]) {
      expect(
        await editor.tool("netlist_code", { action: "read", format }),
      ).toMatchObject({
        ok: true,
        netlist: { status: "ready", text: expect.stringContaining("R1") },
      });
    }
    await apply(editor, [{ kind: "undo" }]);
    expect(editor.controller.document.instances).toHaveLength(0);
  });
  it("reports Gallery login separately without replacing the target", async () => {
    const editor = await connected({
      projectHost: { fetch: async () => new Response(null, { status: 401 }) },
    });
    const before = serializeProject(editor.controller.project);
    expect(
      await editor.tool("gallery_circuits", {
        action: "insert",
        galleryEntryId: "g1",
        targetDocumentId: "main",
        position: { x: 100, y: 100 },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIGN_IN_REQUIRED", recovery: "sign-in" },
    });
    expect(serializeProject(editor.controller.project)).toBe(before);
  });
  it.each([
    ["missing", "GALLERY_ENTRY_NOT_FOUND"],
    ["empty", "COPY_EMPTY"],
  ])(
    "rejects %s Gallery insertion without opening or editing a Project",
    async (galleryEntryId, code) => {
      const editor = await connected({
        projectHost: { fetch: galleryService({ empty: emptyAgentProject() }) },
      });
      const before = serializeProject(editor.controller.project);
      expect(
        await editor.tool("gallery_circuits", {
          action: "insert",
          galleryEntryId,
          targetDocumentId: "main",
          position: { x: 100, y: 100 },
        }),
      ).toMatchObject({ ok: false, error: { code } });
      expect(serializeProject(editor.controller.project)).toBe(before);
    },
  );
  it.each(["revision", "structure", "session", "closed"])(
    "rechecks target %s after the Gallery download",
    async (change) => {
      const source = await connected();
      await apply(source, [place("resistor", "R1", 100)]);
      let finish!: (response: Response) => void;
      let available = true;
      let started!: () => void;
      const reading = new Promise<void>((resolve) => {
        started = resolve;
      });
      const editor = await connected({
        projectHost: {
          isProjectAvailable: () => available,
          fetch: async () => {
            started();
            return new Promise<Response>((resolve) => {
              finish = resolve;
            });
          },
        },
      });
      const pending = editor.tool("gallery_circuits", {
        action: "insert",
        galleryEntryId: "g1",
        targetDocumentId: "main",
        position: { x: 300, y: 200 },
      });
      await reading;
      if (change === "session")
        editor.controller.replaceProject(emptyAgentProject("Replacement"));
      else if (change === "closed") available = false;
      else if (change === "structure") {
        const renamed = structuredClone(editor.controller.project);
        renamed.name = "Changed while downloading";
        expect(
          await editor.tool("project_code", {
            action: "replace",
            projectCode: serializeProject(renamed),
          }),
        ).toMatchObject({ ok: true });
      } else await apply(editor, [place("resistor", "R2", 100)]);
      const expected = serializeProject(editor.controller.project);
      finish(
        Response.json({
          projectText: serializeProject(source.controller.project),
        }),
      );
      expect(await pending).toMatchObject({
        ok: false,
        error: {
          code:
            change === "session" || change === "closed"
              ? "PROJECT_REPLACED"
              : "PROJECT_CONTEXT_STALE",
        },
      });
      expect(serializeProject(editor.controller.project)).toBe(expected);
    },
  );
  it("reports an uncertain commit as refresh, not permission to repeat the insert", async () => {
    const source = await connected();
    await apply(source, [place("resistor", "R1", 100)]);
    let editor!: Awaited<ReturnType<typeof connected>>;
    editor = await connected({
      projectHost: {
        fetch: galleryService({ g1: source.controller.project }),
        commitProjectStructure: (project, documentId) => {
          editor.controller.commitProjectStructure(project, documentId);
          throw new Error("commit notification failed");
        },
      },
    });
    expect(
      await editor.tool("gallery_circuits", {
        action: "insert",
        galleryEntryId: "g1",
        targetDocumentId: "main",
        position: { x: 300, y: 200 },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "GALLERY_INSERT_COMMIT_FAILED", recovery: "refresh" },
    });
    expect(editor.controller.document.instances).toHaveLength(1);
    await apply(editor, [{ kind: "undo" }]);
    expect(editor.controller.document.instances).toHaveLength(0);
  });
  it("inserts a Gallery hierarchy with its model files and rolls the whole closure back in one undo", async () => {
    const modelText = ".subckt leaf A B\nR0 A B 1k\n.ends leaf\n";
    const imported = await importSpiceSources(
      [
        {
          path: "main.cir",
          bytes: new TextEncoder().encode(
            "* Gallery hierarchy\n.include models.lib\n.subckt child IN OUT\nXLEAF IN OUT leaf\n.ends child\nX1 IN OUT child\nVIN IN 0 1\nRL OUT 0 1k\n.end\n",
          ),
        },
        { path: "models.lib", bytes: new TextEncoder().encode(modelText) },
      ],
      "main.cir",
    );
    expect(
      imported.diagnostics.filter((item) => item.severity === "error"),
    ).toEqual([]);
    const source = imported.project!;
    const editor = await connected({
      projectHost: { fetch: galleryService({ ota: source }) },
    });
    const receipt = await editor.tool("gallery_circuits", {
      action: "insert",
      galleryEntryId: "ota",
      targetDocumentId: "main",
      position: { x: 500, y: 300 },
    });
    expect(receipt, JSON.stringify(receipt)).toMatchObject({
      ok: true,
      importedDocumentIds: [expect.any(String), expect.any(String)],
    });
    expect(editor.controller.project.documents).toHaveLength(3);
    expect(
      editor.controller.document.instances.some(
        (item) => item.netlist?.binding?.kind === "subcircuit",
      ),
    ).toBe(true);
    const files = editor.controller.project.source.files;
    expect(receipt.importedFileIds).toHaveLength(2);
    expect(files.map((file) => file.content?.text)).toContain(modelText);
    for (const format of ["spice", "spectre"]) {
      expect(
        await editor.tool("netlist_code", { action: "read", format }),
      ).toMatchObject({
        ok: true,
        netlist: { status: "ready", text: expect.stringContaining("child") },
      });
    }
    await apply(editor, [{ kind: "undo" }]);
    expect(editor.controller.project.documents).toHaveLength(1);
    expect(editor.controller.document.instances).toHaveLength(0);
    expect(editor.controller.project.source.files).toHaveLength(0);
    const child = source.documents.find((item) => item.name === "child")!;
    const selected = await editor.tool("gallery_circuits", {
      action: "insert",
      galleryEntryId: "ota",
      sourceDocumentId: child.id,
      targetDocumentId: "main",
      position: { x: 500, y: 300 },
    });
    expect(selected).toMatchObject({
      ok: true,
      sourceDocumentId: child.id,
      importedDocumentIds: [expect.any(String)],
    });
    expect(editor.controller.project.documents).toHaveLength(2);
    expect(
      editor.controller.document.instances.some(
        (item) => item.reference === "XLEAF",
      ),
    ).toBe(true);
  });
  it("rejects a legacy Gallery drawing with broken Route label anchors atomically", async () => {
    const editor = await connected({
      projectHost: { fetch: galleryService({ legacy: otaProject() }) },
    });
    const before = serializeProject(editor.controller.project);
    expect(
      await editor.tool("gallery_circuits", {
        action: "insert",
        galleryEntryId: "legacy",
        targetDocumentId: "main",
        position: { x: 500, y: 300 },
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "GALLERY_INSERT_FAILED",
        message: expect.stringContaining(
          "references a Leg outside its copied Route",
        ),
      },
    });
    expect(serializeProject(editor.controller.project)).toBe(before);
  });
  it("normalizes flat and wrapped inputs identically through the shared MCP/CLI boundary", async () => {
    const editor = await connected({
      simulationService: profileService({ id: "test", engine: "ngspice" }),
    });
    const { executeOperation } =
      await import("../../../mcp-server/src/operations");
    const wrapped = await editor.tool("simulation_run", {
      request: { action: "capabilities" },
      requestId: "cap-wrapped",
      detail: "summary",
    });
    const flat = (await executeOperation(
      "simulation_run",
      { operation: "capabilities", requestId: "cap-flat", detail: "summary" },
      editor.session,
    )) as any;
    expect({ ...flat, requestId: wrapped.requestId }).toEqual(wrapped);
    expect(editor.http.simulationCalls.map((r) => r.requestId)).toEqual([
      "cap-wrapped",
      "cap-flat",
    ]);
    const listWrapped = await editor.tool("simulation_source", {
      request: { operation: "list" },
      requestId: "list-wrapped",
      refresh: true,
    });
    const listFlat = (await executeOperation(
      "simulation_source",
      { action: "list", requestId: "list-flat", refresh: true },
      editor.session,
    )) as any;
    expect({ ...listFlat, requestId: listWrapped.requestId }).toEqual(
      listWrapped,
    );
    expect(editor.http.fileCalls.map((r) => r.requestId)).toEqual([
      "list-wrapped",
      "list-flat",
    ]);
  });
  it("get_context returns the compact context of the editor's Document", async () => {
    const editor = await connected();
    await apply(editor, [
      place("resistor", "R1", 100),
      place("resistor", "R2", 300),
    ]);
    await apply(editor, [
      { kind: "connect", from: pin("R1", "2"), to: pin("R2", "1") },
    ]);
    const context = await editor.tool("get_context", {});
    const { controller } = editor;
    const { diagnostics } = await editor.client.refreshSnapshot();
    const count = (severity: string) =>
      diagnostics.filter((item) => item.severity === severity).length;
    // The two open pins are the editor's own findings.
    expect(count("warning")).toBeGreaterThan(0);
    expect(context).toMatchObject({
      projectId: controller.project.id,
      documentId: "main",
      documentName: controller.document.name,
      revision: controller.document.revision,
      instanceCount: 2,
      netCount: controller.document.nets.length,
      errors: count("error"),
      warnings: count("warning"),
      connection: "online",
    });
  });

  it("reads context, diagnostics and folder names through the editor's lightweight projections", async () => {
    const project = emptyAgentProject();
    const folder = createSimulationFolder({
      id: "small-op",
      name: "OP",
      profileId: "test",
      documentId: "main",
    });
    folder.input.files[0]!.text = "private-source-body";
    project.simulationFolders = [folder];
    const editor = await connected({ project });
    await apply(editor, [place("resistor", "R1", 100)]);
    const { tool, controller, http } = editor;
    expect(await tool("get_context", {})).toMatchObject({
      revision: controller.document.revision,
      instanceCount: 1,
    });
    const diagnostics = await tool("inspect", {
      target: { kind: "diagnostics" },
    });
    expect(diagnostics).toMatchObject({
      revision: controller.document.revision,
      counts: { total: diagnostics.items.length },
    });
    expect(diagnostics.counts.warnings).toBeGreaterThan(0);
    const folders = await tool("simulation_folder", { action: "list" });
    expect(folders).toMatchObject({
      ok: true,
      folders: [{ id: "small-op", name: "OP" }],
    });
    expect(JSON.stringify(folders)).not.toContain("private-source-body");
    expect(snapshotReads(http)).toEqual([
      "bootstrap",
      "state",
      "state",
      "folder-directory",
    ]);
    // The projection carries the same findings as a full Snapshot.
    expect(diagnostics.items).toEqual(
      (await editor.client.refreshSnapshot()).diagnostics,
    );
  });

  it("lists Cloud Projects through the editor's Project resource", async () => {
    const projects = [
      {
        id: "cloud-ota",
        name: "Reusable OTA",
        revision: 3,
        updatedAt: "2026-09-09T00:00:00.000Z",
        schemaVersion: 23,
      },
    ];
    const { tool, http } = await connected({
      // The Cloud Projects service's answer.
      projectHost: {
        listProjects: async () => ({ status: "listed", projects }),
      },
    });
    expect(await tool("project_cells", { action: "list-projects" })).toEqual({
      apiVersion: "3.0",
      requestId: expect.any(String),
      operation: "list-projects",
      ok: true,
      projects,
    });
    expect(http.projectCalls).toHaveLength(1);
  });

  it("reads the Gallery, Project Code and Netlist through the editor's Project resource", async () => {
    const entries = {
      g1: emptyAgentProject("Gallery RC"),
      g2: emptyAgentProject("Gallery RL"),
    };
    const { tool, http, controller } = await connected({
      project: otaProject(),
      projectHost: { fetch: galleryService(entries) },
    });
    expect(await tool("gallery_circuits", { action: "list" })).toMatchObject({
      ok: true,
      total: 2,
      entries: [
        { id: "g1", name: "Gallery RC" },
        { id: "g2", name: "Gallery RL" },
      ],
    });
    const many = await tool("gallery_circuits", {
      action: "read-many",
      galleryEntryIds: ["g1", "g2"],
    });
    expect(many).toMatchObject({
      ok: true,
      entries: [
        { entry: { id: "g1" }, netlist: { format: "spice" } },
        { entry: { id: "g2" }, netlist: { format: "spice" } },
      ],
      remainingEntryIds: [],
    });
    expect(parseProject(many.entries[1].projectCode).name).toBe("Gallery RL");
    const code = await tool("project_code", { action: "read" });
    expect(code).toMatchObject({
      ok: true,
      structureRevision: controller.project.structureRevision,
    });
    expect(
      parseProject(code.projectCode).documents.map((item) => item.id),
    ).toEqual(controller.project.documents.map((item) => item.id));
    expect(
      await tool("netlist_code", { action: "read", documentId: dutDocumentId }),
    ).toMatchObject({
      ok: true,
      netlist: {
        documentId: dutDocumentId,
        status: "ready",
        text: expect.stringContaining(`.subckt ${dutName}`),
      },
    });
    expect(http.projectCalls.map((request) => request.operation)).toEqual([
      "list-gallery",
      "read-gallery-entries",
      "read-project-code",
      "read-netlist",
    ]);
    expect(http.projectCalls.at(-1)).toMatchObject({
      operation: "read-netlist",
      documentId: dutDocumentId,
    });
  });

  it("a Gallery read with render returns the editor's figure as an image block", async () => {
    const drawn = emptyAgentProject("Telescopic op amp");
    drawn.documents[0]!.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const { call, http } = await connected({
      projectHost: { fetch: galleryService({ "296p9s5vn2": drawn }) },
    });
    const result = await call("gallery_circuits", {
      action: "read",
      galleryEntryId: "296p9s5vn2",
      render: "svg",
    });
    expect(http.projectCalls.at(-1)).toMatchObject({
      operation: "read-gallery-entry",
      render: "svg",
    });
    const [summary, image] = result.content as [
      { type: string; text: string },
      { type: string; data: string; mimeType: string },
    ];
    expect(image).toMatchObject({ type: "image", mimeType: "image/svg+xml" });
    const bytes = Buffer.from(image.data, "base64");
    expect(bytes.toString("utf8")).toContain('data-object-id="R1"');
    // The text keeps the entry and the figure's identity, not its bytes.
    expect(JSON.parse(summary.text)).toMatchObject({
      entry: { id: "296p9s5vn2", name: "Telescopic op amp" },
      figure: {
        documentId: "main",
        mediaType: "image/svg+xml",
        byteLength: bytes.byteLength,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(summary.text).not.toContain(image.data);
  });

  it("loads inspection state once, reuses it, and honors explicit refresh", async () => {
    const editor = await connected();
    await apply(editor, [
      place("nmos", "M1", 100, { parameters: { w: "4u", l: "1u" } }),
      place("resistor", "R1", 400),
    ]);
    await apply(editor, [
      { kind: "connect", from: pin("M1", "D"), to: pin("R1", "1") },
    ]);
    await apply(editor, [
      { kind: "add-label", target: pin("R1", "1"), text: "vout" },
    ]);
    const { tool, controller, http } = editor;
    const m1 = controller.document.instances.find(
      (item) => item.reference === "M1",
    )!;
    expect(
      await tool("inspect", { target: { kind: "object", name: "M1" } }),
    ).toMatchObject({
      id: m1.id,
      reference: "M1",
      symbolId: "nmos",
      parameters: { w: "4u", l: "1u" },
    });
    const vout = controller.document.nets.find((net) =>
      net.terminals.some(
        (terminal) => terminal.instanceId === m1.id && terminal.pinName === "D",
      ),
    )!;
    const hits = await tool("search", { query: "vout", limit: 5 });
    expect(hits.hits).toContainEqual(
      expect.objectContaining({ kind: "net", id: vout.id }),
    );
    expect(snapshotReads(http)).toEqual(["bootstrap", "full"]);
    await tool("inspect", { target: { kind: "document" }, refresh: true });
    expect(snapshotReads(http)).toEqual(["bootstrap", "full", "full"]);
  });

  it("inspects selected geometry without requesting a full Snapshot", async () => {
    const editor = await connected();
    await apply(editor, [place("resistor", "R1", 100)]);
    const r1 = editor.controller.document.instances[0]!;
    expect(
      await editor.tool("inspect", {
        target: { kind: "geometry", objectIds: [r1.id] },
      }),
    ).toMatchObject({
      projection: "geometry",
      revision: editor.controller.document.revision,
      objects: [{ kind: "instance", id: r1.id, placement: r1.placement }],
      missingObjectIds: [],
    });
    expect(snapshotReads(editor.http)).toEqual(["bootstrap", "geometry"]);
  });

  it("apply_actions returns the editor's refusal of a list that needs several calls, after one request", async () => {
    const editor = await connected();
    await apply(editor, [place("resistor", "R1", 100)]);
    const { call, controller, http } = editor;
    const before = structuredClone(controller.document);
    const sent = transacts(http);
    const result = await call("apply_actions", {
      actions: [
        place("capacitor", "C1", 300),
        {
          kind: "connect",
          from: pin("R1", "2"),
          to: { kind: "net", net: "Vout" },
        },
      ],
    });
    expect(result.isError).toBe(true);
    expect(parseText(result)).toEqual({
      ok: false,
      stage: "compile",
      code: "ACTION_BATCH_NOT_ATOMIC",
      message: expect.stringContaining(
        "actions[0] (place-component) as one placement batch; actions[1] (connect) as wires",
      ),
      revision: controller.document.revision,
      transactions: 2,
      calls: [
        {
          actionIndices: [0],
          actionKinds: ["place-component"],
          sends: "placement batch",
        },
        { actionIndices: [1], actionKinds: ["connect"], sends: "wires" },
      ],
    });
    // The one request was the editor's to refuse; nothing else was sent.
    expect(transacts(http)).toBe(sent + 1);
    expect(controller.document).toEqual(before);
  });

  it("allows advanced transactions without a resource-read ceremony", async () => {
    const editor = await connected();
    await apply(editor, [place("resistor", "R1", 100)]);
    const { tool, controller, http } = editor;
    const r1 = controller.document.instances[0]!;
    const revision = controller.document.revision;
    expect(
      await tool("advanced_transact", {
        edits: [
          {
            kind: "move_instance",
            instanceId: r1.id,
            position: { x: 300, y: 200 },
          },
        ],
      }),
    ).toMatchObject({ ok: true, revision: revision + 1 });
    expect(controller.document.instances[0]!.placement?.position).toEqual({
      x: 300,
      y: 200,
    });
    expect(http.projectCalls).toEqual([]);
    expect(http.fileCalls).toEqual([]);
  });

  it("verify refreshes and reports the objects a person changed", async () => {
    const editor = await connected();
    await apply(editor, [
      place("resistor", "R1", 100),
      place("resistor", "R2", 300),
    ]);
    const { tool, client, controller, http } = editor;
    const instance = (reference: string) =>
      controller.document.instances.find(
        (item) => item.reference === reference,
      )!;
    const [r1, r2] = [instance("R1"), instance("R2")];
    // The Agent has read the Document; then a person moves R2.
    await client.refreshSnapshot();
    personEdits(controller, [
      {
        kind: "move_instance",
        instanceId: r2.id,
        position: { x: 500, y: 300 },
      },
    ]);
    const value = await tool("verify", {});
    const { diagnostics } = client.cachedSnapshot()!;
    const count = (severity: string) =>
      diagnostics.filter((item) => item.severity === severity).length;
    expect(value).toMatchObject({
      revision: controller.document.revision,
      errors: count("error"),
      warnings: count("warning"),
    });
    expect(value.changedObjectIds).toContain(r2.id);
    expect(value.changedObjectIds).not.toContain(r1.id);
    // No expected netlist, so no export was read.
    expect(http.projectCalls).toHaveLength(0);
  });

  it("render returns the editor's SVG as an image block plus a compact summary", async () => {
    const editor = await connected();
    await apply(editor, [place("resistor", "R1", 100)]);
    const result = await editor.call("render", { mode: "formal" });
    expect(result.content).toHaveLength(2);
    const [summary, image] = result.content as [
      { type: string; text: string },
      { type: string; data: string; mimeType: string },
    ];
    expect(image).toMatchObject({ type: "image", mimeType: "image/svg+xml" });
    const bytes = Buffer.from(image.data, "base64");
    const svg = bytes.toString("utf8");
    expect(svg).toMatch(/^<svg/u);
    expect(svg).toContain(
      `data-object-id="${editor.controller.document.instances[0]!.id}"`,
    );
    expect(JSON.parse(summary.text)).toEqual({
      revision: editor.controller.document.revision,
      mode: "formal",
      byteLength: bytes.byteLength,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      diagnostics: expect.any(Number),
    });
  });

  it.each(["ngspice", "vacask"] as const)(
    "creates a %s template for a Cell of the live Project from the selected Profile",
    async (engine) => {
      const editor = await connected({
        project: otaProject(),
        simulationService: profileService({ id: "selected", engine }),
      });
      const { tool, controller, http } = editor;
      const structureRevision = controller.project.structureRevision;
      const created = await tool("simulation_folder", {
        action: "create",
        name: "Bias",
        profileId: "selected",
        rootDocumentId: dutDocumentId,
        dut: { name: dutName, ports: dutPorts },
      });
      expect(created).toMatchObject({
        ok: true,
        dut: {
          name: dutName,
          ports: dutPorts,
          subckt: expect.stringContaining(`.subckt ${dutName}`),
        },
      });
      // The receipt is about the folder, not the open drawing (#1231).
      expect(Object.keys(created)[0]).toBe("folder");
      expect(created).not.toHaveProperty("diagnostics");
      expect(created).not.toHaveProperty("diagnosticDelta");
      expect(snapshotReads(http)).toEqual(["bootstrap", "full"]);
      expect(controller.project.structureRevision).toBe(structureRevision + 1);
      const folder = controller.project.simulationFolders.find(
        (item) => item.id === created.folder.id,
      )!;
      expect(folder).toMatchObject({
        name: "Bias",
        input: {
          circuitBindings: [
            { documentId: dutDocumentId, emission: "subcircuit" },
          ],
        },
      });
      expect(folder.input.files).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: "run.cir",
            text: expect.stringContaining(
              engine === "ngspice" ? ".control\n" : "\ncontrol\n",
            ),
          }),
          expect.objectContaining({
            path: "testbench.spice",
            text: expect.stringContaining(
              engine === "ngspice"
                ? `XDUT ${dutPorts.join(" ")} ${dutName}`
                : `XDUT (${dutPorts.map((port) => `'${port}'`).join(" ")}) '${dutName}'`,
            ),
          }),
        ]),
      );
      const after = structuredClone(controller.project);
      expect(
        await tool("simulation_folder", {
          action: "create",
          name: "Unknown",
          profileId: "unknown",
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "SIMULATION_PROFILE_UNAVAILABLE" },
      });
      expect(controller.project).toEqual(after);
    },
  );

  it("creates a folder on the Profile qualified for its Cell's devices when none is named (#1349)", async () => {
    // The SIN testbench also holds a varactor no Profile qualifies.
    const project = otaProject();
    project.documents
      .find((document) => document.id === "document-ota-5t-testbench-sin")!
      .instances.push({
        id: "varactor",
        reference: "C9",
        symbolId: "capacitor",
        placement: null,
        netlist: {
          binding: {
            kind: "model",
            deviceClass: "capacitor",
            name: "sky130_fd_pr__cap_var_lvt",
          },
          parameters: {},
        },
      });
    // As Production advertises them: ngspice names the SKY130 devices it
    // qualifies, VACASK names none.
    const { tool, controller } = await connected({
      project,
      simulationService: profileService(
        { id: "vacask", engine: "vacask" },
        {
          id: "sky130",
          engine: "ngspice",
          devices: ["sky130_fd_pr__nfet_01v8", "sky130_fd_pr__pfet_01v8"],
        },
      ),
    });
    const created = await tool("simulation_folder", {
      action: "create",
      name: "Bias",
      rootDocumentId: dutDocumentId,
    });
    expect(created).toMatchObject({
      ok: true,
      folder: { name: "Bias", profileId: "sky130", engine: "ngspice" },
    });
    const folder = controller.project.simulationFolders.find(
      (item) => item.id === created.folder.id,
    )!;
    const config = readSimulationExperimentConfig(folder);
    expect(config.ok && config.config.environment.profileId).toBe("sky130");
    const before = structuredClone(controller.project);
    expect(
      await tool("simulation_folder", {
        action: "create",
        name: "SIN",
        rootDocumentId: "document-ota-5t-testbench-sin",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        code: "SIMULATION_PROFILE_REQUIRED",
        candidates: ["vacask", "sky130"],
      },
    });
    expect(controller.project).toEqual(before);
  });

  it("manages source experiments without replacing authored bytes during rename/clone", async () => {
    const project = otaProject();
    const authored = createSimulationFolder({
      id: "s",
      name: "OP",
      profileId: "test",
      documentId: dutDocumentId,
    });
    authored.input.files[0]!.text =
      "* custom 🧪\r\n.control\r\nrepeat 2\r\nop\r\nend\r\n.endc\r\n.end";
    project.simulationFolders.push(structuredClone(authored));
    const editor = await connected({
      project,
      simulationService: profileService({ id: "test", engine: "vacask" }),
    });
    const { tool, controller } = editor;
    const folder = (id: string) =>
      controller.project.simulationFolders.find((item) => item.id === id);
    expect(
      await tool("simulation_folder", {
        action: "update",
        folderId: "s",
        name: "Bias",
      }),
    ).toMatchObject({ ok: true });
    expect(folder("s")).toEqual({ ...authored, name: "Bias" });
    expect(
      await tool("simulation_folder", {
        action: "clone",
        folderId: "s",
        newFolderId: "copy",
        name: "AC",
      }),
    ).toMatchObject({
      ok: true,
      folder: { id: "copy", name: "AC", entry: authored.input.entry },
    });
    expect(folder("copy")).toEqual({ ...authored, id: "copy", name: "AC" });
    expect(
      await tool("simulation_folder", {
        action: "create",
        folderId: "text",
        name: "Native",
        profileId: "test",
      }),
    ).toMatchObject({ ok: true });
    expect(folder("text")).toMatchObject({
      version: 4,
      input: {
        kind: "source",
        circuitBindings: [],
        files: expect.arrayContaining([
          expect.objectContaining({
            path: "run.cir",
            text: expect.stringContaining("analysis op op"),
          }),
        ]),
      },
    });
    const unchanged = async (args: Record<string, unknown>, error: object) => {
      const before = structuredClone(controller.project);
      expect(await tool("simulation_folder", args)).toMatchObject({
        ok: false,
        error,
      });
      expect(controller.project).toEqual(before);
    };
    await unchanged(
      {
        action: "create",
        folderId: "bad-dut",
        name: "Bad DUT",
        profileId: "test",
        rootDocumentId: dutDocumentId,
        dut: { name: dutName, ports: ["in\ncontrol"] },
      },
      { code: "SIMULATION_HELPER_INPUT_INVALID", recovery: "fix-input" },
    );
    expect(
      await tool("simulation_folder", {
        action: "create",
        folderId: "dut-text",
        name: "DUT text",
        profileId: "test",
        rootDocumentId: dutDocumentId,
        dut: { name: dutName, ports: dutPorts },
      }),
    ).toMatchObject({ ok: true });
    expect(folder("dut-text")).toMatchObject({
      input: {
        circuitBindings: [
          { documentId: dutDocumentId, emission: "subcircuit" },
        ],
        files: expect.arrayContaining([
          expect.objectContaining({
            path: "testbench.spice",
            text: expect.stringContaining(
              `XDUT (${dutPorts.map((port) => `'${port}'`).join(" ")}) '${dutName}'`,
            ),
          }),
        ]),
      },
    });
    // Issue #1259: the Cell's own port names in another order would wire
    // the testbench to the wrong pins by position.
    await unchanged(
      {
        action: "create",
        folderId: "dut-swapped",
        name: "DUT swapped",
        profileId: "test",
        rootDocumentId: dutDocumentId,
        dut: {
          name: dutName,
          ports: [dutPorts[1]!, dutPorts[0]!, ...dutPorts.slice(2)],
        },
      },
      {
        code: "SIMULATION_DUT_PORT_ORDER_MISMATCH",
        message: expect.stringContaining(
          `${dutPorts[1]} is at position 1, the Cell's 2`,
        ),
      },
    );
    // Names that are not the Cell's ports are the testbench's own nodes.
    const aliases = ["vdd_tb", ...dutPorts.slice(1)];
    expect(
      await tool("simulation_folder", {
        action: "create",
        folderId: "dut-alias",
        name: "DUT alias",
        profileId: "test",
        rootDocumentId: dutDocumentId,
        dut: { name: dutName, ports: aliases },
      }),
    ).toMatchObject({ ok: true, dut: { ports: aliases } });
    expect(folder("dut-alias")).toBeDefined();
    await unchanged(
      { action: "update", folderId: "s" },
      { code: "SIMULATION_FOLDER_UPDATE_EMPTY" },
    );
  });

  it("keeps legacy JSON helpers off a native experiment and edits a v1 one in place", async () => {
    const project = emptyAgentProject();
    const native = createSimulationFolder({
      id: "s",
      name: "Program",
      profileId: "test",
      documentId: "main",
    });
    // The retained v1 compatibility lane.
    const legacy = createSimulationFolder({
      id: "legacy",
      name: "Legacy",
      profileId: "test",
      documentId: "main",
    });
    legacy.input.files.find((file) => file.path === "experiment.json")!.text =
      JSON.stringify({ version: 1, environment: { profileId: "test" } });
    project.simulationFolders = structuredClone([native, legacy]);
    const editor = await connected({ project });
    await apply(editor, [place("nmos", "M1", 100)]);
    const { tool, controller } = editor;
    const folder = (id: string) =>
      controller.project.simulationFolders.find((item) => item.id === id)!;
    for (const name of [
      "simulation_output",
      "simulation_measurement",
      "simulation_device_operating_point",
    ])
      expect(await tool(name, { action: "list", folderId: "s" })).toMatchObject(
        {
          ok: false,
          error: { code: "SIMULATION_NATIVE_CODE_REQUIRED" },
        },
      );
    expect(
      await tool("simulation_output", {
        action: "upsert",
        folderId: "s",
        label: "Vout",
        expression: { kind: "vector", vector: "v(out)" },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_NATIVE_CODE_REQUIRED" },
    });
    expect(folder("s")).toEqual(native);
    expect(
      await tool("simulation_output", {
        action: "upsert",
        folderId: "legacy",
        outputId: "gain",
        label: "Gain",
        expression: {
          kind: "db20",
          operand: { kind: "vector", vector: "v(out)" },
        },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await tool("simulation_measurement", {
        action: "upsert",
        folderId: "legacy",
        measurementId: "gain-at-1k",
        label: "Gain at 1 kHz",
        analysis: "ac",
        outputId: "gain",
        method: { kind: "sample-at", coordinate: 1000 },
      }),
    ).toMatchObject({ ok: true });
    expect(
      await tool("simulation_device_operating_point", {
        action: "upsert",
        folderId: "legacy",
        deviceOperatingPointId: "m1",
        targetDocumentId: "main",
        instanceId: controller.document.instances[0]!.id,
        occurrence: [],
        circuit: { bindingId: "circuit", callPath: [] },
      }),
    ).toMatchObject({ ok: true });
    const config = readSimulationExperimentConfig(folder("legacy"));
    if (!config.ok) throw new Error(config.message);
    expect(config.config).toMatchObject({
      outputs: [{ id: "gain" }],
      measurements: [{ id: "gain-at-1k" }],
      deviceOperatingPoints: [
        { id: "m1", circuit: { bindingId: "circuit", callPath: [] } },
      ],
    });
    const runFile = (item: CircuitProject["simulationFolders"][number]) =>
      item.input.files.find((file) => file.path === "run.cir")!.text;
    expect(runFile(folder("legacy"))).toBe(runFile(legacy));
    expect(folder("legacy").input).not.toHaveProperty("analyses");
    expect(folder("s")).toEqual(native);
  });

  it("returns recoverable errors for a broken configuration and lets the same session repair it", async () => {
    const project = emptyAgentProject();
    const broken = createSimulationFolder({
      id: "s",
      name: "Draft",
      profileId: "test",
    });
    broken.input.files.find(
      (file) => file.path === broken.input.configPath,
    )!.text = "{";
    project.simulationFolders = [broken];
    const { tool, controller } = await connected({ project });
    expect(
      await tool("simulation_output", { action: "list", folderId: "s" }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_CONFIG_INVALID", recovery: "fix-input" },
    });
    expect(
      await tool("simulation_folder", { action: "get", folderId: "s" }),
    ).toMatchObject({
      ok: true,
      folder: {
        input: {
          files: expect.arrayContaining([
            { path: "experiment.json", text: "{" },
          ]),
        },
      },
    });
    const repaired = createSimulationFolder({
      id: "s",
      name: "Repaired",
      profileId: "test",
    }).input;
    expect(
      await tool("simulation_folder", {
        action: "update",
        folderId: "s",
        input: repaired,
      }),
    ).toMatchObject({ ok: true });
    expect(controller.project.simulationFolders[0]!.input).toEqual(repaired);
    expect(
      await tool("simulation_output", { action: "list", folderId: "s" }),
    ).toMatchObject({
      ok: false,
      error: { code: "SIMULATION_NATIVE_CODE_REQUIRED" },
    });
  });
});

describe("expected-netlist verification against the live editor's export", () => {
  it("uses one read-only export of the editor's Cell, hides detail by default and never stages", async () => {
    const editor = await connected();
    await apply(editor, [
      place("port", "I", 100),
      place("resistor", "R1", 200, {
        rotation: 270,
        parameters: { value: "1u" },
      }),
      place("port", "O", 400, { rotation: 180 }),
    ]);
    await apply(editor, [
      { kind: "connect", from: cellPin(editor, "I"), to: pin("R1", "1") },
      { kind: "connect", from: pin("R1", "2"), to: cellPin(editor, "O") },
    ]);
    const { client, controller, http } = editor;
    expect(
      (await editor.tool("netlist_code", { action: "read" })).netlist.text,
    ).toMatch(/^R1 I O 1u$/mu);
    const before = structuredClone(controller.project);
    const reads = http.projectCalls.length;
    const reference = (value: string) =>
      `.subckt a I O\nR1 I O ${value}\n.ends a`;
    const equal = await compareExpectedNetlist(client, "main", {
      text: reference("1000n"),
    });
    expect(equal).toMatchObject({
      status: "equal",
      structureRevision: controller.project.structureRevision,
    });
    expect(equal).not.toHaveProperty("differences");
    expect(http.projectCalls.slice(reads)).toEqual([
      expect.objectContaining({
        operation: "read-netlist",
        rootDocumentId: "main",
      }),
    ]);
    expect(
      await compareExpectedNetlist(
        client,
        "main",
        { text: reference("1.001u") },
        true,
      ),
    ).toMatchObject({
      status: "different",
      counts: { parameter: 1, connection: 0 },
      differences: [
        expect.objectContaining({
          kind: "parameter",
          actual: "1u",
          expected: "1.001u",
        }),
      ],
    });
    const bad = await compareExpectedNetlist(client, "main", {
      text: ".subckt nope A B\n.invalid opaque\n.ends nope",
    });
    expect(bad.status).toBe("inconclusive");
    // One read-only export per comparison; nothing staged or changed.
    expect(http.projectCalls).toHaveLength(reads + 3);
    expect(http.fileCalls).toEqual([]);
    expect(controller.project).toEqual(before);
  });

  it("says first whether the wiring matches the editor's export, and skips the checks asked to be skipped", async () => {
    // A SKY130 Project, as the editor places parts in one.
    const preferences = createDefaultNetlistExportPreferences();
    const editor = await connected({
      planning: {
        processModelTarget: (project, symbolId) =>
          placementModelTarget(project, preferences, symbolId),
        processFill: (project, documentId, edits) =>
          placementProcessFill(project, preferences, documentId, edits),
      },
    });
    await apply(editor, [
      ...["OUT", "IN", "VSS"].map((name, i) => ({
        kind: "place-component",
        symbol: "port",
        reference: name,
        position: { x: 100, y: 100 + i * 200 },
      })),
      {
        kind: "place-component",
        symbol: "nmos",
        reference: "M1",
        position: { x: 500, y: 300 },
      },
    ]);
    const m1 = (name: string) => pin("M1", name);
    await apply(editor, [
      { kind: "connect", from: m1("D"), to: cellPin(editor, "OUT") },
      { kind: "connect", from: m1("G"), to: cellPin(editor, "IN") },
      { kind: "connect", from: m1("S"), to: cellPin(editor, "VSS") },
      { kind: "connect", from: m1("B"), to: m1("S") },
    ]);
    // The editor exports the transistor as its reviewed subcircuit.
    expect(
      (await editor.tool("netlist_code", { action: "read" })).netlist.text,
    ).toMatch(/^XM1 OUT IN VSS VSS sky130_fd_pr__nfet_01v8 l=0\.15 w=1\b/mu);
    // The Gallery's netlist binds the same transistor to the model by name,
    // in its own port order.
    const text =
      ".subckt pair IN OUT VSS\nM1 OUT IN VSS VSS sky130_fd_pr__nfet_01v8 l=150n w=1u\n.ends pair";
    const result = await compareExpectedNetlist(editor.client, "main", {
      text,
    });
    expect(Object.keys(result).slice(0, 3)).toEqual([
      "summary",
      "status",
      "topology",
    ]);
    expect(result).toMatchObject({
      summary: "topology equal; 1 port-order, 1 binding-style differences",
      status: "different",
      topology: "equal",
      counts: { "port-order": 1, binding: 1, device: 0, connection: 0 },
    });
    expect(
      await compareExpectedNetlist(editor.client, "main", {
        text,
        compare: { portOrder: false, bindings: false },
      }),
    ).toMatchObject({ summary: "equal", status: "equal" });
  });
});
