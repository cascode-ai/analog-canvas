import { describe, expect, it } from "vitest";
import {
  createEmptyDocument,
  createEmptyProject,
  createRoutePath,
  type Annotation,
  type SchematicDocument,
} from "@icm/model";
import {
  createLabelClearanceContext,
  resolveDocumentStyleProfile,
} from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import {
  InMemorySymbolResolver,
  builtInSymbols,
  createProjectSymbolResolver,
  hierarchicalSymbolId,
} from "@icm/symbols";

import { defaultInstanceDisplayAnnotations } from "./default-instance-display";
import {
  arrangeNewlyStruckLabels,
  withStruckLabelsArranged,
} from "./struck-label-arrangement";

const builtIn = new InMemorySymbolResolver(builtInSymbols);

/** A straight wire between two open ends, on a Net of its own. */
function wire(
  document: SchematicDocument,
  id: string,
  from: { x: number; y: number },
  to: { x: number; y: number },
) {
  document.nets.push({ id: `${id}-net`, terminals: [] });
  document.junctions.push(
    { id: `${id}-a`, netId: `${id}-net`, position: from },
    { id: `${id}-b`, netId: `${id}-net`, position: to },
  );
  document.routes.push(
    createRoutePath({
      id,
      netId: `${id}-net`,
      start: { kind: "junction", junctionId: `${id}-a` },
      end: { kind: "junction", junctionId: `${id}-b` },
      bends: [],
      modes: ["manual"],
    }),
  );
}

function applied(document: SchematicDocument, edits: readonly SchematicEdit[]) {
  const next = structuredClone(document);
  for (const edit of edits)
    if (edit.kind === "upsert_schematic_annotation") {
      const index = next.annotations.findIndex(
        (item) => item.id === edit.annotation.id,
      );
      next.annotations[index] = edit.annotation;
    }
  return next;
}

/** The wires drawn across a label, as VISUAL_LABEL_CLEARANCE reads them. */
function wiresAcross(
  document: SchematicDocument,
  resolver: typeof builtIn,
  id: string,
) {
  const context = createLabelClearanceContext(document, resolver);
  const label = document.annotations.find((item) => item.id === id)!;
  return context.wiresAt(context.measure(label).inkBounds);
}

/** A placed Cell X1 showing only its Cell name, under its block. */
function placedCell() {
  const project = createEmptyProject("project", "Project", "top");
  const child = createEmptyDocument("child", "child");
  for (const name of ["a", "b"]) {
    child.instances.push({ id: `P${name}`, symbolId: "port", placement: null });
    child.nets.push({
      id: `net-${name}`,
      terminals: [{ instanceId: `P${name}`, pinName: "P" }],
    });
    child.netlist!.terminals.push({
      id: `terminal-${name}`,
      name,
      netId: `net-${name}`,
      direction: "inout",
      interfaceInstanceIds: [`P${name}`],
    });
  }
  const top = project.documents[0]!;
  const instance = {
    id: "X1",
    reference: "X1",
    symbolId: hierarchicalSymbolId("child"),
    placement: {
      position: { x: 0, y: 0 },
      rotation: 0 as const,
      mirror: "none" as const,
    },
    netlist: {
      binding: { kind: "subcircuit" as const, childDocumentId: "child" },
      parameters: {},
    },
  };
  top.instances.push(instance);
  project.documents.push(child);
  const resolver = createProjectSymbolResolver(project, builtInSymbols);
  top.annotations.push(
    ...defaultInstanceDisplayAnnotations(
      top,
      instance,
      resolver,
      resolveDocumentStyleProfile(top.presentation),
      { masterName: "child", showDesignator: false },
    ),
  );
  return { project, top, resolver };
}

describe("labels a change newly strikes with a wire (#1366)", () => {
  it("moves a placed Cell's name off a wire drawn through it", () => {
    const { top, resolver } = placedCell();
    const name = "instance-master-X1";
    const ink = createLabelClearanceContext(top, resolver).measure(
      top.annotations.find((item) => item.id === name)! as Annotation,
    ).inkBounds;
    const after = structuredClone(top);
    // As an SRAM column's caller wire, redrawn under the block, ran
    // through the block's name.
    wire(
      after,
      "w",
      { x: Math.floor(ink.x) - 40, y: Math.round(ink.y + ink.height / 2) },
      {
        x: Math.ceil(ink.x + ink.width) + 40,
        y: Math.round(ink.y + ink.height / 2),
      },
    );
    expect(wiresAcross(after, resolver, name)).toEqual(["w"]);
    const edits = arrangeNewlyStruckLabels(
      { document: top, resolver },
      after,
      resolver,
    );
    expect(
      edits.map(
        (edit) =>
          edit.kind === "upsert_schematic_annotation" && edit.annotation.id,
      ),
    ).toEqual([name]);
    const moved = applied(after, edits);
    expect(wiresAcross(moved, resolver, name)).toEqual([]);
    // The name's text is the Cell's, as before.
    expect(moved.annotations.find((item) => item.id === name)?.content).toEqual(
      top.annotations.find((item) => item.id === name)?.content,
    );

    // A wire already across the name before the change is not this
    // change's doing: the name stays.
    expect(
      arrangeNewlyStruckLabels({ document: after, resolver }, after, resolver),
    ).toEqual([]);
  });

  it("arranges the labels a typed move lands on a wire, and leaves other edits alone", () => {
    const document = createEmptyDocument("d", "Typed move");
    const instance = {
      id: "R1",
      reference: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: { parameters: { value: "1k" } },
    };
    document.instances.push(instance);
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        instance,
        builtIn,
        resolveDocumentStyleProfile(document.presentation),
        { showValue: true },
      ),
    );
    const name = document.annotations.find(
      (item) => item.binding?.kind === "instance-reference",
    )!;
    // A wire beside R1, 40 units above its name: R1 typed 40 units up
    // lands its name on it.
    wire(document, "w", { x: 110, y: 60 }, { x: 200, y: 60 });
    expect(wiresAcross(document, builtIn, name.id)).toEqual([]);
    const move: SchematicEdit = {
      kind: "move_instance",
      instanceId: "R1",
      position: { x: 100, y: 60 },
    };
    const edits = withStruckLabelsArranged(document, builtIn, [move]);
    expect(edits[0]).toEqual(move);
    expect(edits.length).toBeGreaterThan(1);
    const moved = applied(
      {
        ...document,
        instances: [
          {
            ...instance,
            placement: { ...instance.placement, position: { x: 100, y: 60 } },
          },
        ],
      },
      edits.slice(1),
    );
    expect(wiresAcross(moved, builtIn, name.id)).toEqual([]);

    // Nothing moved: the edits go as they came.
    const restyle: SchematicEdit = {
      kind: "upsert_schematic_annotation",
      annotation: { ...name, sizeScale: 1.2 },
    };
    expect(withStruckLabelsArranged(document, builtIn, [restyle])).toEqual([
      restyle,
    ]);
  });
});
