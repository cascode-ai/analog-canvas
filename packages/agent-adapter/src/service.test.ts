import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { executeTransaction, SchematicEditSchema } from "@icm/edit-engine";
import { resolveDocumentRoutingGeometry } from "@icm/derived";
import { createEmptyDocument } from "@icm/model";
import { parseProject } from "@icm/project-protocol";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  type SymbolResolver,
} from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { agentCircuitOpenApi } from "./openapi.js";
import {
  AgentCircuitRequestJsonSchema,
  AgentCircuitRequestSchema,
  AgentCircuitResponseJsonSchema,
  AgentCircuitResponseSchema,
} from "./schema.js";
import type { AgentPermissions } from "./schema.js";
import {
  AGENT_EDIT_KINDS,
  agentEditCategory,
  createAgentCircuitService,
} from "./service.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const allPermissions: AgentPermissions = {
  snapshot: true,
  render: true,
  sourceSpans: false,
  edit: { geometry: true, connectivity: true, presentation: true },
};

function resolveLocalJsonPointer(root: unknown, reference: string): unknown {
  if (!reference.startsWith("#/")) return undefined;
  return reference
    .slice(2)
    .split("/")
    .map((part) => part.replaceAll("~1", "/").replaceAll("~0", "~"))
    .reduce<unknown>((current, part) => {
      if (typeof current !== "object" || current === null) return undefined;
      return (current as Record<string, unknown>)[part];
    }, root);
}

function localReferences(root: unknown): string[] {
  const references: string[] = [];
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    for (const [key, item] of Object.entries(value)) {
      if (key === "$ref" && typeof item === "string" && item.startsWith("#")) {
        references.push(item);
      }
      visit(item);
    }
  };
  visit(root);
  return references;
}

function fixtureProject(): CircuitProject {
  return parseProject(
    readFileSync(
      resolve(
        process.cwd(),
        "fixtures/projects/phase-5-dense-analog/project.icproj.json",
      ),
      "utf8",
    ),
  );
}

function fixtureDocument(): SchematicDocument {
  return structuredClone(fixtureProject().documents[0]!);
}

function serviceFixture(
  permissions: AgentPermissions = allPermissions,
  limits: Parameters<typeof createAgentCircuitService>[0]["limits"] = {},
  symbolResolver: SymbolResolver = resolver,
) {
  let project = fixtureProject();
  let document = structuredClone(project.documents[0]!);
  const service = createAgentCircuitService({
    agentId: "agent-test",
    resolver: symbolResolver,
    permissions,
    limits,
    store: {
      getDocument: () => document,
      commitDocument: (next) => {
        document = next;
        project.documents = project.documents.map((candidate) =>
          candidate.id === next.id ? next : candidate,
        );
      },
      getProject: () => project,
      commitProject: (next) => {
        project = next;
        document =
          next.documents.find((candidate) => candidate.id === document.id) ??
          next.documents.find(
            (candidate) => candidate.id === next.topDocumentId,
          )!;
      },
    },
  });
  return { service, getDocument: () => document, getProject: () => project };
}

describe("current Agent Circuit API service", () => {
  it("rejects a schema-invalid request without changing the revision", () => {
    const fixture = serviceFixture();
    const before = fixture.getDocument().revision;
    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "invalid-variant",
      operation: "transact",
      documentId: fixture.getDocument().id,
      transactionId: "invalid-variant",
      expectedRevision: before,
      edits: [
        {
          kind: "add_instance",
          instance: {
            id: "VIN",
            symbolId: "port",
            symbolVariantId: "",
            placement: null,
          },
        },
      ],
    });
    expect(response).toMatchObject({
      operation: "error",
      ok: false,
      error: { code: "INVALID_REQUEST" },
      diagnostics: [
        {
          path: ["edits", 0, "instance", "symbolVariantId"],
        },
      ],
    });
    expect(fixture.getDocument().revision).toBe(before);
  });

  it("publishes exactly four operations and validates checked request examples", () => {
    const fixture = serviceFixture();
    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "capabilities-test",
      operation: "capabilities",
    });
    expect(response).toMatchObject({
      ok: true,
      operation: "capabilities",
      capabilities: {
        operations: ["capabilities", "snapshot", "transact", "render"],
        editKinds: expect.arrayContaining([
          "add_instance",
          "patch_instance_netlist_parameters",
          "connect_endpoints",
          "cut_connection",
          "merge_nets",
          "move_junction",
          "route_orthogonal",
          "disconnect_endpoint",
          "upsert_schematic_annotation",
          "remove_schematic_annotation",
        ]),
      },
    });
    expect(AgentCircuitResponseSchema.parse(response)).toEqual(response);
    for (const name of ["capabilities", "snapshot", "align", "render"]) {
      const request = JSON.parse(
        readFileSync(
          resolve(process.cwd(), `fixtures/agent-api/${name}.request.json`),
          "utf8",
        ),
      );
      expect(AgentCircuitRequestSchema.parse(request)).toEqual(request);
    }
    expect(AgentCircuitRequestJsonSchema).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
    });
    expect(Object.keys(agentCircuitOpenApi.paths).sort()).toEqual([
      "/api/agent/claims",
      "/api/agent/connectors/resume",
      "/api/agent/sessions/{sessionId}/circuit",
      "/api/agent/sessions/{sessionId}/files",
    ]);
  });

  it("derives advertised typed edits from the Edit Engine schema", () => {
    const typedKinds = SchematicEditSchema.options.map(
      (option) => option.shape.kind.value,
    );
    const supportedKinds = typedKinds.filter(
      (kind) => agentEditCategory(kind) !== "unsupported",
    );

    expect(AGENT_EDIT_KINDS).toEqual([...supportedKinds, "wire"]);
    expect(AGENT_EDIT_KINDS).toEqual(
      expect.arrayContaining([
        "add_no_connect",
        "remove_no_connect",
        "set_presentation_style",
        "upsert_schematic_annotation",
        "remove_schematic_annotation",
        "upsert_drafting_object",
        "remove_drafting_object",
      ]),
    );
    expect(AGENT_EDIT_KINDS).not.toEqual(
      expect.arrayContaining([
        "undo",
        "redo",
        "unplace_instance",
        "normalize_power_nets",
        "upsert_connectivity_evidence",
        "remove_connectivity_evidence",
      ]),
    );
  });

  it("publishes one reusable request and response schema in OpenAPI", () => {
    const schemas = agentCircuitOpenApi.components.schemas;
    const paths = ["/api/agent/sessions/{sessionId}/circuit"] as const;
    for (const path of paths) {
      expect(
        agentCircuitOpenApi.paths[path].post.requestBody.content[
          "application/json"
        ].schema,
      ).toEqual({ $ref: "#/components/schemas/agentCircuitRequest" });
      expect(
        agentCircuitOpenApi.paths[path].post.responses["200"].content[
          "application/json"
        ].schema,
      ).toEqual({ $ref: "#/components/schemas/agentCircuitResponse" });
    }
    expect(JSON.stringify(schemas.agentCircuitRequest)).toContain(
      "#/components/schemas/agentCircuitRequest/$defs/",
    );
    expect(JSON.stringify(schemas.agentCircuitResponse)).toContain(
      "#/components/schemas/agentCircuitResponse/$defs/",
    );
    expect(JSON.stringify(agentCircuitOpenApi)).not.toContain('"$schema"');
  });

  it("keeps every generated local reference resolvable and bounded", () => {
    for (const artifact of [
      AgentCircuitRequestJsonSchema,
      AgentCircuitResponseJsonSchema,
      agentCircuitOpenApi,
    ]) {
      const references = localReferences(artifact);
      expect(references.length).toBeGreaterThan(0);
      for (const reference of references) {
        expect(
          resolveLocalJsonPointer(artifact, reference),
          `unresolved local schema reference: ${reference}`,
        ).toBeDefined();
      }
    }

    // RichText recursively unfolds into both part documents. Schema 30 adds
    // one safe atomic formula leaf to every top-level RichText projection;
    // this raised ceiling still guards accidental projection bloat.
    expect(JSON.stringify(AgentCircuitRequestJsonSchema).length).toBeLessThan(
      155_000,
    );
    expect(JSON.stringify(AgentCircuitResponseJsonSchema).length).toBeLessThan(
      180_000,
    );
    expect(JSON.stringify(agentCircuitOpenApi).length).toBeLessThan(500_000);
  });

  it("publishes the flat Snapshot workflow and returns complete facts", () => {
    const fixture = serviceFixture();
    expect(
      fixture.service.handle({
        apiVersion: "2.0",
        requestId: "capabilities-current",
        operation: "capabilities",
      }),
    ).toMatchObject({
      apiVersion: "2.0",
      ok: true,
      capabilities: {
        operations: ["capabilities", "snapshot", "transact", "render"],
        apiVersions: ["2.0"],
        snapshotVersions: ["2.0"],
        permissions: { snapshot: true },
      },
    });

    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "snapshot-current",
      operation: "snapshot",
      documentId: "document-differential-stage",
    });
    expect(response).toMatchObject({
      apiVersion: "2.0",
      operation: "snapshot",
      ok: true,
      revision: 0,
      snapshot: {
        snapshotVersion: "2.0",
        document: {
          id: "document-differential-stage",
          instances: expect.any(Array),
          nets: expect.any(Array),
          routes: expect.any(Array),
          diagnostics: expect.any(Array),
        },
      },
    });
    if (
      !response.ok ||
      response.operation !== "snapshot" ||
      !("snapshot" in response)
    )
      return;
    expect(
      response.snapshot.document.instances.find((item) => item.id === "M1")
        ?.pins,
    ).toContainEqual(expect.objectContaining({ name: "G", netId: "net-vinp" }));
    expect(response.snapshot.document.nets).toContainEqual(
      expect.objectContaining({
        id: "net-vinp",
        terminals: expect.arrayContaining([{ instanceId: "M1", pinName: "G" }]),
      }),
    );
  });

  it("rejects Snapshots above the server-owned byte limit", () => {
    const fixture = serviceFixture(allPermissions, { maxSnapshotBytes: 10 });
    expect(
      fixture.service.handle({
        apiVersion: "2.0",
        requestId: "snapshot-too-large",
        operation: "snapshot",
        documentId: "document-differential-stage",
      }),
    ).toMatchObject({
      apiVersion: "2.0",
      ok: false,
      operation: "snapshot",
      error: { code: "SNAPSHOT_TOO_LARGE" },
    });
  });

  it("reuses one unchanged Snapshot and invalidates it after a commit", () => {
    let resolveCalls = 0;
    const countingResolver: SymbolResolver = {
      resolve(symbolId, variantId) {
        resolveCalls += 1;
        return resolver.resolve(symbolId, variantId);
      },
    };
    const fixture = serviceFixture(allPermissions, {}, countingResolver);
    const snapshotRequest = (requestId: string) => ({
      apiVersion: "2.0" as const,
      requestId,
      operation: "snapshot" as const,
      documentId: fixture.getDocument().id,
    });

    const first = fixture.service.handle(snapshotRequest("snapshot-first"));
    const callsAfterFirst = resolveCalls;
    const second = fixture.service.handle(snapshotRequest("snapshot-second"));

    expect(callsAfterFirst).toBeGreaterThan(0);
    expect(resolveCalls).toBe(callsAfterFirst);
    expect(second).toMatchObject({ ok: true, revision: 0 });
    if (
      !first.ok ||
      first.operation !== "snapshot" ||
      !second.ok ||
      second.operation !== "snapshot"
    ) {
      return;
    }
    expect(second.snapshot).toEqual(first.snapshot);

    const committed = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "move-before-snapshot",
      operation: "transact",
      documentId: fixture.getDocument().id,
      transactionId: "move-before-snapshot",
      expectedRevision: fixture.getDocument().revision,
      edits: [
        {
          kind: "move_instance",
          instanceId: "M1",
          position: { x: 180, y: 220 },
        },
      ],
    });
    expect(committed).toMatchObject({ ok: true, applied: true, revision: 1 });
    const callsAfterCommit = resolveCalls;

    const after = fixture.service.handle(snapshotRequest("snapshot-after"));
    expect(after).toMatchObject({ ok: true, revision: 1 });
    expect(resolveCalls).toBeGreaterThan(callsAfterCommit);
  });

  it("keeps Agent instance authoring identical to direct Edit Engine execution", () => {
    const fixture = serviceFixture();
    const request = {
      apiVersion: "2.0" as const,
      requestId: "add-instance-request",
      operation: "transact" as const,
      documentId: "document-differential-stage",
      transactionId: "add-R-new",
      expectedRevision: 0,
      edits: [
        {
          kind: "add_instance" as const,
          instance: {
            id: "R-new",
            symbolId: "resistor",
            placement: {
              position: { x: 420, y: 300 },
              rotation: 0 as const,
              mirror: "none" as const,
            },
          },
        },
      ],
    };
    const direct = executeTransaction(
      fixture.getDocument(),
      {
        transactionId: request.transactionId,
        documentId: request.documentId,
        expectedRevision: 0,
        actor: { kind: "agent", id: "agent-test" },
        edits: request.edits,
      },
      { symbolResolver: resolver },
    );

    expect(fixture.service.handle(request)).toMatchObject({
      ok: true,
      applied: true,
      revision: 1,
    });
    expect(direct.ok).toBe(true);
    expect(fixture.getDocument()).toEqual(direct.document);
    expect(fixture.getDocument().sourceStatus).toBe("connectivity-modified");
  });

  it("places a Cell Pin through one coordinated Agent transaction", () => {
    const fixture = serviceFixture();
    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "place-port-symbol",
      operation: "transact",
      documentId: fixture.getDocument().id,
      transactionId: "place-port-symbol",
      expectedRevision: fixture.getDocument().revision,
      expectedStructureRevision: fixture.getProject().structureRevision,
      structureEdits: [
        {
          kind: "transact_document",
          documentId: fixture.getDocument().id,
          expectedRevision: fixture.getDocument().revision,
          edits: [
            {
              kind: "add_instance",
              instance: {
                id: "PORT-OUT",
                symbolId: "port",
                placement: {
                  position: { x: 620, y: 300 },
                  rotation: 0,
                  mirror: "none",
                },
              },
            },
            {
              kind: "connect_endpoints",
              from: { kind: "terminal", instanceId: "PORT-OUT", pinName: "P" },
              to: { kind: "terminal", instanceId: "PORT-OUT", pinName: "P" },
              newNetId: "net-port-out",
            },
            {
              kind: "add_cell_terminal",
              terminal: {
                id: "terminal-port-out",
                name: "OUT",
                netId: "net-port-out",
                direction: "output",
                interfaceInstanceIds: ["PORT-OUT"],
              },
            },
          ],
        },
      ],
    });

    if (!response.ok) throw new Error(JSON.stringify(response, null, 2));
    expect(response).toMatchObject({ ok: true, applied: true, revision: 1 });
    expect(fixture.getDocument().instances).toContainEqual(
      expect.objectContaining({ id: "PORT-OUT", symbolId: "port" }),
    );
    expect(fixture.getDocument().netlist?.terminals).toContainEqual(
      expect.objectContaining({
        name: "OUT",
        interfaceInstanceIds: ["PORT-OUT"],
      }),
    );
    expect(resolver.resolve("port")?.definition.pins).toEqual([
      expect.objectContaining({ name: "P" }),
    ]);
  });

  it("adds a reusable Cell through the existing transact operation", () => {
    const fixture = serviceFixture();
    const child = createEmptyDocument("document-agent-child", "Agent Child");
    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "add-agent-child",
      operation: "transact",
      documentId: fixture.getDocument().id,
      transactionId: "add-agent-child",
      expectedRevision: fixture.getDocument().revision,
      expectedStructureRevision: fixture.getProject().structureRevision,
      structureEdits: [{ kind: "add_document", document: child }],
    });

    expect(response).toMatchObject({
      ok: true,
      applied: true,
      projectStructure: {
        fromRevision: 0,
        toRevision: 1,
        changedDocumentIds: ["document-agent-child"],
      },
    });
    expect(fixture.getProject().documents).toContainEqual(
      expect.objectContaining({ id: "document-agent-child" }),
    );
  });

  it("updates Cell symbol intent only through structureEdits", () => {
    const fixture = serviceFixture();
    const document = fixture.getDocument();
    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "set-cell-symbol-presentation",
      operation: "transact",
      documentId: document.id,
      transactionId: "set-cell-symbol-presentation",
      expectedRevision: document.revision,
      expectedStructureRevision: fixture.getProject().structureRevision,
      structureEdits: [
        {
          kind: "transact_document",
          documentId: document.id,
          expectedRevision: document.revision,
          edits: [
            {
              kind: "set_cell_symbol_presentation",
              presentation: { minimumBodySize: { width: 120, height: 80 } },
            },
          ],
        },
      ],
    });

    expect(response).toMatchObject({
      ok: true,
      applied: true,
      projectStructure: { fromRevision: 0, toRevision: 1 },
    });
    expect(fixture.getDocument().presentation.cellSymbol).toEqual({
      minimumBodySize: { width: 120, height: 80 },
    });
  });

  it("applies an instance netlist-parameter patch through the same presentation boundary", () => {
    const fixture = serviceFixture();
    fixture.getDocument().instances.find((item) => item.id === "M1")!.netlist =
      {
        reference: "M1",
        binding: { kind: "primitive", deviceClass: "mos" },
        parameters: {},
      };
    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "property-patch",
      operation: "transact",
      documentId: "document-differential-stage",
      transactionId: "property-patch",
      expectedRevision: 0,
      edits: [
        {
          kind: "patch_instance_netlist_parameters",
          instanceId: "M1",
          set: { value: "12u" },
        },
      ],
    });

    expect(response).toMatchObject({
      ok: true,
      revision: 1,
      diff: {
        editKinds: ["patch_instance_netlist_parameters"],
        changedObjectIds: ["M1"],
      },
    });
    expect(
      fixture.getDocument().instances.find((item) => item.id === "M1")?.netlist
        ?.parameters,
    ).toMatchObject({ value: "12u" });
  });

  it("allows Snapshot permission to be denied independently", () => {
    const fixture = serviceFixture({
      ...allPermissions,
      snapshot: false,
    });
    expect(
      fixture.service.handle({
        apiVersion: "2.0",
        requestId: "snapshot-denied",
        operation: "snapshot",
        documentId: "document-differential-stage",
      }),
    ).toMatchObject({
      ok: false,
      operation: "snapshot",
      error: { code: "PERMISSION_DENIED" },
    });
  });

  it("localizes a transact rejection to the failing edit with a path and objectIds", () => {
    const fixture = serviceFixture();
    for (const item of [
      ...fixture.getDocument().layoutGroups,
      ...fixture.getDocument().constraints,
    ]) {
      item.locked = false;
    }
    // Two edits: the first is a valid annotation; the second targets an
    // instance that does not exist, so it must reject at edits index 1.
    const response = fixture.service.handle({
      apiVersion: "2.0",
      requestId: "reject-index",
      operation: "transact",
      documentId: "document-differential-stage",
      transactionId: "reject-index",
      expectedRevision: 0,
      edits: [
        {
          kind: "upsert_schematic_annotation",
          annotation: {
            id: "note-test",
            kind: "route-marker",
            markerKind: "current",
            content: { runs: [{ kind: "text", value: "I_x" }] },
            anchor: {
              kind: "free",
              position: { x: 100, y: 100 },
            },
            alignment: "middle",
            rotation: 0,
            locked: false,
          },
        },
        {
          kind: "move_instance",
          instanceId: "instance-does-not-exist",
          position: { x: 200, y: 200 },
        },
      ],
    });
    expect(response).toMatchObject({
      ok: false,
      error: { code: "OBJECT_NOT_FOUND" },
    });
    if (response.ok) return;
    const diagnostic = response.diagnostics[0];
    expect(diagnostic).toBeDefined();
    expect(diagnostic!.path).toEqual(["edits", 1]);
    expect(diagnostic!.objectIds).toContain("instance-does-not-exist");
  });

  it("returns bounded formal and diagnostic image artifacts without overlay leakage", () => {
    const fixture = serviceFixture();
    const render = (mode: "formal" | "diagnostics") =>
      fixture.service.handle({
        apiVersion: "2.0",
        requestId: `render-${mode}`,
        operation: "render",
        documentId: "document-differential-stage",
        mode,
      });
    const formal = render("formal");
    const diagnostics = render("diagnostics");
    expect(formal).toMatchObject({ ok: true, operation: "render" });
    expect(diagnostics).toMatchObject({ ok: true, operation: "render" });
    if (
      !formal.ok ||
      formal.operation !== "render" ||
      !diagnostics.ok ||
      diagnostics.operation !== "render"
    )
      return;
    const formalSvg = Buffer.from(formal.artifact.data, "base64").toString(
      "utf8",
    );
    const diagnosticSvg = Buffer.from(
      diagnostics.artifact.data,
      "base64",
    ).toString("utf8");
    expect(formalSvg).toContain('data-layer="formal"');
    expect(formalSvg).not.toMatch(/agent-diagnostics|editor-overlay/u);
    expect(diagnosticSvg).toContain('data-layer="agent-diagnostics"');
    expect(diagnostics.artifact.sha256).toMatch(/^[a-f0-9]{64}$/u);
  });
});
