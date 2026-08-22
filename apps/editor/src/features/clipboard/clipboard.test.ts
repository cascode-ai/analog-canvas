import { executeTransaction } from "@icm/edit-engine";
import type { Annotation, Instance } from "@icm/model";
import {
  createEmptyDocument,
  flattenRichText,
  semanticTextDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  clipboardPlacementAnchor,
  clipboardPreviewDocument,
  copyPlacementOrientationEdits,
  copySelection,
  copyWholeDocument,
  proposePaste,
} from "./clipboard";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("schematic clipboard", () => {
  it("copies a formal Port marker onto its existing terminal and Net", () => {
    const document = createEmptyDocument("document-main", "Clipboard");
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.nets.push({
      id: "net-input",
      scope: "local",
      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist = {
      name: "cell",
      terminals: [
        {
          id: "terminal-input",
          name: "VIN",
          netId: "net-input",
          direction: "input",
          interfaceInstanceIds: ["P1"],
        },
      ],
      formalParameters: [],
    };

    const clipboard = copySelection(document, ["P1"]);
    expect(clipboard).not.toBeNull();
    const proposal = proposePaste(document, clipboard!, { x: 80, y: 0 }, 1);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-formal-marker",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.netlist?.terminals[0]?.interfaceInstanceIds).toEqual(
      ["P1", "P1-copy-1"],
    );
    expect(result.document.nets).toHaveLength(1);
    expect(result.document.nets[0]?.terminals).toEqual([
      { instanceId: "P1", pinName: "P" },
      { instanceId: "P1-copy-1", pinName: "P" },
    ]);

    const preview = clipboardPreviewDocument(
      document,
      clipboard!,
      { x: 80, y: 0 },
      [],
      resolver,
    );
    expect(() => buildSvgScene(preview, resolver)).not.toThrow();
  });

  it("duplicates selected components, their named electrical Net, and route atomically", () => {
    const document = createEmptyDocument("document-main", "Clipboard");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          reference: "R1",
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "1k" },
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 240, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        netlist: {
          reference: "R2",
          binding: { kind: "primitive", deviceClass: "resistor" },
          parameters: { value: "2k" },
        },
      },
    );
    document.nets.push({
      id: "net-signal",
      name: "SIGNAL",
      scope: "local",
      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.routes.push({
      id: "route-signal",
      netId: "net-signal",
      from: { kind: "terminal", instanceId: "R1", pinName: "2" },
      to: { kind: "terminal", instanceId: "R2", pinName: "1" },
      waypoints: [{ x: 100, y: 80 }],
      segmentModes: ["manual", "manual"],
    });

    const copied = copySelection(document, ["R1", "R2"]);
    expect(copied?.routes).toHaveLength(1);
    const proposal = proposePaste(document, copied!, { x: 20, y: 20 }, 1);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-1",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances).toHaveLength(4);
    expect(
      result.document.instances.map((instance) => instance.netlist?.reference),
    ).toEqual(["R1", "R2", "R3", "R4"]);
    expect(result.document.routes).toHaveLength(2);
    expect(result.document.nets).toHaveLength(1);
    expect(result.document.nets[0]?.terminals).toHaveLength(4);
    expect(result.document.routes[1]).toMatchObject({
      netId: "net-signal",
      from: { instanceId: "R3" },
      to: { instanceId: "R4" },
    });
    expect(result.document.routes[1]?.waypoints).toEqual([{ x: 120, y: 100 }]);
  });

  it("creates an isolated translated document for a copy-placement ghost", () => {
    const document = createEmptyDocument("document-main", "Preview");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    const clipboard = copySelection(document, ["R1"]);
    expect(clipboard).not.toBeNull();
    expect(clipboardPlacementAnchor(clipboard!)).toEqual({ x: 100, y: 100 });

    const preview = clipboardPreviewDocument(document, clipboard!, {
      x: 40,
      y: -20,
    });
    expect(preview.instances[0]?.placement?.position).toEqual({
      x: 140,
      y: 80,
    });
    expect(document.instances[0]?.placement?.position).toEqual({
      x: 100,
      y: 100,
    });

    const rotatedPreview = clipboardPreviewDocument(
      document,
      clipboard!,
      { x: 40, y: -20 },
      [{ kind: "rotate", deltaDegrees: 90 }],
    );
    expect(rotatedPreview.instances[0]?.placement).toMatchObject({
      position: { x: 140, y: 80 },
      rotation: 90,
    });

    const mirroredPreview = clipboardPreviewDocument(
      document,
      clipboard!,
      { x: 40, y: -20 },
      [{ kind: "reflect", direction: "left-right" }],
    );
    expect(mirroredPreview.instances[0]?.placement).toMatchObject({
      position: { x: 140, y: 80 },
      rotation: 0,
      mirror: "x",
    });
  });

  it("replays copy secondary commands in their input order", () => {
    const instance: Instance = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 90,
        mirror: "none",
      },
    };
    expect(
      copyPlacementOrientationEdits(
        [instance],
        ["R1-copy-1"],
        [
          { kind: "rotate", deltaDegrees: 90 },
          { kind: "reflect", direction: "left-right" },
          { kind: "rotate", deltaDegrees: 90 },
        ],
      ),
    ).toEqual([
      { kind: "rotate_instance", instanceId: "R1-copy-1", rotation: 180 },
      { kind: "mirror_instance", instanceId: "R1-copy-1", mirror: "x" },
      { kind: "rotate_instance", instanceId: "R1-copy-1", rotation: 270 },
    ]);
  });

  it("uses the Edit Engine transform for an already oriented copied label", () => {
    const document = createEmptyDocument("document-main", "Oriented label");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 90,
        mirror: "none",
      },
    });
    document.annotations.push({
      id: "label-r1",
      kind: "instance-label",
      content: semanticTextDocument("R1", "instance-label"),
      anchor: {
        kind: "object",
        objectId: "R1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 100, y: 80 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });
    const clipboard = copySelection(document, ["R1"])!;
    const operations = [{ kind: "rotate", deltaDegrees: 90 } as const];
    const preview = clipboardPreviewDocument(
      document,
      clipboard,
      { x: 40, y: 0 },
      operations,
      resolver,
    );
    const proposal = proposePaste(document, clipboard, { x: 40, y: 0 }, 1);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-oriented-label",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          ...proposal.edits,
          ...copyPlacementOrientationEdits(
            clipboard.instances,
            proposal.instanceIds,
            operations,
          ),
        ],
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const previewInstanceId = preview.instances[0]?.id;
    const previewLabel = preview.annotations.find(
      (annotation) =>
        annotation.anchor.kind === "object" &&
        annotation.anchor.objectId === previewInstanceId,
    );
    const committedLabel = result.document.annotations.find(
      (annotation) => annotation.id === "label-r1-copy-1",
    );
    expect(previewLabel?.anchor).toEqual({
      kind: "object",
      objectId: "R1-copy-0",
      localOffset: { x: 20, y: 0 },
      fallbackPosition: { x: 160, y: 100 },
    });
    expect(committedLabel?.anchor).toEqual({
      kind: "object",
      objectId: "R1-copy-1",
      localOffset: { x: 20, y: 0 },
      fallbackPosition: { x: 160, y: 100 },
    });
  });

  function resistorInstance(
    id: string,
    reference: string | undefined,
  ): Instance {
    return {
      id,
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      ...(reference
        ? {
            schematicReference: reference,
            netlist: { reference, parameters: {} },
          }
        : {}),
    };
  }

  function instanceLabel(instanceId: string, text: string): Annotation {
    return {
      id: `instance-label-${instanceId}`,
      kind: "instance-label",
      // Match production labels: semantic base + subscript runs, not one
      // flat text leaf.
      content: semanticTextDocument(text, "instance-label"),
      anchor: {
        kind: "object",
        objectId: instanceId,
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 100, y: 80 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    };
  }

  it("adopts the incremented reference as the pasted id and label text", () => {
    const document = createEmptyDocument("document-main", "Designator paste");
    document.instances.push(resistorInstance("R1", "R1"));
    document.annotations.push(instanceLabel("R1", "R1"));

    const copied = copySelection(document, ["R1"]);
    const proposal = proposePaste(document, copied!, { x: 20, y: 0 }, 1);
    expect(proposal.instanceIds).toEqual(["R2"]);
    // Executing the paste proves the rewritten label stays schema-valid.
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-designator",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.instances).toHaveLength(2);
    expect(result.document.instances[1]).toMatchObject({
      id: "R2",
      schematicReference: "R2",
      netlist: { reference: "R2" },
    });
    expect(
      result.document.annotations
        .filter((annotation) => annotation.kind === "instance-label")
        .map((annotation) => flattenRichText(annotation.content!)),
    ).toEqual(["R1", "R2"]);
  });

  it("increments batch-copied designators without collisions", () => {
    const document = createEmptyDocument("document-main", "Batch paste");
    document.instances.push(resistorInstance("R1", "R1"));
    document.annotations.push(instanceLabel("R1", "R1"));

    let pasted = proposePaste(
      document,
      copySelection(document, ["R1"])!,
      {
        x: 20,
        y: 0,
      },
      1,
    );
    expect(pasted.instanceIds).toEqual(["R2"]);
    const once = executeTransaction(
      document,
      {
        transactionId: "paste-first",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: pasted.edits,
      },
      { symbolResolver: resolver },
    );
    if (!once.ok) throw new Error("first paste failed");

    pasted = proposePaste(
      once.document,
      copySelection(document, ["R1"])!,
      {
        x: 40,
        y: 0,
      },
      2,
    );
    expect(pasted.instanceIds).toEqual(["R3"]);
  });

  it("preserves hand-edited label text on paste", () => {
    const document = createEmptyDocument("document-main", "Custom label");
    document.instances.push(resistorInstance("R1", "R1"));
    document.annotations.push(instanceLabel("R1", "R_load"));

    const proposal = proposePaste(
      document,
      copySelection(document, ["R1"])!,
      { x: 20, y: 0 },
      1,
    );
    // "R" + subscript "load" is not the copied reference R1, so it survives.
    const pastedLabel = proposal.edits.find(
      (
        edit,
      ): edit is Extract<
        typeof edit,
        { kind: "upsert_schematic_annotation" }
      > => edit.kind === "upsert_schematic_annotation",
    );
    expect(flattenRichText(pastedLabel!.annotation.content!)).toBe("Rload");
    expect(proposal.instanceIds).toEqual(["R2"]);
  });

  it("falls back to an opaque copy id when the source id diverges", () => {
    const document = createEmptyDocument("document-main", "Diverged id");
    document.instances.push(resistorInstance("custom-1", "R1"));
    document.annotations.push(instanceLabel("custom-1", "R1"));

    const proposal = proposePaste(
      document,
      copySelection(document, ["custom-1"])!,
      { x: 20, y: 0 },
      1,
    );
    expect(proposal.instanceIds).toEqual(["custom-1-copy-1"]);
    const pastedInstance = proposal.edits.find(
      (edit): edit is Extract<typeof edit, { kind: "add_instance" }> =>
        edit.kind === "add_instance",
    );
    expect(pastedInstance?.instance.netlist?.reference).toBe("R2");
    const pastedLabel = proposal.edits.find(
      (
        edit,
      ): edit is Extract<
        typeof edit,
        { kind: "upsert_schematic_annotation" }
      > => edit.kind === "upsert_schematic_annotation",
    );
    expect(flattenRichText(pastedLabel!.annotation.content!)).toBe("R2");
  });

  it("remaps an internal NoConnect to the copied instance", () => {
    const document = createEmptyDocument("document-main", "NoConnect copy");
    document.instances.push({
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.noConnects.push({
      id: "nc-r1-1",
      endpoint: { kind: "terminal", instanceId: "R1", pinName: "1" },
    });

    const copied = copySelection(document, ["R1"]);
    expect(copied?.noConnects).toEqual(document.noConnects);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-no-connect",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposePaste(document, copied!, { x: 20, y: 0 }, 1).edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.noConnects).toContainEqual({
      id: "nc-r1-1-copy-1",
      endpoint: { kind: "terminal", instanceId: "R1-copy-1", pinName: "1" },
    });
  });

  it("keeps a copied MOS connected to its shared external bulk Net", () => {
    const document = createEmptyDocument("document-main", "Shared MOS bulk");
    document.instances.push(
      {
        id: "M1",
        symbolId: "nmos",
        mosBulkBinding: { origin: "supply-default", netId: "net-global-0" },
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "M2",
        symbolId: "nmos",
        mosBulkBinding: { origin: "supply-default", netId: "net-global-0" },
        placement: {
          position: { x: 220, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push({
      id: "net-global-0",
      name: "0",
      scope: "global",
      powerDomain: "ground",
      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "M2", pinName: "B" },
      ],
    });

    const copied = copySelection(document, ["M1"]);
    expect(copied?.nets).toEqual([]);
    expect(copied?.boundaryNets).toEqual([
      expect.objectContaining({
        id: "net-global-0",
        terminals: [{ instanceId: "M1", pinName: "B" }],
      }),
    ]);

    const preview = clipboardPreviewDocument(document, copied!, {
      x: 80,
      y: 0,
    });
    expect(() => buildSvgScene(preview, resolver)).not.toThrow();

    const proposal = proposePaste(document, copied!, { x: 80, y: 0 }, 1);
    expect(proposal.errors).toEqual([]);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-shared-mos-bulk",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.nets[0]?.terminals).toEqual([
      { instanceId: "M1", pinName: "B" },
      { instanceId: "M2", pinName: "B" },
      { instanceId: "M1-copy-1", pinName: "B" },
    ]);
    expect(result.document.instances[2]?.mosBulkBinding).toEqual({
      origin: "supply-default",
      netId: "net-global-0",
    });
  });
});

describe("copyWholeDocument", () => {
  it("keeps a Power Rail that no device is wired to yet", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-vdd",
      name: "VDD",
      scope: "local",
      powerDomain: "vdd",
      terminals: [],
      origin: { kind: "authored" },
    });
    document.junctions.push(
      {
        id: "junction-vdd-start",
        netId: "net-vdd",
        position: { x: 10, y: 10 },
        role: "route-anchor",
      },
      {
        id: "junction-vdd-end",
        netId: "net-vdd",
        position: { x: 110, y: 10 },
        role: "route-anchor",
      },
    );
    document.routes.push({
      id: "rail-vdd",
      netId: "net-vdd",
      from: { kind: "junction", junctionId: "junction-vdd-start" },
      to: { kind: "junction", junctionId: "junction-vdd-end" },
      waypoints: [],
      segmentModes: ["manual"],
      presentation: "power-rail",
    });

    // A selection copy keeps only Nets whose every terminal is selected, so a
    // rail with no device on it yet is not part of any selection.
    expect(copySelection(document, [])).toBeNull();

    const whole = copyWholeDocument(document);
    expect(whole?.routes).toHaveLength(1);
    expect(whole?.routes[0]?.presentation).toBe("power-rail");
    expect(whole?.junctions).toHaveLength(2);
    expect(whole?.nets.map((net) => net.name)).toEqual(["VDD"]);
  });
});
