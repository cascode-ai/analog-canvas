import { executeTransaction } from "@icm/edit-engine";
import { defaultVddPowerLabelPlacement } from "@icm/derived";
import { AnnotationSchema, createEmptyDocument } from "@icm/model";
import type { Annotation } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  copyPlacementOrientationEdits,
  copySelection,
  proposePaste,
} from "../clipboard/clipboard";
import { proposedStandalonePowerConnection } from "./placement-connectivity";
import { vddPowerLabelAnnotation } from "./vdd-power-label";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function objectAnchor(annotation: Annotation) {
  if (annotation.anchor.kind !== "object") {
    throw new Error("expected object-anchored annotation");
  }
  return annotation.anchor;
}

describe("vdd power label annotation", () => {
  it("builds a schema-valid power label anchored to the device instance", () => {
    const instance = {
      id: "VDD3",
      symbolId: "vdd-port",
      placement: {
        position: { x: 120, y: 80 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const resolved = resolver.resolve("vdd-port");
    if (!resolved) throw new Error("missing VDD Port Symbol");
    const annotation = vddPowerLabelAnnotation({
      instance,
      resolved,
      netId: "net-power-vdd3",
      grid: 10,
    });
    expect(AnnotationSchema.parse(annotation)).toEqual(annotation);
    expect(annotation).toMatchObject({
      id: "power-label-vdd3",
      kind: "power-label",
      netId: "net-power-vdd3",
      anchor: {
        kind: "object",
        objectId: "VDD3",
      },
    });
    expect(objectAnchor(annotation).fallbackPosition.x).toBeGreaterThan(130);
    expect(annotation.binding).toEqual({
      kind: "net-name",
      netId: "net-power-vdd3",
    });
  });

  it("never collides with the drawn rail label id namespace", () => {
    const instance = {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const resolved = resolver.resolve("vdd-port");
    if (!resolved) throw new Error("missing VDD Port Symbol");
    const annotation = vddPowerLabelAnnotation({
      instance,
      resolved,
      netId: "net-power-vdd1",
      grid: 10,
    });
    // The rail owns `label-VDDn`; the device label must not upsert over it.
    expect(annotation.id).not.toBe("label-VDD1");
  });

  it("commits together with the standalone power connection edits", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const proposal = proposedStandalonePowerConnection(document, instance);
    const powerNetId = proposal.powerNetId;
    expect(powerNetId).toBeDefined();
    const resolved = resolver.resolve("vdd-port");
    if (!resolved) throw new Error("missing VDD Port Symbol");
    const result = executeTransaction(
      document,
      {
        transactionId: "vdd-label-test",
        documentId: "main",
        expectedRevision: 0,
        actor: { kind: "human" as const, id: "test" },
        dryRun: false,
        edits: [
          { kind: "add_instance", instance },
          ...proposal.edits,
          {
            kind: "upsert_schematic_annotation",
            annotation: vddPowerLabelAnnotation({
              instance,
              resolved,
              netId: powerNetId!,
              grid: document.presentation.grid,
            }),
          },
        ],
      },
      { symbolResolver: resolver },
    );
    expect(
      result.ok,
      result.ok ? undefined : JSON.stringify(result.diagnostics),
    ).toBe(true);
    if (!result.ok) return;
    expect(result.document.annotations).toHaveLength(1);
    expect(result.document.annotations[0]).toMatchObject({
      id: "power-label-vdd1",
      kind: "power-label",
      netId: "net-power-vdd1",
    });
  });

  it("keeps an untouched VDD Port label upright and clear through orientation changes", () => {
    let document = createEmptyDocument("main", "Main");
    const instance = {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const resolved = resolver.resolve("vdd-port");
    if (!resolved) throw new Error("missing VDD Port Symbol");
    document.instances.push(instance);
    document.nets.push({
      id: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.annotations.push(
      vddPowerLabelAnnotation({
        instance,
        resolved,
        netId: "net-vdd",
        grid: document.presentation.grid,
      }),
    );

    for (const edit of [
      {
        kind: "rotate_instance" as const,
        instanceId: "VDD1",
        rotation: 90 as const,
      },
      {
        kind: "mirror_instance" as const,
        instanceId: "VDD1",
        mirror: "x" as const,
      },
      {
        kind: "rotate_instance" as const,
        instanceId: "VDD1",
        rotation: 180 as const,
      },
      {
        kind: "rotate_instance" as const,
        instanceId: "VDD1",
        rotation: 270 as const,
      },
      {
        kind: "rotate_instance" as const,
        instanceId: "VDD1",
        rotation: 0 as const,
      },
    ]) {
      const result = executeTransaction(
        document,
        {
          transactionId: `orient-${document.revision}`,
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          dryRun: false,
          edits: [edit],
        },
        { symbolResolver: resolver },
      );
      expect(
        result.ok,
        result.ok ? undefined : JSON.stringify(result.diagnostics),
      ).toBe(true);
      if (!result.ok) return;
      document = result.document;
      const expected = defaultVddPowerLabelPlacement(
        document.instances[0]!,
        resolved,
        document.presentation.grid,
      );
      const annotation = document.annotations[0]!;
      expect(expected).not.toBeNull();
      expect(objectAnchor(annotation).fallbackPosition).toEqual(
        expected?.position,
      );
      expect(annotation).toMatchObject({
        alignment: "start",
        rotation: 0,
      });
    }
  });

  it("keeps a copied VDD Port label upright through two rotations", () => {
    let document = createEmptyDocument("main", "Main");
    const instance = {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const resolved = resolver.resolve("vdd-port");
    if (!resolved) throw new Error("missing VDD Port Symbol");
    document.instances.push(instance);
    document.nets.push({
      id: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.annotations.push(
      vddPowerLabelAnnotation({
        instance,
        resolved,
        netId: "net-vdd",
        grid: document.presentation.grid,
      }),
    );

    // Copy through the real clipboard path, so the pasted label carries
    // whatever identity and offsets a person's Ctrl-C / Ctrl-V would give it.
    const clipboard = copySelection(document, ["VDD1"]);
    expect(clipboard).not.toBeNull();
    const paste = proposePaste(document, clipboard!, { x: 80, y: 0 }, 1);
    const pasted = executeTransaction(
      document,
      {
        transactionId: "paste-vdd",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: paste.edits,
      },
      { symbolResolver: resolver },
    );
    if (!pasted.ok) throw new Error(JSON.stringify(pasted.diagnostics));
    document = pasted.document;
    const copyId = paste.instanceIds[0]!;

    for (const rotation of [90, 180] as const) {
      const result = executeTransaction(
        document,
        {
          transactionId: `turn-${rotation}`,
          documentId: document.id,
          expectedRevision: document.revision,
          actor: { kind: "human", id: "test" },
          edits: [{ kind: "rotate_instance", instanceId: copyId, rotation }],
        },
        { symbolResolver: resolver },
      );
      expect(
        result.ok,
        result.ok ? undefined : JSON.stringify(result.diagnostics),
      ).toBe(true);
      if (!result.ok) return;
      document = result.document;

      const copy = document.instances.find(
        (candidate) => candidate.id === copyId,
      )!;
      const label = document.annotations.find(
        (candidate) =>
          candidate.anchor.kind === "object" &&
          candidate.anchor.objectId === copyId,
      )!;
      // Turning the symbol must never turn its name over: at 180° a rotated
      // label reads upside down, which is exactly what a reader cannot do.
      expect(label.rotation).toBe(0);
      const expected = defaultVddPowerLabelPlacement(
        copy,
        resolved,
        document.presentation.grid,
      );
      expect(expected).not.toBeNull();
      // The drawn glyph and its stored anchor must stay the same place, or
      // the selection box detaches from the text it is supposed to frame.
      expect(objectAnchor(label).fallbackPosition).toEqual(expected?.position);
      expect(label.alignment).toBe(expected?.alignment);
    }
  });

  it("keeps a VDD Port label upright when the copy is turned before it lands", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const resolved = resolver.resolve("vdd-port");
    if (!resolved) throw new Error("missing VDD Port Symbol");
    document.instances.push(instance);
    document.nets.push({
      id: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.annotations.push(
      vddPowerLabelAnnotation({
        instance,
        resolved,
        netId: "net-vdd",
        grid: document.presentation.grid,
      }),
    );

    const clipboard = copySelection(document, ["VDD1"]);
    expect(clipboard).not.toBeNull();
    const paste = proposePaste(document, clipboard!, { x: 80, y: 0 }, 1);
    // Pressing R twice while the copy is still on the pointer commits the
    // turns in the SAME transaction as the paste, which is the shape the
    // editor actually submits (use-selection-interaction).
    const orientation = copyPlacementOrientationEdits(
      clipboard!.instances,
      paste.instanceIds,
      [
        { kind: "rotate", deltaDegrees: 90 },
        { kind: "rotate", deltaDegrees: 90 },
      ],
    );
    const result = executeTransaction(
      document,
      {
        transactionId: "copy-turned-twice",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [...paste.edits, ...orientation],
      },
      { symbolResolver: resolver },
    );
    expect(
      result.ok,
      result.ok ? undefined : JSON.stringify(result.diagnostics),
    ).toBe(true);
    if (!result.ok) return;

    const copyId = paste.instanceIds[0]!;
    const copy = result.document.instances.find(
      (candidate) => candidate.id === copyId,
    )!;
    expect(copy.placement?.rotation).toBe(180);
    const label = result.document.annotations.find(
      (candidate) =>
        candidate.anchor.kind === "object" &&
        candidate.anchor.objectId === copyId,
    )!;
    // Turning the symbol must never turn its name over: at 180 degrees a
    // rotated label reads upside down, which is what a reader cannot do.
    expect(label.rotation).toBe(0);
    const expected = defaultVddPowerLabelPlacement(
      copy,
      resolved,
      result.document.presentation.grid,
    );
    expect(expected).not.toBeNull();
    // The drawn glyph and its stored anchor must agree, or the selection box
    // detaches from the text it is supposed to frame.
    expect(objectAnchor(label).fallbackPosition).toEqual(expected?.position);
    expect(label.alignment).toBe(expected?.alignment);
  });

  it("does not pull a user-moved VDD Port label back to the automatic position", () => {
    const document = createEmptyDocument("main", "Main");
    const instance = {
      id: "VDD1",
      symbolId: "vdd-port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    const resolved = resolver.resolve("vdd-port");
    if (!resolved) throw new Error("missing VDD Port Symbol");
    const annotation = vddPowerLabelAnnotation({
      instance,
      resolved,
      netId: "net-vdd",
      grid: document.presentation.grid,
    });
    if (annotation.anchor.kind !== "object")
      throw new Error("object anchor required");
    annotation.anchor.localOffset.x += document.presentation.grid;
    annotation.anchor.fallbackPosition.x += document.presentation.grid;
    document.instances.push(instance);
    document.nets.push({
      id: "net-vdd",
      name: "VDD",
      scope: "global",
      powerDomain: "vdd",
      terminals: [],
    });
    document.annotations.push(annotation);

    const result = executeTransaction(
      document,
      {
        transactionId: "rotate-user-label",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        dryRun: false,
        edits: [{ kind: "rotate_instance", instanceId: "VDD1", rotation: 90 }],
      },
      { symbolResolver: resolver },
    );
    expect(
      result.ok,
      result.ok ? undefined : JSON.stringify(result.diagnostics),
    ).toBe(true);
    if (!result.ok) return;
    const expected = defaultVddPowerLabelPlacement(
      result.document.instances[0]!,
      resolved,
      result.document.presentation.grid,
    );
    expect(
      objectAnchor(result.document.annotations[0]!).fallbackPosition,
    ).not.toEqual(expected?.position);
  });
});
