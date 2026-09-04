import {
  createEmptyDocument,
  flattenRichText,
  semanticTextDocument,
  type Annotation,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  resolveAnnotationDisplayText,
  resolveAnnotationText,
} from "./annotation-text.js";

describe("bound annotation text", () => {
  it("projects one Reference and keeps RichText formatting in the annotation", () => {
    const document = createEmptyDocument("document-main", "Main");
    const formattedReference = {
      runs: [
        {
          kind: "span" as const,
          style: "bold" as const,
          children: [{ kind: "text" as const, value: "M_INTERNAL" }],
        },
      ],
    };
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M_INTERNAL",
      netlist: { parameters: {} },
    });
    const annotation: Annotation = {
      id: "instance-label-M1",
      kind: "instance-label" as const,
      binding: { kind: "instance-reference" as const, instanceId: "M1" },
      anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };

    expect(resolveAnnotationText(document, annotation)).toEqual(
      semanticTextDocument("M_INTERNAL", "instance-label"),
    );
    expect(
      resolveAnnotationText(document, {
        ...annotation,
        formatOverride: formattedReference,
      }),
    ).toEqual(formattedReference);
  });

  it("never falls back from a missing Reference to object identity", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "opaque-object-id",
      symbolId: "resistor",
      placement: null,
      reference: "R7",
      netlist: { parameters: {} },
    });
    const annotation = {
      id: "instance-label-R7",
      kind: "instance-label" as const,
      binding: {
        kind: "instance-reference" as const,
        instanceId: "opaque-object-id",
      },
      anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    expect(resolveAnnotationText(document, annotation)).toEqual(
      semanticTextDocument("R7", "instance-label"),
    );
    delete document.instances[0]!.reference;
    expect(resolveAnnotationText(document, annotation)).toEqual(
      semanticTextDocument("", "instance-label"),
    );
  });

  it("uses a formal Port RichText label without changing its electrical terminal name", () => {
    const document = createEmptyDocument("document-child", "Child");
    document.instances.push({
      id: "port-object",
      symbolId: "port",
      placement: null,
    });
    document.nets.push({
      id: "net-vout",

      terminals: [{ instanceId: "port-object", pinName: "P" }],
    });
    document.netlist = {
      name: "Child",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-vout",
          name: "Vout",
          netId: "net-vout",
          direction: "output",
          interfaceInstanceIds: ["port-object"],
        },
      ],
    };
    const annotation: Annotation = {
      id: "instance-label-port-object",
      kind: "instance-label" as const,
      binding: {
        kind: "cell-terminal-name" as const,
        terminalId: "terminal-vout",
      },
      anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };

    expect(resolveAnnotationText(document, annotation)).toEqual(
      semanticTextDocument("Vout", "formal-port"),
    );
    annotation.formatOverride = {
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "V" }],
        },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "out" }],
        },
      ],
    };
    expect(resolveAnnotationText(document, annotation)).toEqual(
      annotation.formatOverride,
    );
    expect(document.netlist.terminals[0]!.name).toBe("Vout");
  });

  it("projects a Net name without touching its movable route anchor", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-vin",

      terminals: [],
    });
    const annotation = {
      id: "net-label-route-1",
      kind: "net-label" as const,
      binding: { kind: "net-name" as const, netId: "net-vin" },
      netId: "net-vin",
      anchor: {
        kind: "route" as const,
        routeId: "route-1",
        legId: "route-1-leg-2",
        t: 0.7,
        normalOffset: 60,
        direction: "reverse" as const,
        orientation: "horizontal" as const,
        fallbackPosition: { x: 120, y: 80 },
      },
      alignment: "middle" as const,
      rotation: 0 as const,
      locked: false,
    };
    document.connectivityEvidence.push({
      id: "claim-vin",
      kind: "name-claim",
      netId: "net-vin",
      name: "V_{in,cm}",
      owner: { kind: "net-label", annotationId: annotation.id },
      scope: "local",
    });

    const before = structuredClone(annotation.anchor);
    expect(flattenRichText(resolveAnnotationText(document, annotation))).toBe(
      "V_{in,cm}",
    );
    expect(flattenRichText(resolveAnnotationText(document, annotation))).toBe(
      "V_{in,cm}",
    );
    const claim = document.connectivityEvidence[0];
    if (claim?.kind === "name-claim") claim.name = "V_{refp}";
    expect(flattenRichText(resolveAnnotationText(document, annotation))).toBe(
      "V_{refp}",
    );
    expect(annotation.anchor).toEqual(before);
  });

  it("keeps a visible master label as ordinary attached text", () => {
    const document = createEmptyDocument("document-main", "Main");
    const annotation = {
      id: "master-M1",
      kind: "instance-label" as const,
      content: semanticTextDocument("sky130_nfet", "instance-label"),
      anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };

    expect(flattenRichText(resolveAnnotationText(document, annotation))).toBe(
      "sky130_nfet",
    );
  });
});

describe("hidden reference prefix display", () => {
  const documentWithResistor = (reference: string) => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "instance-1",
      symbolId: "resistor",
      placement: null,
      reference,
      netlist: { parameters: {} },
    });
    return document;
  };
  const label: Annotation = {
    id: "instance-label-1",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "instance-1" },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
    referencePrefixHidden: true,
  };

  it("draws a conductance-styled Reference while the Reference keeps its prefix", () => {
    const document = documentWithResistor("RG1");
    expect(resolveAnnotationDisplayText(document, label)).toEqual(
      semanticTextDocument("G1", "instance-label"),
    );
    // The semantic projection every non-rendering reader uses is untouched.
    expect(flattenRichText(resolveAnnotationText(document, label))).toBe("RG1");
    expect(document.instances[0]!.reference).toBe("RG1");
  });

  it("shows the whole Reference until the flag is set", () => {
    const document = documentWithResistor("RG1");
    const { referencePrefixHidden: _hidden, ...shown } = label;
    expect(resolveAnnotationDisplayText(document, shown)).toEqual(
      semanticTextDocument("RG1", "instance-label"),
    );
  });

  it("retains authored formatting for the characters that survive", () => {
    const document = documentWithResistor("RG1");
    const formatOverride = {
      runs: [
        {
          kind: "span" as const,
          style: "bold" as const,
          children: [{ kind: "text" as const, value: "RG1" }],
        },
      ],
    };
    expect(
      resolveAnnotationDisplayText(document, { ...label, formatOverride }),
    ).toEqual({
      runs: [
        {
          kind: "span",
          style: "bold",
          children: [{ kind: "text", value: "G1" }],
        },
      ],
    });
  });

  it("refuses to hide a prefix that is the whole Reference or is not there", () => {
    // Hiding `R` from `R` would leave an empty projection, which the canvas
    // reads as "no label" rather than as a shorter one.
    expect(
      flattenRichText(
        resolveAnnotationDisplayText(documentWithResistor("R"), label),
      ),
    ).toBe("R");
    expect(
      flattenRichText(
        resolveAnnotationDisplayText(documentWithResistor("Q1"), label),
      ),
    ).toBe("Q1");
  });

  it("leaves a non-Reference binding alone", () => {
    const document = documentWithResistor("RG1");
    const literal = {
      id: "note",
      kind: "instance-label" as const,
      content: semanticTextDocument("RG1", "instance-label"),
      anchor: { kind: "free" as const, position: { x: 0, y: 0 } },
      alignment: "start" as const,
      rotation: 0 as const,
      locked: false,
    };
    expect(
      flattenRichText(resolveAnnotationDisplayText(document, literal)),
    ).toBe("RG1");
  });
});
