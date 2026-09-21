import { describe, expect, it } from "vitest";

import { AGENT_API_VERSION } from "@icm/agent-adapter";
import { executeProjectTransaction } from "@icm/edit-engine";
import { createEmptyProject, type CircuitProject } from "@icm/model";
import { serializeProject } from "@icm/project-protocol";

import { BrowserAgentProjectHost } from "./browser-agent-project-host";

describe("BrowserAgentProjectHost", () => {
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
      entries: [{ id: "entry-1", author: "Magic Li", tags: ["ota"] }],
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
      format: "spice",
    });
    expect(read).toMatchObject({
      ok: true,
      netlist: { format: "spice", status: "ready" },
    });
    if (
      !read.ok ||
      read.operation !== "read-netlist" ||
      read.netlist.text === null
    ) {
      throw new Error("unexpected netlist result");
    }
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
