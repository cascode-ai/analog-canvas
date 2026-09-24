import { describe, expect, it } from "vitest";

import { createEmptyDocument, plainNameDocument } from "@icm/model";
import { executeTransaction } from "@icm/edit-engine";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { planComponentPropertyCodeEdits } from "./component-property-code-edits";
import { componentPropertyCodeValue } from "./component-property-code";
import { configurableLogicGateIds } from "./logic-gate-input-count";

describe("planComponentPropertyCodeEdits", () => {
  it.each(configurableLogicGateIds)(
    "retires only a cut wire's anonymous singleton input before shrinking %s",
    (family) => {
      const document = createEmptyDocument("main", "Main");
      const instance = {
        id: "X1",
        symbolId: `${family}-4`,
        reference: "X1",
        placement: null,
        netlist: {
          binding: {
            kind: "unresolved-subcircuit" as const,
            name: `${family.replace("-", "_")}_4`,
          },
          parameters: {},
        },
      };
      document.instances.push(instance);
      document.nets.push({
        id: "orphan-D",
        terminals: [{ instanceId: "X1", pinName: "D" }],
      });
      const value = {
        ...componentPropertyCodeValue({
          instance,
          referenceVisible: null,
          valueVisible: null,
          details: { parameters: [] },
        }),
        inputs: 2 as const,
      };
      const edits = planComponentPropertyCodeEdits(document, instance, value);
      expect(edits).toEqual([
        {
          kind: "disconnect_endpoint",
          endpoint: {
            kind: "terminal",
            instanceId: "X1",
            pinName: "D",
          },
        },
        { kind: "set_instance_symbol", instanceId: "X1", symbolId: family },
        {
          kind: "set_instance_binding",
          instanceId: "X1",
          binding: {
            kind: "unresolved-subcircuit",
            name: family.replace("-", "_"),
          },
        },
      ]);
      const applied = executeTransaction(
        document,
        {
          transactionId: "and-shrink",
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits,
        },
        { symbolResolver: new InMemorySymbolResolver(builtInSymbols) },
      );
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.document.instances[0]?.symbolId).toBe(family);
      expect(applied.document.nets).toEqual([]);

      for (const protectedDocument of [
        {
          ...document,
          junctions: [
            { id: "J1", netId: "orphan-D", position: { x: 0, y: 0 } },
          ],
        },
        {
          ...document,
          noConnects: [
            {
              id: "NC1",
              endpoint: {
                kind: "terminal" as const,
                instanceId: "X1",
                pinName: "D",
              },
            },
          ],
        },
        {
          ...document,
          connectivityEvidence: [
            {
              id: "source-D",
              kind: "spice-source" as const,
              netId: "orphan-D",
              sourceNetId: "imported-D",
            },
          ],
        },
      ]) {
        expect(
          planComponentPropertyCodeEdits(
            protectedDocument,
            instance,
            value,
          ).some((edit) => edit.kind === "disconnect_endpoint"),
        ).toBe(false);
      }
    },
  );
  it.each(configurableLogicGateIds)(
    "switches %s arity and its default black-box target in one edit batch",
    (family) => {
      const document = createEmptyDocument("main", "Main");
      const instance = {
        id: "X1",
        symbolId: family,
        placement: null,
        netlist: {
          binding: {
            kind: "unresolved-subcircuit" as const,
            name: family.replace("-", "_"),
          },
          parameters: {},
        },
      };
      const value = componentPropertyCodeValue({
        instance,
        referenceVisible: null,
        valueVisible: null,
        details: { parameters: [] },
      });
      expect(
        planComponentPropertyCodeEdits(document, instance, {
          ...value,
          inputs: 4,
        }),
      ).toEqual([
        {
          kind: "set_instance_symbol",
          instanceId: "X1",
          symbolId: `${family}-4`,
        },
        {
          kind: "set_instance_binding",
          instanceId: "X1",
          binding: {
            kind: "unresolved-subcircuit",
            name: `${family.replace("-", "_")}_4`,
          },
        },
      ]);
      expect(() =>
        planComponentPropertyCodeEdits(
          document,
          {
            ...instance,
            netlist: {
              binding: {
                kind: "unresolved-subcircuit" as const,
                name: "custom_and",
              },
              parameters: {},
            },
          },
          { ...value, inputs: 4 },
        ),
      ).toThrow("Restore the default logic gate target");
    },
  );
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
