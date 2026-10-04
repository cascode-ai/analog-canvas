import { createEmptyDocument, roleLabelFormat } from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { resolveDocumentStyleProfile } from "@icm/derived";

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
