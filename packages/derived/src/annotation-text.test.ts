import {
  createEmptyDocument,
  flattenRichText,
  semanticTextDocument,
  type Annotation,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import { resolveAnnotationText } from "./annotation-text.js";

describe("bound annotation text", () => {
  it("uses RichText schematicName for the default label and keeps the designator separate", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: null,
      schematicReference: "M_SCHEMATIC",
      netlist: { reference: "M_INTERNAL", parameters: {} },
      schematicName: {
        runs: [
          {
            kind: "span",
            style: "bold",
            children: [{ kind: "text", value: "M" }],
          },
          {
            kind: "span",
            style: "overbar",
            children: [{ kind: "text", value: "1" }],
          },
        ],
      },
    });
    const annotation: Annotation = {
      id: "instance-label-M1",
      kind: "instance-label" as const,
      binding: { kind: "instance-designator" as const, instanceId: "M1" },
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
        binding: { kind: "instance-schematic-name", instanceId: "M1" },
      }),
    ).toEqual(document.instances[0]!.schematicName);
    expect(document.instances[0]!.netlist!.reference).toBe("M_INTERNAL");
  });

  it("falls back from an unmaterialized schematic label without exposing the object ID", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "opaque-object-id",
      symbolId: "resistor",
      placement: null,
      schematicReference: "R7",
      netlist: { reference: "R_NETLIST", parameters: {} },
    });
    const annotation = {
      id: "instance-label-R7",
      kind: "instance-label" as const,
      binding: {
        kind: "instance-schematic-name" as const,
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
    delete document.instances[0]!.schematicReference;
    expect(resolveAnnotationText(document, annotation)).toEqual(
      semanticTextDocument("R_NETLIST", "instance-label"),
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

  it("projects a master name without falling back to the internal object ID", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.instances.push({
      id: "opaque-object-id",
      symbolId: "nmos",
      placement: null,
      netlist: {
        reference: "M1",
        binding: { kind: "model", deviceClass: "mos", name: "sky130_nfet" },
        parameters: {},
      },
    });
    const annotation = {
      id: "master-M1",
      kind: "instance-label" as const,
      binding: {
        kind: "instance-master-name" as const,
        instanceId: "opaque-object-id",
      },
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
