import { describe, expect, it } from "vitest";

import { createEmptyDocument, plainNameDocument } from "@icm/model";

import { planComponentPropertyCodeEdits } from "./component-property-code-edits";
import { componentPropertyCodeValue } from "./component-property-code";

describe("planComponentPropertyCodeEdits", () => {
  it.each(["opamp-differential", "opamp-differential-wide"])(
    "composes both swap axes and custom marks for %s",
    (family) => {
      const document = createEmptyDocument("main", "Main");
      for (const sourceInputs of [false, true])
        for (const sourceOutputs of [false, true])
          for (const sourceMark of ["none", "A", "G"]) {
            const source = {
              id: "X1",
              symbolId: `${family}${sourceOutputs ? "-crossed" : ""}${sourceMark !== "none" ? "-lettered" : ""}${sourceInputs ? "-inputs-swapped" : ""}`,
              placement: {
                position: { x: 200, y: 200 },
                rotation: 90 as const,
                mirror: "horizontal" as const,
              },
              ...(sourceMark === "G"
                ? { signalFlowParameters: { formula: "G" } }
                : {}),
            };
            const baseline = componentPropertyCodeValue({
              instance: source,
              referenceVisible: null,
              valueVisible: null,
            });
            expect(
              planComponentPropertyCodeEdits(document, source, baseline),
            ).toEqual([]);
            for (const inputsSwapped of [false, true])
              for (const outputsSwapped of [false, true])
                for (const internalMark of ["none", "A", "G"]) {
                  const symbolId = `${family}${outputsSwapped ? "-crossed" : ""}${internalMark !== "none" ? "-lettered" : ""}${inputsSwapped ? "-inputs-swapped" : ""}`;
                  const edits = planComponentPropertyCodeEdits(
                    document,
                    source,
                    {
                      ...baseline,
                      appearance: {
                        color: "auto",
                        inputsSwapped,
                        outputsSwapped,
                        internalMark,
                      },
                    },
                  );
                  expect(
                    edits.filter((edit) => edit.kind === "set_instance_symbol"),
                  ).toEqual(
                    symbolId === source.symbolId
                      ? []
                      : [
                          {
                            kind: "set_instance_symbol",
                            instanceId: "X1",
                            symbolId,
                          },
                        ],
                  );
                  expect(
                    edits.every((edit) =>
                      [
                        "set_instance_symbol",
                        "set_instance_signal_flow_parameters",
                      ].includes(edit.kind),
                    ),
                  ).toBe(true);
                  if (internalMark === "G" && sourceMark !== "G")
                    expect(edits).toContainEqual({
                      kind: "set_instance_signal_flow_parameters",
                      instanceId: "X1",
                      parameters: { formula: "G" },
                    });
                }
          }
    },
  );

  it("combines comparator mark visibility with input swapping in one edit", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = { id: "X1", symbolId: "comparator", placement: null };
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: null,
        appearance: {
          color: "auto",
          inputPolarity: false,
          inputsSwapped: true,
        },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "X1",
        symbolId: "comparator-unmarked-inputs-swapped",
      },
    ]);
  });

  it("plans snapped placement, orientation, and appearance as typed edits", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      reference: "R1",
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: {
          coordinate: [123, 177],
          rotation: 90,
          mirror: "horizontal",
        },
        display: { visualAnnotation: true, value: false },
        appearance: { color: "#DC2626" },
      }),
    ).toEqual([
      {
        kind: "move_instance",
        instanceId: "R1",
        position: { x: 120, y: 180 },
      },
      { kind: "rotate_instance", instanceId: "R1", rotation: 90 },
      { kind: "mirror_instance", instanceId: "R1", mirror: "horizontal" },
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: { foreground: "#DC2626" },
      },
    ]);
  });

  it("emits no edit for the current presentation", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      reference: "R1",
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: {
          coordinate: [100, 100],
          rotation: 0,
          mirror: "none",
        },
        display: { visualAnnotation: true, value: false },
        appearance: { color: "auto" },
      }),
    ).toEqual([]);
  });

  it("clears a retired component background on the next appearance edit", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
      styleOverride: { background: "#ffffff" },
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: {
          coordinate: [100, 100],
          rotation: 0,
          mirror: "none",
        },
        appearance: { color: "auto" },
      }),
    ).toEqual([
      {
        kind: "set_instance_style_override",
        instanceId: "R1",
        styleOverride: null,
      },
    ]);
  });

  it("renames the electrical instance when its displayed name follows the reference", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "R1",
      symbolId: "resistor",
      reference: "R1",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    document.annotations.push({
      id: "instance-label-R1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "R1" },
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 20, y: -20 },
        fallbackPosition: { x: 120, y: 80 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const value = componentPropertyCodeValue({
      instance,
      displayName: "R1",
      referenceVisible: true,
      valueVisible: false,
    });
    const edits = planComponentPropertyCodeEdits(document, instance, {
      ...value,
      displayName: "RL",
    });
    expect(edits).toEqual([
      { kind: "set_instance_reference", instanceId: "R1", reference: "RL" },
    ]);
    expect(() =>
      planComponentPropertyCodeEdits(document, instance, {
        ...value,
        displayName: "RL",
        netlistName: "R2",
      }),
    ).toThrow();

    const { binding: _binding, ...aliasLabel } = document.annotations[0]!;
    document.annotations[0] = {
      ...aliasLabel,
      content: plainNameDocument("alias"),
    };
    const aliasEdits = planComponentPropertyCodeEdits(document, instance, {
      ...value,
      displayName: "load",
    });
    expect(aliasEdits).toContainEqual(
      expect.objectContaining({
        kind: "upsert_schematic_annotation",
        annotation: expect.objectContaining({ id: "instance-label-R1" }),
      }),
    );
    expect(aliasEdits).not.toContainEqual(
      expect.objectContaining({ kind: "set_instance_reference" }),
    );
  });

  it("switches a merged amplifier between no mark, A, and custom text", () => {
    const document = createEmptyDocument("main", "Main");
    const plain = {
      id: "A1",
      symbolId: "opamp",
      placement: null,
    };
    document.instances.push(plain);
    expect(
      planComponentPropertyCodeEdits(document, plain, {
        placement: null,
        appearance: { color: "auto", internalMark: "A" },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "opamp-lettered",
      },
    ]);
    expect(
      planComponentPropertyCodeEdits(document, plain, {
        placement: null,
        appearance: { color: "auto", internalMark: "G" },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "opamp-lettered",
      },
      {
        kind: "set_instance_signal_flow_parameters",
        instanceId: "A1",
        parameters: { formula: "G" },
      },
    ]);

    const marked = {
      ...plain,
      symbolId: "opamp-lettered",
      signalFlowParameters: { formula: "G" },
    };
    expect(
      planComponentPropertyCodeEdits(document, marked, {
        placement: null,
        appearance: { color: "auto", internalMark: "none" },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "opamp",
      },
      {
        kind: "set_instance_signal_flow_parameters",
        instanceId: "A1",
        parameters: null,
      },
    ]);
  });

  it("keeps comparator polarity independent from its input-swap state", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "A1",
      symbolId: "comparator-inputs-swapped",
      placement: null,
    };
    document.instances.push(instance);
    expect(
      planComponentPropertyCodeEdits(document, instance, {
        placement: null,
        appearance: { color: "auto", inputPolarity: false },
      }),
    ).toEqual([
      {
        kind: "set_instance_symbol",
        instanceId: "A1",
        symbolId: "comparator-unmarked-inputs-swapped",
      },
    ]);
  });
});
