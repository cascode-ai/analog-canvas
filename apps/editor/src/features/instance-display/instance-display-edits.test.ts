import {
  createEmptyDocument,
  createRoutePath,
  roleLabelFormat,
} from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  outwardDefaultInstanceLabelPlacement,
  placeUprightInstanceLabel,
  resolveDocumentStyleProfile,
  type InstanceLabelSlot,
} from "@icm/derived";

import { arrangeInstanceLabels } from "./arrange-instance-labels";
import { defaultInstanceDisplayAnnotations } from "./default-instance-display";
import { instanceDisplayEdits } from "./instance-display-edits";

const resolver = new InMemorySymbolResolver(builtInSymbols);

/** One Cell Pin marker, P1, standing for the Cell terminal Vin. */
function pinDocument(labels: Annotation[] = []): SchematicDocument {
  const document = createEmptyDocument("main", "Main");
  return {
    ...document,
    instances: [
      {
        id: "P1",
        symbolId: "port",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      } as SchematicDocument["instances"][number],
    ],
    netlist: {
      ...document.netlist!,
      terminals: [
        {
          id: "terminal-p1",
          name: "Vin",
          netId: "net-p1",
          direction: "inout",
          interfaceInstanceIds: ["P1"],
        },
      ],
    },
    annotations: labels,
  };
}

const upserted = (edits: ReturnType<typeof instanceDisplayEdits>) =>
  edits.flatMap((edit) =>
    edit.kind === "upsert_schematic_annotation" ? [edit.annotation] : [],
  );

describe("showing or hiding a Cell Pin's name", () => {
  it("draws a Pin with no label its name, not a Reference it lacks", () => {
    const [label] = upserted(
      instanceDisplayEdits(pinDocument(), resolver, ["P1"], {
        showReference: true,
      }),
    );
    expect(label).toEqual(
      expect.objectContaining({
        kind: "instance-label",
        binding: { kind: "cell-terminal-name", terminalId: "terminal-p1" },
        formatOverride: roleLabelFormat("voltage-node", "Vin"),
      }),
    );
    expect(label?.visible).toBeUndefined();
  });

  it("hides and shows the Pin's existing name label", () => {
    const shown = upserted(
      instanceDisplayEdits(pinDocument(), resolver, ["P1"], {
        showReference: true,
      }),
    )[0]!;
    const hidden = upserted(
      instanceDisplayEdits(pinDocument([shown]), resolver, ["P1"], {
        showReference: false,
      }),
    );
    expect(hidden).toEqual([{ ...shown, visible: false }]);
    const again = upserted(
      instanceDisplayEdits(pinDocument(hidden), resolver, ["P1"], {
        showReference: true,
      }),
    );
    expect(again).toEqual([shown]);
  });
});

describe("a value takes the Reference's slot while no Reference is shown (#1105)", () => {
  const style = resolveDocumentStyleProfile(
    createEmptyDocument("s", "S").presentation,
  );
  function resistorDocument(options: { masterName?: string } = {}) {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      reference: "R1",
      symbolId: options.masterName ? "opamp" : "resistor",
      placement: {
        position: { x: 200, y: 200 },
        rotation: 90 as const,
        mirror: "none" as const,
      },
      netlist: { parameters: { value: "1k" } },
    } as SchematicDocument["instances"][number];
    document.instances.push(instance);
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        style,
        {
          showValue: true,
          ...(options.masterName
            ? { masterName: options.masterName, showDesignator: false }
            : {}),
        },
      ),
    );
    return document;
  }
  const apply = (
    document: SchematicDocument,
    edits: ReturnType<typeof instanceDisplayEdits>,
  ) => {
    for (const annotation of upserted(edits)) {
      const index = document.annotations.findIndex(
        (item) => item.id === annotation.id,
      );
      if (index >= 0) document.annotations[index] = annotation;
      else document.annotations.push(annotation);
    }
  };
  const at = (document: SchematicDocument, kind: Annotation["kind"]) => {
    const annotation = document.annotations.find((item) => item.kind === kind)!;
    if (annotation.anchor.kind !== "object") throw new Error("object anchor");
    return annotation.anchor.fallbackPosition;
  };

  it("moves an untouched value up when the Reference is hidden, and back when it is shown", () => {
    const document = resistorDocument();
    const referenceSlot = at(document, "instance-label");
    const valueSlot = at(document, "instance-value");
    expect(valueSlot.y - referenceSlot.y).toBe(20);

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], {
        showReference: false,
      }),
    );
    expect(at(document, "instance-value")).toEqual(referenceSlot);

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], { showReference: true }),
    );
    expect(at(document, "instance-label")).toEqual(referenceSlot);
    expect(at(document, "instance-value")).toEqual(valueSlot);
  });

  it("leaves a value a person placed where it is", () => {
    const document = resistorDocument();
    const value = document.annotations.find(
      (item) => item.kind === "instance-value",
    )!;
    if (value.anchor.kind !== "object") throw new Error("object anchor");
    value.anchor.localOffset.x += 40;
    value.anchor.fallbackPosition.x += 40;
    const placed = { ...value.anchor.fallbackPosition };
    const edits = upserted(
      instanceDisplayEdits(document, resolver, ["R1"], {
        showReference: false,
      }),
    );
    expect(edits.map((annotation) => annotation.kind)).toEqual([
      "instance-label",
    ]);
    expect(at(document, "instance-value")).toEqual(placed);
  });

  /**
   * A resistor whose value row a wire crosses: the arrangement moves its
   * name and value to its free left side.
   */
  function arrangedOnItsLeft() {
    const document = resistorDocument();
    document.instances[0]!.placement = {
      position: { x: -60, y: 0 },
      rotation: 0,
      mirror: "none",
    };
    document.annotations = [];
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        document.instances[0]!,
        resolver,
        style,
        { showValue: true },
      ),
    );
    document.nets.push({ id: "n", terminals: [] });
    document.junctions.push(
      { id: "a", netId: "n", position: { x: -60, y: 25 } },
      { id: "b", netId: "n", position: { x: 60, y: 25 } },
    );
    document.routes.push(
      createRoutePath({
        id: "w",
        netId: "n",
        start: { kind: "junction", junctionId: "a" },
        end: { kind: "junction", junctionId: "b" },
        bends: [],
        modes: ["manual"],
      }),
    );
    apply(document, arrangeInstanceLabels(document, resolver, ["R1"], {}));
    return document;
  }

  /**
   * R_F of an R-2R DAC, its labels arranged above it and slid along it in
   * the outward rule's rows: 10k over R_F.
   */
  function stackedValueFirst() {
    const document = resistorDocument();
    const instance = document.instances[0]!;
    instance.placement = {
      position: { x: 200, y: 200 },
      rotation: 270,
      mirror: "none",
    };
    const resolved = resolver.resolve("resistor")!;
    const slide = 6;
    for (const annotation of document.annotations) {
      const slot = annotation.kind === "instance-label" ? "reference" : "value";
      const placed = outwardDefaultInstanceLabelPlacement(
        instance,
        resolved,
        style,
        10,
        slot,
      )!;
      const position = { x: placed.position.x + slide, y: placed.position.y };
      annotation.alignment = placed.alignment;
      annotation.anchor = {
        kind: "object",
        objectId: "R1",
        localOffset: { x: position.x - 200, y: position.y - 200 },
        fallbackPosition: position,
      };
    }
    return document;
  }

  it("takes the name's place beside its part, where an arrangement put the two, when the name is hidden (#1384)", () => {
    const document = arrangedOnItsLeft();
    const nameSlot = at(document, "instance-label");
    const valueRow = at(document, "instance-value");
    expect(nameSlot.x).toBeLessThan(-60);
    expect(valueRow).toEqual({ x: nameSlot.x, y: nameSlot.y + 20 });

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], {
        showReference: false,
      }),
    );
    expect(at(document, "instance-value")).toEqual(nameSlot);
    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], { showReference: true }),
    );
    expect(at(document, "instance-label")).toEqual(nameSlot);
    expect(at(document, "instance-value")).toEqual(valueRow);
  });

  it("leaves a value a person moved off its arranged row where it was put (#1384)", () => {
    const document = arrangedOnItsLeft();
    const value = document.annotations.find(
      (item) => item.kind === "instance-value",
    )!;
    if (value.anchor.kind !== "object") throw new Error("object anchor");
    value.anchor.localOffset.y += 3;
    value.anchor.fallbackPosition.y += 3;
    expect(
      upserted(
        instanceDisplayEdits(document, resolver, ["R1"], {
          showReference: false,
        }),
      ).map((annotation) => annotation.kind),
    ).toEqual(["instance-label"]);
  });

  it("brings a value an arrangement stacked over its name down into the name's slot when the name is hidden (#1384)", () => {
    const document = stackedValueFirst();
    const nameSlot = at(document, "instance-label");
    expect(at(document, "instance-value").y).toBe(nameSlot.y - 20);

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], {
        showReference: false,
      }),
    );
    expect(at(document, "instance-value")).toEqual(nameSlot);

    // Shown again, R_F reads first: a row over 10k, which keeps the row
    // nearest the resistor.
    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], { showReference: true }),
    );
    expect(at(document, "instance-value")).toEqual(nameSlot);
    expect(at(document, "instance-label")).toEqual({
      x: nameSlot.x,
      y: nameSlot.y - 20,
    });
  });

  it("brings a value left a row off its part into its hidden name's slot when the name is hidden again (#1384)", () => {
    const document = stackedValueFirst();
    const nameSlot = at(document, "instance-label");
    document.annotations.find(
      (item) => item.kind === "instance-label",
    )!.visible = false;

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], {
        showReference: false,
      }),
    );
    expect(at(document, "instance-value")).toEqual(nameSlot);
  });

  it("puts a W/L back under its name above the part, in a group slid along it, when the name shows again (#1384)", () => {
    // A transistor whose name and W/L stand above it, slid along it as an
    // arrangement slides a group: the W/L stands a little further out than a
    // name would, clear of the transistor.
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 200, y: 200 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      netlist: { parameters: { w: "10u", l: "150n" } },
    } as SchematicDocument["instances"][number];
    document.instances.push(instance);
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        style,
        { showValue: true },
      ),
    );
    const resolved = resolver.resolve("nmos")!;
    const slide = 6;
    const above = (slot: InstanceLabelSlot) => {
      const placed = placeUprightInstanceLabel(
        instance,
        resolved,
        style,
        { x: 0, y: 0 },
        "top",
        document.presentation.grid,
        1,
        slot,
      )!;
      return { x: placed.position.x + slide, y: placed.position.y };
    };
    for (const annotation of document.annotations) {
      const position = above(
        annotation.kind === "instance-label" ? "reference-over-value" : "value",
      );
      annotation.alignment = "middle";
      annotation.anchor = {
        kind: "object",
        objectId: "M1",
        localOffset: { x: position.x - 200, y: position.y - 200 },
        fallbackPosition: position,
      };
    }

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["M1"], {
        showReference: false,
      }),
    );
    expect(at(document, "instance-value")).toEqual(above("reference"));

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["M1"], { showReference: true }),
    );
    expect(at(document, "instance-value")).toEqual(above("value"));
    expect(at(document, "instance-label")).toEqual(
      above("reference-over-value"),
    );
  });

  it("brings a name over its value above the part down to it when the value is hidden, and back up when it shows (#1384)", () => {
    const document = resistorDocument();
    const instance = document.instances[0]!;
    instance.placement = {
      position: { x: 200, y: 200 },
      rotation: 270,
      mirror: "none",
    };
    document.annotations = [];
    document.annotations.push(
      ...defaultInstanceDisplayAnnotations(
        document,
        instance,
        resolver,
        style,
        { showValue: true },
      ),
    );
    const name = at(document, "instance-label");
    const value = at(document, "instance-value");
    expect(value).toEqual({ x: name.x, y: name.y + 20 });

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], { showValue: false }),
    );
    expect(at(document, "instance-label")).toEqual(value);

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], { showValue: true }),
    );
    expect(at(document, "instance-label")).toEqual(name);
    expect(at(document, "instance-value")).toEqual(value);
  });

  it("gives a shown Reference its own row under a Cell's name instead of printing over it", () => {
    const document = resistorDocument({ masterName: "inv" });
    const nameSlot = at(document, "instance-value");
    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], { showReference: true }),
    );
    const reference = at(document, "instance-label");
    const name = at(document, "instance-value");
    expect(reference).toEqual(nameSlot);
    expect(name).not.toEqual(reference);
    expect(Math.abs(name.y - reference.y)).toBe(20);

    apply(
      document,
      instanceDisplayEdits(document, resolver, ["R1"], {
        showReference: false,
      }),
    );
    expect(at(document, "instance-value")).toEqual(nameSlot);
  });
});
