import { describe, expect, it } from "vitest";

import { createEmptyProject } from "@icm/model";
import type { Annotation, RichTextDocument } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import {
  attachedInstanceFormulaAnnotation,
  boundFormulaPresentation,
} from "./bound-formula";

const formula = (latex: string): RichTextDocument => ({
  runs: [{ kind: "math", latex, display: "inline" }],
});

describe("bound formula semantics", () => {
  it("compiles only presentation-equivalent formulas for a bound name", () => {
    expect(boundFormulaPresentation("M_1", "M1")).toEqual({
      runs: [
        { kind: "text", value: "M" },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "1" }],
        },
      ],
    });
    expect(
      boundFormulaPresentation(String.raw`\overline{I_n^2}`, "In2"),
    ).not.toBeNull();
    expect(boundFormulaPresentation("M_1=4kT", "M1")).toBeNull();
    expect(boundFormulaPresentation(String.raw`\frac{M}{1}`, "M1")).toBeNull();
  });

  it("converts a mismatched Reference formula into literal instance-attached text", () => {
    const project = createEmptyProject("formula", "Formula");
    const document = project.documents[0]!;
    document.instances.push({
      id: "M1",
      reference: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      netlist: {
        binding: { kind: "model", deviceClass: "mos", name: "nmos" },
        parameters: {},
      },
    });
    const source: Annotation = {
      id: "instance-label-M1",
      kind: "instance-label",
      binding: { kind: "instance-reference", instanceId: "M1" },
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 30, y: -20 },
        fallbackPosition: { x: 130, y: 80 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    const content = formula(String.raw`\overline{I_n^2}=4kT\gamma g_m`);
    const annotation = attachedInstanceFormulaAnnotation({
      document,
      source,
      formula: content,
      resolver: createProjectSymbolResolver(project, builtInSymbols),
      id: "instance-formula-1",
    });

    expect(annotation).toMatchObject({
      id: "instance-formula-1",
      kind: "instance-value",
      content,
      anchor: { kind: "object", objectId: "M1" },
    });
    expect(annotation).not.toHaveProperty("binding");
    expect(document.instances[0]!.reference).toBe("M1");
  });
});
