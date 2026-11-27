import {
  CircuitProjectSchema,
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  freezeSnapshot,
  isFrozenSnapshot,
  parseProjectSnapshot,
} from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";
import { readTransactionDraftWork } from "./local-transaction-draft.js";
import {
  executeProjectTransaction,
  executeTransaction,
  type SchematicEdit,
} from "./index.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function twoNets() {
  const document = createEmptyDocument("main", "Main");
  for (const [netId, y] of [
    ["a", 0],
    ["b", 100],
  ] as const) {
    document.nets.push({ id: netId, terminals: [] });
    const endpoints = [0, 100].map((x) => {
      const id = netId + x;
      document.junctions.push({ id, netId, position: { x, y } });
      return { kind: "junction" as const, junctionId: id };
    });
    document.routes.push(
      createRoutePath({
        id: netId + "-wire",
        netId,
        start: endpoints[0]!,
        end: endpoints[1]!,
        bends: [],
        modes: ["manual"],
      }),
    );
  }
  return document;
}

const wire: SchematicEdit[] = [
  { kind: "merge_nets", targetNetId: "a", sourceNetId: "b" },
  {
    kind: "set_route_path",
    route: createRoutePath({
      id: "connector",
      netId: "a",
      start: { kind: "junction", junctionId: "a0" },
      end: { kind: "junction", junctionId: "b0" },
      bends: [],
      modes: ["manual"],
    }),
  },
];
const blank: SchematicEdit[] = [
  {
    kind: "add_instance",
    instance: {
      id: "M1",
      symbolId: "nmos",
      placement: { position: { x: 300, y: 300 }, rotation: 0, mirror: "none" },
    },
  },
];

describe("local transaction drafts", () => {
  it.each([
    ["scalar Wire", wire],
    ["blank MOS", blank],
  ] as const)(
    "does not deep-clone the frozen source when drafting a %s",
    (_name, edits) => {
      const document = freezeSnapshot(twoNets());
      const request = {
        transactionId: "draft",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "editor" },
        edits,
      };
      const reference = executeTransaction(structuredClone(document), request, {
        symbolResolver: resolver,
      });
      expect(reference.ok).toBe(true);
      const cloning = vi.spyOn(globalThis, "structuredClone");
      try {
        const result = executeTransaction(document, request, {
          symbolResolver: resolver,
        });
        expect(result).toEqual(reference);
        expect(readTransactionDraftWork(reference.document)).toEqual({
          mode: "full",
          reason: "mutable-source",
        });
        expect(readTransactionDraftWork(result.document)).toMatchObject({
          mode: "local",
          rowsCopied: _name === "blank MOS" ? 0 : 3,
        });
        expect(
          cloning.mock.calls.filter(([value]) => value === document),
        ).toHaveLength(0);
      } finally {
        cloning.mockRestore();
      }
    },
  );
  it("repairs a materialized Junction anchor during an otherwise unrelated placement", () => {
    const input = createEmptyDocument("anchor", "Anchor");
    const part = (id: string, x: number, y: number) => ({
      id,
      symbolId: "resistor",
      placement: {
        position: { x, y },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    });
    input.instances.push(part("A", 0, 20), part("B", 100, 20));
    input.nets.push({
      id: "n",
      terminals: [
        { instanceId: "A", pinName: "1" },
        { instanceId: "B", pinName: "1" },
      ],
    });
    input.junctions.push({
      id: "J",
      netId: "n",
      position: { x: 100, y: 0 },
      contactAnchor: { instanceId: "A", pinName: "1" },
    });
    const source = freezeSnapshot(input);
    const request = {
      transactionId: "anchor",
      documentId: source.id,
      expectedRevision: 0,
      actor: { kind: "human", id: "editor" },
      edits: [{ kind: "add_instance", instance: part("X", 400, 300) }],
    };
    const full = executeTransaction(structuredClone(source), request, {
      symbolResolver: resolver,
    });
    expect(
      full.ok && full.document.junctions[0]?.contactAnchor?.instanceId,
    ).toBe("B");
    const result = executeTransaction(source, request, {
      symbolResolver: resolver,
    });
    expect(result).toEqual(full);
    expect(source.junctions[0]?.contactAnchor?.instanceId).toBe("A");
    expect(readTransactionDraftWork(result.document)).toEqual({
      mode: "local",
      rowsCopied: 1,
    });
  });

  it("keeps scalar global naming local and preserves the full executor for a route-owned Net label", () => {
    for (const withLabel of [false, true]) {
      const input = twoNets(),
        route = input.routes[1]!;
      input.connectivityEvidence.push({
        id: "claim",
        kind: "name-claim",
        netId: "b",
        name: "BIAS",
        owner: withLabel
          ? { kind: "net-label", annotationId: "label" }
          : { kind: "global-declaration", sourceNetId: "BIAS" },
        scope: withLabel ? "local" : "global",
      });
      if (!withLabel)
        input.connectivityEvidence.push({
          id: "source",
          kind: "spice-source",
          netId: "b",
          sourceNetId: "BIAS",
        });
      if (withLabel)
        input.annotations.push({
          id: "label",
          kind: "net-label",
          netId: "b",
          binding: { kind: "net-name", netId: "b" },
          anchor: {
            kind: "route",
            routeId: route.id,
            legId: route.legs[0]!.id,
            t: 0.5,
            normalOffset: 10,
            direction: "forward",
            orientation: "horizontal",
            fallbackPosition: { x: 50, y: 90 },
          },
          alignment: "middle",
          rotation: 0,
          locked: false,
        });
      const source = freezeSnapshot(input);
      const request = {
        transactionId: "named",
        documentId: source.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "editor" },
        edits: wire,
      };
      const reference = executeTransaction(structuredClone(source), request, {
        symbolResolver: resolver,
      });
      const result = executeTransaction(source, request, {
        symbolResolver: resolver,
      });
      expect(
        result.ok,
        JSON.stringify(
          result.ok
            ? null
            : {
                withLabel,
                error: result.error,
                diagnostics: result.diagnostics,
              },
        ),
      ).toBe(true);
      expect(result).toEqual(reference);
      expect(result.document.connectivityEvidence[0]?.netId).toBe("a");
      expect(readTransactionDraftWork(result.document)).toMatchObject(
        withLabel
          ? { mode: "full", reason: "dependent-document-policy" }
          : { mode: "local" },
      );
    }
  });

  it("isolates a dry run, a late failure and a retry after writing the first Net", () => {
    const source = freezeSnapshot(twoNets()),
      pristine = structuredClone(source);
    const request = {
      transactionId: "retry",
      documentId: source.id,
      expectedRevision: 0,
      actor: { kind: "human", id: "editor" },
      edits: wire,
    };
    const context = { symbolResolver: resolver };
    const dry = executeTransaction(
      source,
      { ...request, dryRun: true },
      context,
    );
    expect(dry).toMatchObject({
      ok: true,
      applied: false,
      proposedRevision: 1,
    });
    dry.document.routes[0]!.netId = "mutated outside";
    const rejection = executeTransaction(
      source,
      {
        ...request,
        edits: [
          ...wire,
          { kind: "merge_nets", targetNetId: "a", sourceNetId: "missing" },
        ],
      },
      context,
    );
    expect(rejection).toMatchObject({
      ok: false,
      applied: false,
      error: { code: "OBJECT_NOT_FOUND" },
    });
    expect(source).toEqual(pristine);
    expect(executeTransaction(source, request, context)).toEqual(
      executeTransaction(pristine, request, context),
    );
  });

  it("keeps attribute and isolated transform edits local on a Cell with formal Pins and Net Labels", () => {
    const project = createEmptyProject("labeled-proj", "Labeled Project");
    const doc = project.documents[0]!;
    doc.nets.push({
      id: "net-in",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    doc.junctions.push({
      id: "j1",
      netId: "net-in",
      position: { x: 100, y: 0 },
    });
    doc.routes.push(
      createRoutePath({
        id: "r1",
        netId: "net-in",
        start: { kind: "terminal", instanceId: "P1", pinName: "P" },
        end: { kind: "junction", junctionId: "j1" },
        bends: [],
        modes: ["manual"],
      }),
    );
    doc.instances.push(
      {
        id: "P1",
        symbolId: "port",
        placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      },
      {
        id: "R1",
        reference: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 200 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "10k" },
        },
      },
    );
    doc.netlist = {
      name: "top",
      terminals: [
        {
          id: "term-in",
          name: "IN",
          netId: "net-in",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      ],
      formalParameters: [],
    };
    doc.connectivityEvidence.push({
      id: "claim-in",
      kind: "name-claim",
      netId: "net-in",
      name: "IN",
      owner: { kind: "net-label", annotationId: "lbl-in" },
      scope: "local",
    });
    doc.annotations.push(
      {
        id: "lbl-in",
        kind: "net-label",
        netId: "net-in",
        binding: { kind: "net-name", netId: "net-in" },
        anchor: {
          kind: "route",
          routeId: "r1",
          legId: doc.routes[0]!.legs[0]!.id,
          t: 0.5,
          normalOffset: 10,
          direction: "forward",
          orientation: "horizontal",
          fallbackPosition: { x: 50, y: 10 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
      {
        id: "val-R1",
        kind: "instance-value",
        binding: { kind: "instance-value", instanceId: "R1" },
        anchor: {
          kind: "object",
          objectId: "R1",
          localOffset: { x: 10, y: 20 },
          fallbackPosition: { x: 310, y: 220 },
        },
        alignment: "middle",
        rotation: 0,
        locked: false,
      },
    );
    const peer = createEmptyDocument("peer", "Peer");
    project.documents.push(peer);
    const snapshot = parseProjectSnapshot(CircuitProjectSchema.parse(project));
    const source = snapshot.documents[0]!;
    const pristine = structuredClone(source);

    const cases: readonly (readonly [string, SchematicEdit[]])[] = [
      [
        "move_instance",
        [
          {
            kind: "move_instance",
            instanceId: "R1",
            position: { x: 320, y: 240 },
          },
        ],
      ],
      [
        "rotate_instance",
        [{ kind: "rotate_instance", instanceId: "R1", rotation: 90 }],
      ],
      [
        "mirror_instance",
        [{ kind: "mirror_instance", instanceId: "R1", mirror: "horizontal" }],
      ],
      [
        "patch_instance_netlist_parameters",
        [
          {
            kind: "patch_instance_netlist_parameters",
            instanceId: "R1",
            set: { value: "20k" },
          },
        ],
      ],
      [
        "set_instance_reference",
        [{ kind: "set_instance_reference", instanceId: "R1", reference: "R9" }],
      ],
      [
        "set_instance_style_override",
        [
          {
            kind: "set_instance_style_override",
            instanceId: "R1",
            styleOverride: { foreground: "#cc0000" },
          },
        ],
      ],
    ];

    for (const [name, edits] of cases) {
      const request = {
        transactionId: `local-${name}`,
        documentId: source.id,
        expectedRevision: source.revision,
        actor: { kind: "human", id: "editor" },
        edits,
      };
      const reference = executeTransaction(structuredClone(source), request, {
        symbolResolver: resolver,
      });
      const result = executeTransaction(source, request, {
        symbolResolver: resolver,
      });
      expect(result.ok, name).toBe(true);
      expect(result).toEqual(reference);
      expect(readTransactionDraftWork(result.document)).toMatchObject({
        mode: "local",
      });
      expect(isFrozenSnapshot(result.document)).toBe(false);

      const owned = executeTransaction(source, request, {
        symbolResolver: resolver,
        resultOwnership: "owned",
      });
      expect(owned.ok, name).toBe(true);
      expect(owned).toEqual(reference);
      expect(isFrozenSnapshot(owned.document)).toBe(true);
      expect(owned.document.instances[0]).toBe(source.instances[0]);
      expect(owned.document.routes[0]).toBe(source.routes[0]);
      expect(owned.document.annotations[0]).toBe(source.annotations[0]);

      const projectRequest = {
        transactionId: `ptx-${name}`,
        projectId: snapshot.id,
        expectedStructureRevision: snapshot.structureRevision,
        actor: { kind: "human" as const, id: "editor" },
        edits: [
          {
            kind: "transact_document" as const,
            documentId: source.id,
            expectedRevision: source.revision,
            edits,
          },
        ],
      };
      const placed = executeProjectTransaction(snapshot, projectRequest, {
        resultOwnership: "canvas-placement",
      });
      const detached = executeProjectTransaction(snapshot, projectRequest);
      expect(placed.ok, name).toBe(true);
      expect(placed).toEqual(detached);
      if (placed.ok) {
        expect(placed.project.documents[1]).toBe(snapshot.documents[1]);
        expect(placed.project.documents[0]!.instances[0]).toBe(
          source.instances[0],
        );
      }
    }
    expect(source).toEqual(pristine);
  });
});
