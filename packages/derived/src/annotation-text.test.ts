import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { diagnoseCell } from "./diagnostics/diagnostic.js";
import { diagnoseLabelClearance } from "./label-clearance.js";
import {
  createEmptyDocument,
  createEmptyProject,
  createAnnotationNameClaimReader,
  plainNameDocument,
  boundAnnotationName,
  freezeSnapshot,
  flattenRichText,
  labelTextDocument,
  semanticTextDocument,
  type Annotation,
} from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  resolveAnnotationName,
  resolveAnnotationText,
} from "./annotation-text.js";
import { resolveDocumentLogicalNets } from "./logical-net.js";

describe("bound annotation text", () => {
  it.each(["snapshot", "mutable proposal"] as const)(
    "scopes annotation name reads to the current Net of a %s",
    (source) => {
      const resolver = new InMemorySymbolResolver(builtInSymbols);
      function countReads(count: number) {
        const project = createEmptyProject("p", "Names", "d");
        const doc = project.documents[0]!;
        let reads = 0;
        for (let i = 0; i < count; i++) {
          const netId = `n${i}`;
          const id = `label${i}`;
          doc.nets.push({ id: netId, terminals: [] });
          doc.junctions.push({
            id: `j${i}`,
            netId,
            position: { x: i * 50, y: 0 },
          });
          doc.annotations.push({
            id,
            kind: "net-label",
            netId,
            binding: { kind: "net-name", netId },
            anchor: {
              kind: "object",
              objectId: `j${i}`,
              localOffset: { x: 0, y: 5 },
              fallbackPosition: { x: i * 50, y: 5 },
            },
            rotation: 0,
            alignment: "start",
            locked: false,
          });
          doc.connectivityEvidence.push({
            kind: "name-claim",
            id: `claim${i}`,
            name: netId,
            scope: "local",
            get netId() {
              reads++;
              return netId;
            },
            owner: { kind: "net-label", annotationId: id },
          });
        }
        if (source === "mutable proposal") {
          diagnoseCell(project, doc, resolver);
          diagnoseLabelClearance(doc, resolver);
          return reads;
        }
        freezeSnapshot(doc);
        const logical = resolveDocumentLogicalNets(doc);
        reads = 0;
        for (const annotation of doc.annotations) {
          expect(boundAnnotationName(doc, annotation)).toBe(annotation.netId);
          expect(
            flattenRichText(resolveAnnotationText(doc, annotation, logical)),
          ).toBe(annotation.netId);
        }
        return reads;
      }
      expect(countReads(64)).toBeLessThanOrEqual(5 * countReads(16));
    },
  );

  it("gives callers the matching fact while keeping snapshot claim buckets private", () => {
    const doc = createEmptyDocument("d", "Read claims");
    const evidence = {
      id: "claim",
      kind: "name-claim" as const,
      netId: "n",
      scope: "local" as const,
      name: "SIG",
      owner: { kind: "net-label" as const, annotationId: "label" },
    };
    doc.connectivityEvidence.push(evidence);
    const read = createAnnotationNameClaimReader(freezeSnapshot(doc));
    expect(
      read("n", (...args) => {
        expect(args).toEqual([evidence]);
        return true;
      }),
    ).toBe(evidence);
    expect(read("missing", () => true)).toBeUndefined();
  });

  it("preserves the first eligible power owner separately for bound and displayed text on an edited draft", () => {
    const doc = createEmptyDocument("d", "Power owners");
    const shape: Annotation = {
      id: "rail",
      kind: "power-label",
      netId: "supply",
      binding: { kind: "net-name", netId: "supply" },
      anchor: {
        kind: "object",
        objectId: "port",
        localOffset: { x: 0, y: 0 },
        fallbackPosition: { x: 0, y: 0 },
      },
      rotation: 0,
      alignment: "start",
      locked: false,
    };
    doc.nets.push({ id: "supply", terminals: [] });
    doc.annotations.push(shape);
    for (const [netId, objectId, name] of [
      ["other", "port", "WRONG"],
      ["supply", "rail", "RAIL"],
      ["supply", "port", "PORT"],
    ] as const) {
      doc.connectivityEvidence.push({
        id: name,
        netId,
        kind: "name-claim",
        name,
        scope: "global",
        owner: { kind: "power-marker", objectId },
      });
    }
    expect(boundAnnotationName({}, shape)).toBe("");
    expect(boundAnnotationName(doc, shape)).toBe("RAIL");
    expect(flattenRichText(resolveAnnotationText(doc, shape))).toBe("PORT");
    doc.connectivityEvidence.reverse();
    expect(boundAnnotationName(doc, shape)).toBe("PORT");
    doc.connectivityEvidence.splice(0, 1);
    expect(flattenRichText(resolveAnnotationText(doc, shape))).toBe("RAIL");
  });

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
      labelTextDocument("M_INTERNAL", document.presentation),
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
      labelTextDocument("R7", document.presentation),
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
      labelTextDocument("Vout", document.presentation),
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
  });

  it("shows a same-text Value look but never a stale electrical value", () => {
    const document = createEmptyDocument("value-look", "Value look");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: null,
      netlist: { parameters: { value: "RL" } },
    });
    const formatOverride = {
      runs: [
        { kind: "text" as const, value: "R" },
        {
          kind: "span" as const,
          style: "subscript" as const,
          children: [{ kind: "text" as const, value: "L" }],
        },
      ],
    };
    const annotation: Annotation = {
      id: "R1-value",
      kind: "instance-value",
      binding: { kind: "instance-value", instanceId: "R1" },
      formatOverride,
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    expect(resolveAnnotationText(document, annotation)).toEqual(formatOverride);
    document.instances[0]!.netlist!.parameters.value = "RD";
    expect(flattenRichText(resolveAnnotationText(document, annotation))).toBe(
      "RD",
    );
    expect(resolveAnnotationText(document, annotation)).not.toEqual(
      formatOverride,
    );
  });

  it("projects a Net's current name", () => {
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

    expect(resolveAnnotationName(document, annotation)).toBe("V_{in,cm}");
    const claim = document.connectivityEvidence[0];
    if (claim?.kind === "name-claim") claim.name = "V_{refp}";
    expect(resolveAnnotationName(document, annotation)).toBe("V_{refp}");
  });

  it("names a Net label's alias by its Net name, never by the text it shows (#1880)", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({ id: "net-ea", terminals: [] });
    const annotation: Annotation = {
      id: "label-ea",
      kind: "net-label",
      content: plainNameDocument("VEA,OUT"),
      netId: "net-ea",
      anchor: { kind: "free", position: { x: 0, y: 0 } },
      alignment: "start",
      rotation: 0,
      locked: false,
    };
    document.connectivityEvidence.push({
      id: "claim-ea",
      kind: "name-claim",
      netId: "net-ea",
      name: "VEA_OUT",
      owner: { kind: "net-label", annotationId: annotation.id },
      scope: "local",
    });

    expect(flattenRichText(resolveAnnotationText(document, annotation))).toBe(
      "VEA,OUT",
    );
    expect(resolveAnnotationName(document, annotation)).toBe("VEA_OUT");
  });
});

it("uses the saved slant for generated subscripts while preserving explicit per-label formatting", () => {
  const document = createEmptyDocument("slant", "Slant");
  document.instances.push({
    id: "R1",
    reference: "R_load",
    symbolId: "resistor",
    placement: null,
  });
  document.presentation.labelSubscriptItalic = false;
  const annotation: Annotation = {
    id: "label",
    kind: "instance-label",
    binding: { kind: "instance-reference", instanceId: "R1" },
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    alignment: "start",
    rotation: 0,
    locked: false,
  };
  expect(resolveAnnotationText(document, annotation).runs[1]).toEqual({
    kind: "span",
    style: "subscript",
    children: [
      {
        kind: "span",
        style: "bold",
        children: [{ kind: "text", value: "load" }],
      },
    ],
  });
  annotation.formatOverride = semanticTextDocument("R_load", "instance-label");
  expect(resolveAnnotationText(document, annotation)).toEqual(
    annotation.formatOverride,
  );
});
