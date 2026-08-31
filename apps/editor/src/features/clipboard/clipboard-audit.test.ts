/**
 * Wire-transform audit batch 3, clipboard trio: explicit route selections
 * copy without dragging foreign terminals along (#5), orienting a clipboard
 * turns drafting objects with the rigid body (#12), and a junction-only
 * copy pastes into a fresh net instead of an undefined netId (#16).
 */
import { createEmptyDocument, createRoutePath } from "@icm/model";
import { executeTransaction } from "@icm/edit-engine";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  copySelection,
  orientClipboard,
  proposePaste,
  type SchematicClipboard,
} from "./clipboard";

const resolver = new InMemorySymbolResolver(builtInSymbols);

// net-n1 spans P1.P -- r-a -- j1 -- r-b -- P2.P; the copy takes P1 + r-a + j1.
function fixture() {
  const document = createEmptyDocument("document-main", "Clipboard");
  document.instances.push(
    {
      id: "P1",
      symbolId: "port",
      placement: { position: { x: 140, y: 300 }, rotation: 0, mirror: "none" },
    },
    {
      id: "P2",
      symbolId: "port",
      placement: { position: { x: 460, y: 300 }, rotation: 0, mirror: "x" },
    },
  );
  document.nets.push({
    id: "net-n1",
    terminals: [
      { instanceId: "P1", pinName: "P" },
      { instanceId: "P2", pinName: "P" },
    ],
  });
  document.netlist = {
    name: "cell",
    formalParameters: [],
    terminals: [
      {
        id: "cell-terminal-p1",
        name: "T1",
        netId: "net-n1",
        direction: "passive",
        interfaceInstanceIds: ["P1"],
      },
      {
        id: "cell-terminal-p2",
        name: "T2",
        netId: "net-n1",
        direction: "passive",
        interfaceInstanceIds: ["P2"],
      },
    ],
  };
  document.junctions.push({
    id: "j1",
    netId: "net-n1",
    position: { x: 300, y: 300 },
  });
  document.routes.push(
    createRoutePath({
      id: "r-a",
      netId: "net-n1",
      start: { kind: "terminal", instanceId: "P1", pinName: "P" },
      end: { kind: "junction", junctionId: "j1" },
      bends: [],
      modes: ["manual"],
    }),
    createRoutePath({
      id: "r-b",
      netId: "net-n1",
      start: { kind: "junction", junctionId: "j1" },
      end: { kind: "terminal", instanceId: "P2", pinName: "P" },
      bends: [],
      modes: ["manual"],
    }),
  );
  return document;
}

function paste(
  document: ReturnType<typeof fixture>,
  clipboard: SchematicClipboard,
) {
  const proposal = proposePaste(document, clipboard, { x: 0, y: 200 }, 1);
  return executeTransaction(
    document,
    {
      transactionId: "clipboard-audit-paste",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "test" },
      edits: proposal.edits,
    },
    { symbolResolver: resolver },
  );
}

describe("clipboard audit batch", () => {
  it("explicit route selection copies without foreign terminals (#5)", () => {
    const document = fixture();
    const clipboard = copySelection(document, ["P1"], [], {
      routeIds: ["r-a"],
      junctionIds: ["j1"],
      annotationIds: [],
    });
    expect(clipboard).not.toBeNull();
    expect(
      clipboard!.nets.flatMap((net) => net.terminals).map((t) => t.instanceId),
    ).not.toContain("P2");
    const result = paste(document, clipboard!);
    if (!result.ok) throw new Error(`paste rejected: ${result.error.message}`);
    expect(
      result.document.instances.filter((i) => i.id.startsWith("P1")),
    ).toHaveLength(2);
  });

  it("junction-only copy pastes into a fresh net (#16)", () => {
    const document = fixture();
    const clipboard = copySelection(document, [], [], {
      routeIds: [],
      junctionIds: ["j1"],
      annotationIds: [],
    });
    expect(clipboard).not.toBeNull();
    const proposal = proposePaste(document, clipboard!, { x: 0, y: 200 }, 1);
    const junctionEdit = proposal.edits.find(
      (edit) => edit.kind === "add_junction",
    );
    expect(
      junctionEdit?.kind === "add_junction" ? junctionEdit.netId : undefined,
    ).toBeDefined();
    const result = paste(document, clipboard!);
    if (!result.ok) throw new Error(`paste rejected: ${result.error.message}`);
    expect(result.document.junctions).toHaveLength(2);
  });

  it("rotating the clipboard turns drafting objects with the rigid body (#12)", () => {
    const clipboard: SchematicClipboard = {
      intent: "clone-selection",
      sourceDocumentId: "document-main",
      sourceGrid: 10,
      instances: [
        {
          id: "R1",
          symbolId: "resistor",
          placement: {
            position: { x: 100, y: 100 },
            rotation: 0,
            mirror: "none",
          },
        },
      ],
      cellTerminals: [],
      formalParameters: [],
      nets: [],
      routes: [],
      junctions: [],
      annotations: [],
      noConnects: [],
      connectivityEvidence: [],
      draftingObjects: [
        {
          id: "rect-1",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 200, y: 100 } },
          center: { x: 200, y: 100 },
          width: 40,
          height: 20,
          rotation: 0,
          lineStyle: "solid",
        },
        {
          id: "line-1",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 140 } },
          points: [
            { x: 100, y: 140 },
            { x: 200, y: 140 },
          ],
          lineStyle: "dashed",
        },
      ],
      layoutGroups: [],
      constraints: [],
    };
    const rotated = orientClipboard(clipboard, [
      { kind: "rotate", deltaDegrees: 90 },
    ]);
    // The instance anchors the body; the rectangle orbits it: (200,100) ->
    // (100,200), and its own rotation follows the quarter turn.
    expect(rotated.instances[0]!.placement!.position).toEqual({
      x: 100,
      y: 100,
    });
    const rectangle = rotated.draftingObjects.find((o) => o.id === "rect-1")!;
    expect(rectangle.kind === "rectangle" ? rectangle.center : null).toEqual({
      x: 100,
      y: 200,
    });
    expect(rectangle.kind === "rectangle" ? rectangle.rotation : null).toBe(90);
    const line = rotated.draftingObjects.find((o) => o.id === "line-1")!;
    expect(line.kind === "construction-line" ? line.points : null).toEqual([
      { x: 60, y: 100 },
      { x: 60, y: 200 },
    ]);
  });
});
