import { describe, expect, it } from "vitest";

import { AGENT_API_VERSION } from "@icm/agent-adapter";
import { executeProjectTransaction } from "@icm/edit-engine";
import { createEmptyProject, type CircuitProject } from "@icm/model";

import { BrowserAgentProjectHost } from "./browser-agent-project-host";

describe("BrowserAgentProjectHost", () => {
  it("lists Cloud Cells and imports through one canonical Project transaction", async () => {
    let destination = createEmptyProject("destination", "Destination");
    const source = createEmptyProject("source", "Reusable OTA", "ota");
    const host = new BrowserAgentProjectHost({
      getProjectSessionId: () => "session",
      getProject: () => destination,
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
});
