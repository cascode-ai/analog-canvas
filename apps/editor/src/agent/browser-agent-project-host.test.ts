import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import { AGENT_API_VERSION } from "@icm/agent-adapter";
import { executeProjectTransaction } from "@icm/edit-engine";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { parseProject, serializeProject } from "@icm/project-protocol";

import {
  editorFetchAs,
  environment,
  makerOf,
  rejectOne,
  seatOf,
  signIn,
  submitOne,
  testbenchProjectText,
} from "../../../../worker/gallery.test-support";
import { BrowserAgentProjectHost } from "./browser-agent-project-host";

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

describe("BrowserAgentProjectHost", () => {
  it("reports deferred feature failures without blaming deployments, committing or disabling other resources", async () => {
    const project = createEmptyProject("destination", "Before");
    const cause = new TypeError("injected import failure");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const commit = vi.fn();
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => project,
      getActiveDocumentId: () => project.topDocumentId,
      commitProjectStructure: commit,
      dispatchProjectTransaction: vi.fn(),
      loadProjectCode: async () => {
        throw cause;
      },
    });
    try {
      expect(
        await host.handle({
          apiVersion: AGENT_API_VERSION,
          requestId: "bad-load",
          operation: "read-project-code",
        }),
      ).toMatchObject({
        ok: false,
        error: { code: "PROJECT_FEATURE_LOAD_FAILED", recovery: "refresh" },
      });
      expect(commit).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.any(String), cause);
      expect(
        await host.handle({
          apiVersion: AGENT_API_VERSION,
          requestId: "other-resource",
          operation: "read-netlist",
        }),
      ).toMatchObject({ ok: true, operation: "read-netlist" });
    } finally {
      log.mockRestore();
    }
  });
  it.each(["session", "revision"])(
    "rechecks %s after loading the Project Code planner",
    async (change) => {
      const project = createEmptyProject("destination", "Before");
      let session = "original";
      const host = new BrowserAgentProjectHost({
        getProjectSessionId: () => session,
        getProject: () => project,
        getActiveDocumentId: () => project.topDocumentId,
        commitProjectStructure: () => {
          throw new Error("must not commit");
        },
        dispatchProjectTransaction: () => {
          throw new Error("must not dispatch");
        },
      });
      const request = host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "deferred-replace",
        operation: "replace-project-code",
        projectCode: serializeProject({ ...project, name: "After" }),
        expectedStructureRevision: project.structureRevision,
      });
      if (change === "session") session = "replacement";
      else project.structureRevision++;
      await expect(request).resolves.toMatchObject({
        ok: false,
        error: {
          code:
            change === "session"
              ? "PROJECT_REPLACED"
              : "STALE_STRUCTURE_REVISION",
        },
      });
      expect(project.name).toBe("Before");
    },
  );
  it("lists Cloud Cells and imports through one canonical Project transaction", async () => {
    let destination = createEmptyProject("destination", "Destination");
    const source = createEmptyProject("source", "Reusable OTA", "ota");
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
      getActiveDocumentId: () => destination.topDocumentId,
      commitProjectStructure: (project) => {
        destination = project;
      },
      listProjects: async () => ({
        status: "listed",
        projects: [
          {
            id: "cloud-source",
            name: source.name,
            revision: 3,
            updatedAt: "2026-09-09T00:00:00.000Z",
            schemaVersion: 23,
          },
        ],
      }),
      loadProject: async () => ({ ok: true, project: source }),
      dispatchProjectTransaction: (request) => {
        const result = executeProjectTransaction(destination, request);
        if (result.ok && result.applied) destination = result.project;
        return result;
      },
    });

    const cells = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "cells",
      operation: "list-cells",
      cloudProjectId: "cloud-source",
    });
    expect(cells).toMatchObject({
      ok: true,
      cells: [
        {
          documentId: "ota",
          formalPorts: [],
        },
      ],
    });

    const imported = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "import",
      operation: "import-cell",
      cloudProjectId: "cloud-source",
      sourceDocumentId: "ota",
      expectedStructureRevision: destination.structureRevision,
    });
    expect(imported).toMatchObject({ ok: true, status: "imported" });
    expect(destination.documents).toHaveLength(2);
  });

  it("returns a recoverable stale revision before dispatch", async () => {
    const destination: CircuitProject = createEmptyProject("destination", "D");
    const source = createEmptyProject("source", "S");
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
      getActiveDocumentId: () => destination.topDocumentId,
      commitProjectStructure: () => {
        throw new Error("must not commit");
      },
      loadProject: async () => ({ ok: true, project: source }),
      dispatchProjectTransaction: () => {
        throw new Error("must not dispatch");
      },
    });
    const response = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "stale",
      operation: "import-cell",
      cloudProjectId: "cloud-source",
      sourceDocumentId: source.topDocumentId,
      expectedStructureRevision: destination.structureRevision + 1,
    });
    expect(response).toMatchObject({
      ok: false,
      error: { code: "STALE_STRUCTURE_REVISION", recovery: "refresh" },
    });
  });

  it("pages the public Gallery and reads complete Project Code with a generated netlist", async () => {
    const destination = createEmptyProject("destination", "Destination");
    const galleryProject = createEmptyProject("gallery-project", "Gallery OTA");
    const fetchImpl = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/gallery?")) {
        return Response.json({
          entries: [
            {
              id: "entry-1",
              name: "Gallery OTA",
              author: "Magic Li",
              description: "Five-transistor OTA",
              createdAt: "2026-09-20T00:00:00.000Z",
              schemaVersion: galleryProject.schemaVersion,
              tags: ["ota"],
              netlistable: true,
              aiGenerated: true,
            },
          ],
          nextCursor: "next-page",
          total: 520,
        });
      }
      if (url === "/api/gallery/entry-1") {
        return Response.json({
          entry: {
            id: "entry-1",
            name: "Gallery OTA",
            author: "Magic Li",
            description: "Five-transistor OTA",
            createdAt: "2026-09-20T00:00:00.000Z",
            schemaVersion: galleryProject.schemaVersion,
            tags: ["ota"],
          },
          projectText: serializeProject(galleryProject),
        });
      }
      return new Response(null, { status: 404 });
    };
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
      getActiveDocumentId: () => destination.topDocumentId,
      commitProjectStructure: () => undefined,
      dispatchProjectTransaction: () => {
        throw new Error("must not dispatch");
      },
      fetch: fetchImpl as typeof fetch,
    });

    await expect(
      host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "gallery-list",
        operation: "list-gallery",
        limit: 2,
      }),
    ).resolves.toMatchObject({
      ok: true,
      // The saved AI mark is stated, read only (#1439).
      entries: [
        { id: "entry-1", author: "Magic Li", tags: ["ota"], aiGenerated: true },
      ],
      nextCursor: "next-page",
      total: 520,
    });
    await expect(
      host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "gallery-read",
        operation: "read-gallery-entry",
        galleryEntryId: "entry-1",
        netlistFormat: "spectre",
      }),
    ).resolves.toMatchObject({
      ok: true,
      // An entry the Gallery does not mark says so too.
      entry: { id: "entry-1", aiGenerated: false },
      projectCode: expect.stringContaining('"name": "Gallery OTA"'),
      netlist: { format: "spectre", status: "ready" },
    });
    await expect(
      host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "gallery-batch",
        operation: "read-gallery-entries",
        galleryEntryIds: ["entry-1"],
        netlistFormat: null,
      }),
    ).resolves.toMatchObject({
      ok: true,
      entries: [
        {
          entry: { id: "entry-1" },
          projectCode: expect.stringContaining('"name": "Gallery OTA"'),
          netlist: null,
        },
      ],
      remainingEntryIds: [],
    });
  });

  it("draws a Gallery entry's top Cell with the file exporter when asked", async () => {
    const destination = createEmptyProject("destination", "Destination");
    const galleryProject = createEmptyProject("gallery-project", "Gallery RC");
    galleryProject.documents[0]!.instances.push({
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
      getActiveDocumentId: () => destination.topDocumentId,
      commitProjectStructure: () => undefined,
      dispatchProjectTransaction: () => {
        throw new Error("must not dispatch");
      },
      fetch: (async () =>
        Response.json({
          entry: { id: "entry-1", name: "Gallery RC" },
          projectText: serializeProject(galleryProject),
        })) as unknown as typeof fetch,
    });
    const read = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "gallery-figure",
      operation: "read-gallery-entry",
      galleryEntryId: "entry-1",
      netlistFormat: null,
      render: "svg",
    });
    if (!read.ok || read.operation !== "read-gallery-entry" || !read.figure)
      throw new Error(JSON.stringify(read));
    expect(read.figure).toMatchObject({
      documentId: galleryProject.topDocumentId,
      mediaType: "image/svg+xml",
      encoding: "base64",
    });
    const bytes = Buffer.from(read.figure.data, "base64");
    expect(read.figure.byteLength).toBe(bytes.byteLength);
    expect(read.figure.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    const svg = bytes.toString("utf8");
    expect(svg).toMatch(/^<svg/u);
    expect(svg).toContain('data-object-id="R1"');
    // Without render, a read carries no figure.
    const plain = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "gallery-plain",
      operation: "read-gallery-entry",
      galleryEntryId: "entry-1",
      netlistFormat: null,
    });
    expect(plain).not.toHaveProperty("figure");
  });

  it("says when the account has opened its daily share of Gallery circuits", async () => {
    const destination = createEmptyProject("destination", "Destination");
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
      getActiveDocumentId: () => destination.topDocumentId,
      commitProjectStructure: () => undefined,
      dispatchProjectTransaction: () => {
        throw new Error("must not dispatch");
      },
      fetch: (async () =>
        Response.json(
          {
            error: "daily-open-limit",
            limit: 100,
            resetAt: "2026-10-08T00:00:00.000Z",
          },
          { status: 429 },
        )) as unknown as typeof fetch,
    });
    await expect(
      host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "gallery-limited",
        operation: "read-gallery-entry",
        galleryEntryId: "entry-1",
        netlistFormat: null,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: "GALLERY_DAILY_LIMIT",
        message: expect.stringMatching(
          /^You have opened 100 Gallery circuits today; more open at /u,
        ),
        recovery: "retry",
      },
    });
  });

  it("lists every AI account's circuits, rejected ones with their reasons, to an AI account only (#1540)", async () => {
    const env = environment();
    const sol = await seatOf(env, 2);
    const claude = await seatOf(env, 0);
    const kept = await submitOne(env, "Kept", { cookie: sol });
    const redo = await submitOne(env, "Redo", { cookie: sol });
    env.gallerySql.exec(
      "UPDATE gallery_entries SET created_at = ? WHERE id = ?",
      "2026-10-01T00:00:00.000Z",
      kept,
    );
    await rejectOne(env, redo, "Loose wires.");
    const destination = createEmptyProject("destination", "Destination");
    const list = (
      cookie: string,
      fields: Partial<{
        scope: "ai-seats";
        status: "rejected";
        limit: number;
        cursor: string;
      }>,
    ) =>
      new BrowserAgentProjectHost({
        getProjectSessionId: () => "session",
        getProject: () => destination,
        getActiveDocumentId: () => destination.topDocumentId,
        commitProjectStructure: () => undefined,
        dispatchProjectTransaction: () => {
          throw new Error("must not dispatch");
        },
        fetch: editorFetchAs(env, cookie),
      }).handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "ai-list",
        operation: "list-gallery",
        ...fields,
      });

    await expect(
      list(claude, { scope: "ai-seats", status: "rejected" }),
    ).resolves.toMatchObject({
      ok: true,
      entries: [
        {
          id: redo,
          author: "GPT-6.1 Sol",
          aiGenerated: true,
          status: "rejected",
          rejectReason: "Loose wires.",
        },
      ],
      nextCursor: null,
      total: 1,
    });
    // One list, newest first, paged by the cursor.
    await expect(
      list(claude, { scope: "ai-seats", limit: 1 }),
    ).resolves.toMatchObject({
      entries: [{ id: redo }],
      nextCursor: "1",
      total: 2,
    });
    const rest = await list(claude, {
      scope: "ai-seats",
      limit: 1,
      cursor: "1",
    });
    expect(rest).toMatchObject({
      entries: [{ id: kept, status: "public" }],
      nextCursor: null,
    });
    if (!rest.ok || rest.operation !== "list-gallery")
      throw new Error(JSON.stringify(rest));
    expect(rest.entries[0]).not.toHaveProperty("rejectReason");
    // A person's Editor is refused, and status narrows the scope only.
    await expect(
      list(await makerOf(env), { scope: "ai-seats" }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "AI_ACCOUNT_REQUIRED", recovery: "fix-input" },
    });
    await expect(list(claude, { status: "rejected" })).resolves.toMatchObject({
      ok: false,
      error: { code: "GALLERY_STATUS_NEEDS_SCOPE", recovery: "fix-input" },
    });
  });

  it("reads and inserts someone else's circuit without its testbench, and its author's own with it (#1545)", async () => {
    const env = environment();
    const author = await makerOf(env);
    const id = await submitOne(env, "Amplifier", {
      cookie: author,
      text: testbenchProjectText("Amplifier"),
    });
    const readAndInsert = async (cookie: string) => {
      let destination = createEmptyProject("destination", "Destination");
      const host = new BrowserAgentProjectHost({
        getProjectSessionId: () => "session",
        getProject: () => destination,
        getActiveDocumentId: () => destination.topDocumentId,
        commitProjectStructure: (project) => {
          destination = project;
        },
        dispatchProjectTransaction: () => {
          throw new Error("must not dispatch");
        },
        fetch: editorFetchAs(env, cookie),
      });
      const read = await host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "read",
        operation: "read-gallery-entry",
        galleryEntryId: id,
        netlistFormat: null,
      });
      if (!read.ok || read.operation !== "read-gallery-entry")
        throw new Error(JSON.stringify(read));
      const target = destination.documents[0]!;
      await expect(
        host.handle({
          apiVersion: AGENT_API_VERSION,
          requestId: "insert",
          operation: "insert-gallery-entry",
          galleryEntryId: id,
          targetDocumentId: target.id,
          position: { x: 0, y: 0 },
          expectedRevision: target.revision,
          expectedStructureRevision: destination.structureRevision,
        }),
      ).resolves.toMatchObject({ ok: true });
      return {
        read: parseProject(read.projectCode).simulationFolders.length,
        inserted: destination.simulationFolders.length,
      };
    };
    expect(
      await readAndInsert(await signIn(env.authDurable, "someone@example.com")),
    ).toEqual({ read: 0, inserted: 0 });
    expect(await readAndInsert(author)).toEqual({ read: 1, inserted: 1 });
  });

  it("reads and atomically replaces complete Project Code with revision protection", async () => {
    let destination = createEmptyProject("destination", "Before");
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
      getActiveDocumentId: () => destination.topDocumentId,
      commitProjectStructure: (project) => {
        destination = project;
      },
      dispatchProjectTransaction: () => {
        throw new Error("must not dispatch");
      },
    });
    const read = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "project-read",
      operation: "read-project-code",
    });
    expect(read).toMatchObject({
      ok: true,
      structureRevision: destination.structureRevision,
    });
    if (!read.ok || read.operation !== "read-project-code") {
      throw new Error("unexpected read result");
    }
    const authored = JSON.parse(read.projectCode) as Record<string, unknown>;
    authored.name = "After";
    const replaced = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "project-replace",
      operation: "replace-project-code",
      projectCode: JSON.stringify(authored),
      expectedStructureRevision: read.structureRevision,
    });
    expect(replaced).toMatchObject({
      ok: true,
      applied: true,
      structureRevision: read.structureRevision + 1,
    });
    expect(destination.name).toBe("After");

    await expect(
      host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "project-stale",
        operation: "replace-project-code",
        projectCode: JSON.stringify(authored),
        expectedStructureRevision: read.structureRevision,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: "STALE_STRUCTURE_REVISION", recovery: "refresh" },
    });
  });

  it("reads the live netlist and accepts an unchanged replacement without a commit", async () => {
    const destination = createEmptyProject("destination", "Netlist Project");
    const document = destination.documents[0]!;
    document.instances.push({
      id: "port-vb1",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "net-vb1",
      terminals: [{ instanceId: "port-vb1", pinName: "P" }],
    });
    document.netlist!.terminals.push({
      id: "terminal-vb1",
      name: "Vb1",
      netId: "net-vb1",
      direction: "input",
      interfaceInstanceIds: ["port-vb1"],
    });
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
      getActiveDocumentId: () => destination.topDocumentId,
      commitProjectStructure: () => undefined,
      dispatchProjectTransaction: () => {
        throw new Error("must not dispatch");
      },
    });
    const read = await host.handle({
      apiVersion: AGENT_API_VERSION,
      requestId: "netlist-read",
      operation: "read-netlist",
      documentId: document.id,
      format: "spice",
    });
    expect(read).toMatchObject({
      ok: true,
      netlist: { documentId: document.id, format: "spice", status: "ready" },
    });
    if (
      !read.ok ||
      read.operation !== "read-netlist" ||
      read.netlist.text === null
    ) {
      throw new Error("unexpected netlist result");
    }
    expect(read.netlist.text).toContain(".subckt dut Vb1");
    expect(read.cells).toEqual([
      expect.objectContaining({
        documentId: document.id,
        status: "ready",
        text: expect.stringContaining(".subckt dut Vb1"),
      }),
    ]);
    await expect(
      host.handle({
        apiVersion: AGENT_API_VERSION,
        requestId: "netlist-replace",
        operation: "replace-netlist",
        netlist: read.netlist.text,
        expectedStructureRevision: read.structureRevision,
        format: "spice",
      }),
    ).resolves.toMatchObject({ ok: true, applied: false });
  });
});
