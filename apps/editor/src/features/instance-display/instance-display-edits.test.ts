import { createEmptyDocument, roleLabelFormat } from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

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
