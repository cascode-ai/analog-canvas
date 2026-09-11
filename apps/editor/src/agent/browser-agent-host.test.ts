import { describe, expect, it } from "vitest";

import { createAgentCircuitService } from "@icm/agent-adapter";
import type { AgentPermissions } from "@icm/agent-adapter";
import { sha256Hex } from "@icm/derived";
import { createEmptyProject } from "@icm/model";
import { renderDocumentSvg } from "@icm/render-svg";

import { EditorDocumentController } from "../document/document-controller";
import { BrowserAgentHost } from "./browser-agent-host";

const allPermissions: AgentPermissions = {
  snapshot: true,
  render: true,
  sourceSpans: false,
  semanticControl: true,
  edit: { geometry: true, connectivity: true, presentation: true },
};

function instance(id: string) {
  return {
    id,
    symbolId: "resistor",
    placement: null,
  };
}

function setup() {
  const project = createEmptyProject("agent-session", "Agent Session");
  const controller = new EditorDocumentController(project);
  let committed = 0;
  const semanticRequests: string[] = [];
  const host = new BrowserAgentHost(
    controller,
    () => {
      committed += 1;
    },
    (request) => {
      semanticRequests.push(request.intent.kind);
      return {
        ok: true,
        documentId: request.documentId,
        kind: request.intent.kind,
        objectIds:
          request.intent.kind === "highlight-net" ? [request.intent.netId] : [],
        ...(request.intent.kind === "highlight-net"
          ? { netId: request.intent.netId }
          : {}),
      };
    },
  );
  const service = createAgentCircuitService({
    agentId: "codex",
    host,
    permissions: allPermissions,
  });
  return {
    controller,
    host,
    service,
    committed: () => committed,
    semanticRequests: () => [...semanticRequests],
  };
}

// WP-WA3: the complete capabilities/snapshot/transact/render feature runs
// against the live EditorDocumentController inside one process, with no network,
// token, or Worker. Agent commits enter the same history as human edits.

describe("BrowserAgentHost + Agent Circuit service", () => {
  it("uses the public v2 parser before a hosted request can reach the controller", () => {
    const { controller, service } = setup();
    const result = service.handle({
      apiVersion: "1.0",
      requestId: "legacy-hosted-request",
      operation: "capabilities",
    });

    expect(result).toMatchObject({
      apiVersion: "3.0",
      requestId: "legacy-hosted-request",
      operation: "error",
      ok: false,
      error: { code: "INVALID_REQUEST" },
    });
    expect(controller.document.revision).toBe(0);
  });

  it("runs capabilities/snapshot/transact/render against the live document", () => {
    const { controller, service, committed } = setup();
    const documentId = controller.activeDocumentId;

    const capabilities = service.handle({
      apiVersion: "3.0",
      requestId: "r-cap",
      operation: "capabilities",
    });
    expect(capabilities.ok).toBe(true);

    const snapshotBefore = service.handle({
      apiVersion: "3.0",
      requestId: "r-snap",
      operation: "snapshot",
      documentId,
    });
    expect(snapshotBefore.ok).toBe(true);

    const transact = service.handle({
      apiVersion: "3.0",
      requestId: "r-tx",
      operation: "transact",
      documentId,
      transactionId: "tx-1",
      expectedRevision: 0,
      edits: [{ kind: "add_instance", instance: instance("R1") }],
    });
    expect(transact.ok).toBe(true);

    // The Agent commit is visible in the live controller state and history.
    expect(controller.document.instances).toContainEqual(instance("R1"));
    expect(controller.document.revision).toBe(1);
    expect(controller.canUndo).toBe(true);
    expect(committed()).toBe(1);

    const render = service.handle({
      apiVersion: "3.0",
      requestId: "r-render",
      operation: "render",
      documentId,
      mode: "formal",
    });
    expect(render.ok).toBe(true);
  });

  it("treats one Agent transaction as one undo item", () => {
    const { controller, service } = setup();
    const documentId = controller.activeDocumentId;

    service.handle({
      apiVersion: "3.0",
      requestId: "r-tx",
      operation: "transact",
      documentId,
      transactionId: "tx-1",
      expectedRevision: 0,
      edits: [{ kind: "add_instance", instance: instance("Ragent") }],
    });

    // A single human undo restores the pre-Agent state through the shared history.
    controller.transact([{ kind: "undo" }]);
    expect(controller.document.instances).not.toContainEqual(
      instance("Ragent"),
    );
    expect(controller.canUndo).toBe(false);
  });

  it("routes scoped semantic control to the browser without changing history", () => {
    const { controller, service, committed, semanticRequests } = setup();
    const documentId = controller.activeDocumentId;

    const result = service.handle({
      apiVersion: "3.0",
      requestId: "semantic-fit",
      operation: "transact",
      documentId,
      transactionId: "semantic-fit-tx",
      expectedRevision: controller.document.revision,
      semanticIntent: { kind: "fit-document" },
    });

    expect(result).toMatchObject({
      operation: "transact",
      ok: true,
      applied: false,
      revision: 0,
      proposedRevision: 0,
      diff: {
        documentId,
        fromRevision: 0,
        toRevision: 0,
        editKinds: [],
        changedObjectIds: [],
      },
      semantic: { kind: "fit-document", documentId, objectIds: [] },
    });
    expect(semanticRequests()).toEqual(["fit-document"]);
    expect(controller.document.revision).toBe(0);
    expect(controller.canUndo).toBe(false);
    expect(committed()).toBe(0);
  });

  it("rejects semantic control when the explicit scope is absent", () => {
    const { controller, host, semanticRequests } = setup();
    const service = createAgentCircuitService({
      agentId: "codex-no-semantic",
      host,
      permissions: { ...allPermissions, semanticControl: false },
    });

    const result = service.handle({
      apiVersion: "3.0",
      requestId: "semantic-denied",
      operation: "transact",
      documentId: controller.activeDocumentId,
      transactionId: "semantic-denied-tx",
      expectedRevision: 0,
      semanticIntent: { kind: "clear-focus" },
    });

    expect(result).toMatchObject({
      ok: false,
      operation: "transact",
      error: { code: "PERMISSION_DENIED" },
    });
    expect(semanticRequests()).toEqual([]);
    expect(controller.document.revision).toBe(0);
  });

  it("produces a formal render hash identical to the direct renderer", () => {
    const { controller, service } = setup();
    const documentId = controller.activeDocumentId;

    const render = service.handle({
      apiVersion: "3.0",
      requestId: "r-render",
      operation: "render",
      documentId,
      mode: "formal",
    });
    expect(render.ok).toBe(true);
    if (!(render.ok && render.operation === "render")) return;

    const directSvg = renderDocumentSvg(
      controller.document,
      controller.resolver,
    );
    expect(render.artifact.sha256).toBe(sha256Hex(directSvg));
  });

  it("keeps the old host fenced off after whole-Project replacement", () => {
    const { controller, host, service } = setup();
    const oldDocumentId = controller.activeDocumentId;

    const replacement = createEmptyProject(
      "replacement",
      "Replacement",
      "document-replacement",
    );
    controller.replaceProject(replacement);

    expect(() => host.getProject()).toThrow(/replaced/u);
    expect(host.getDocument(oldDocumentId)).toBeNull();
    expect(host.getDocument(replacement.topDocumentId)).toBeNull();
    const oldServiceRead = service.handle({
      apiVersion: "3.0",
      requestId: "replacement-race",
      operation: "snapshot",
      documentId: replacement.topDocumentId,
    });
    expect(oldServiceRead.ok).toBe(false);

    const replacementHost = new BrowserAgentHost(controller);
    expect(
      replacementHost.getDocument(replacement.topDocumentId),
    ).not.toBeNull();
  });

  it("returns DOCUMENT_NOT_FOUND for an unknown document over the host", () => {
    const { service } = setup();

    const result = service.handle({
      apiVersion: "3.0",
      requestId: "r-snap",
      operation: "snapshot",
      documentId: "does-not-exist",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("DOCUMENT_NOT_FOUND");
    }
  });
});
