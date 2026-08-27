import { createRoutePath, routeBends, routeEnd } from "@icm/model";
import { executeTransaction } from "@icm/edit-engine";
import { resolveDocumentLogicalNets } from "@icm/derived";
import type { Annotation, Instance } from "@icm/model";
import {
  createEmptyDocument,
  flattenRichText,
  semanticTextDocument,
} from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";
import { createLibraryExampleProject } from "../../examples/library-examples";

import {
  clipboardPlacementAnchor,
  clipboardPreviewDocument,
  copyPlacementOrientationEdits,
  orientClipboard,
  copySelection,
  copyWholeDocument,
  proposePaste,
} from "./clipboard";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("schematic clipboard", () => {
  it("copies a Cell Pin with an independent interface and Base Net", () => {
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
    document.annotations.push({
      id: "cell-pin-label-p1",
      kind: "instance-label",
      binding: {
        kind: "cell-terminal-name",
        terminalId: "terminal-input",
      },
      anchor: {
        kind: "object",
        objectId: "P1",
        localOffset: { x: 0, y: -20 },
        fallbackPosition: { x: 100, y: 80 },
      },
      alignment: "middle",
      rotation: 0,
      locked: false,
    });

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

    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    const originalTerminal = result.document.netlist?.terminals.find(
      (terminal) => terminal.id === "terminal-input",
    );
    const copiedTerminal = result.document.netlist?.terminals.find((terminal) =>
      terminal.interfaceInstanceIds.includes("P1-copy-1"),
    );
    expect(originalTerminal).toMatchObject({
      name: "VIN",
      netId: "net-input",
      direction: "input",
      interfaceInstanceIds: ["P1"],
    });
    expect(copiedTerminal).toMatchObject({
      name: "VIN",
      direction: "input",
      interfaceInstanceIds: ["P1-copy-1"],
    });
    expect(copiedTerminal?.id).not.toBe(originalTerminal?.id);
    expect(copiedTerminal?.netId).not.toBe(originalTerminal?.netId);
    expect(result.document.nets).toHaveLength(2);
    expect(
      result.document.annotations.find(
        (annotation) =>
          annotation.anchor.kind === "object" &&
          annotation.anchor.objectId === "P1-copy-1",
      )?.binding,
    ).toEqual({
      kind: "cell-terminal-name",
      terminalId: copiedTerminal?.id,
    });

    const rename = executeTransaction(
      result.document,
      {
        transactionId: "rename-copied-formal-pin",
        documentId: result.document.id,
        expectedRevision: result.document.revision,
        actor: { kind: "human", id: "test" },
        edits: [
          {
            kind: "update_cell_terminal",
            terminalId: copiedTerminal!.id,
            name: "VIN_COPY_RENAMED",
            direction: "output",
          },
        ],
      },
      { symbolResolver: resolver },
    );
    if (!rename.ok) throw new Error(JSON.stringify(rename, null, 2));
    expect(
      rename.document.netlist?.terminals.find(
        (terminal) => terminal.id === "terminal-input",
      ),
    ).toMatchObject({ name: "VIN", direction: "input" });
    expect(
      rename.document.netlist?.terminals.find(
        (terminal) => terminal.id === copiedTerminal?.id,
      ),
    ).toMatchObject({ name: "VIN_COPY_RENAMED", direction: "output" });

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

      terminals: [
        { instanceId: "R1", pinName: "2" },
        { instanceId: "R2", pinName: "1" },
      ],
    });
    document.connectivityEvidence.push({
      id: "claim-signal",
      kind: "name-claim",
      netId: "net-signal",
      name: "SIGNAL",
      scope: "local",
      owner: { kind: "explicit-net-property" },
    });
    document.routes.push(
      createRoutePath({
        id: "route-signal",
        netId: "net-signal",
        start: { kind: "terminal", instanceId: "R1", pinName: "2" },
        end: { kind: "terminal", instanceId: "R2", pinName: "1" },
        bends: [{ x: 100, y: 80 }],
        modes: ["manual", "manual"],
      }),
    );

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
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) return;
    expect(result.document.instances).toHaveLength(4);
    expect(
      result.document.instances.map((instance) => instance.netlist?.reference),
    ).toEqual(["R1", "R2", "R3", "R4"]);
    expect(result.document.routes).toHaveLength(2);
    expect(result.document.nets).toHaveLength(2);
    expect(resolveDocumentLogicalNets(result.document).groups).toHaveLength(1);
    expect(result.document.routes[1]).toMatchObject({
      netId: "net-signal-copy-1",
      start: { instanceId: "R3" },
    });
    expect(routeEnd(result.document.routes[1]!)).toMatchObject({
      instanceId: "R4",
    });
    expect(routeBends(result.document.routes[1]!)).toEqual([
      { x: 120, y: 100 },
    ]);
    const repeatedPreview = clipboardPreviewDocument(
      result.document,
      copied!,
      { x: 40, y: 40 },
      [],
      resolver,
      2,
    );
    expect(repeatedPreview.instances).toHaveLength(2);
    expect(() => buildSvgScene(repeatedPreview, resolver)).not.toThrow();
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

  it("does not inherit reference-bearing metadata outside the copied fragment", () => {
    const document = createEmptyDocument("document-main", "Preview");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    document.nets.push(
      {
        id: "net-r1",

        terminals: [{ instanceId: "R1", pinName: "1" }],
      },
      {
        id: "net-r2",

        terminals: [{ instanceId: "R2", pinName: "1" }],
      },
    );
    document.connectivityEvidence.push(
      {
        id: "claim-r1",
        kind: "name-claim",
        netId: "net-r1",
        name: "N1",
        scope: "local",
        owner: { kind: "explicit-net-property" },
      },
      {
        id: "claim-r2",
        kind: "name-claim",
        netId: "net-r2",
        name: "N2",
        scope: "local",
        owner: { kind: "explicit-net-property" },
      },
    );
    document.mosBulkDefaults = { nmosNetId: "net-r2" };
    document.layoutGroups.push({
      id: "group-r2",
      kind: "custom",
      objectIds: ["R2"],
      locked: false,
    });
    document.constraints.push({
      id: "align-r1-r2",
      kind: "align-y",
      objectIds: ["R1", "R2"],
      locked: false,
    });

    const clipboard = copySelection(document, ["R1"]);
    expect(clipboard).not.toBeNull();
    const preview = clipboardPreviewDocument(document, clipboard!, {
      x: 40,
      y: 0,
    });

    expect(preview.connectivityEvidence).toEqual([
      expect.objectContaining({ id: "claim-r1", netId: "net-r1" }),
    ]);
    expect(preview.mosBulkDefaults).toBeUndefined();
    expect(preview.layoutGroups).toEqual([]);
    expect(preview.constraints).toEqual([]);
    expect(preview.netlist).toBeUndefined();
    expect(() => buildSvgScene(preview, resolver)).not.toThrow();
  });

  it("orients a copied group as one rigid body about its anchor", () => {
    const document = createEmptyDocument("document-main", "Rigid copy");
    document.instances.push(
      {
        id: "R1",
        symbolId: "resistor",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "R2",
        symbolId: "resistor",
        placement: {
          position: { x: 200, y: 140 },
          rotation: 0,
          mirror: "none",
        },
      },
    );
    const clipboard = copySelection(document, ["R1", "R2"]);
    expect(clipboard).not.toBeNull();

    // Left-right reflection about the anchor (R1's origin): R2 lands the
    // mirrored distance on the other side and both parts flip; the layout
    // reflects instead of each part spinning in place.
    const mirrored = orientClipboard(clipboard!, [
      { kind: "reflect", direction: "left-right" },
    ]);
    expect(mirrored.instances.map((instance) => instance.placement)).toEqual([
      { position: { x: 100, y: 100 }, rotation: 0, mirror: "x" },
      { position: { x: 0, y: 140 }, rotation: 0, mirror: "x" },
    ]);

    // A quarter turn orbits R2 around the anchor while both parts turn.
    const turned = orientClipboard(clipboard!, [
      { kind: "rotate", deltaDegrees: 90 },
    ]);
    expect(turned.instances.map((instance) => instance.placement)).toEqual([
      { position: { x: 100, y: 100 }, rotation: 90, mirror: "none" },
      { position: { x: 60, y: 200 }, rotation: 90, mirror: "none" },
    ]);
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
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
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

  it("keeps an implicit copied MOS bulk binding as a Cell-policy exception", () => {
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

      terminals: [
        { instanceId: "M1", pinName: "B" },
        { instanceId: "M2", pinName: "B" },
      ],
    });

    const copied = copySelection(document, ["M1"]);
    expect(copied?.nets).toEqual([]);

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
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
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

  it("leaves an ordinary copied boundary terminal disconnected", () => {
    const document = createEmptyDocument("document-main", "Boundary copy");
    document.instances.push(
      { id: "R1", symbolId: "resistor", placement: null },
      { id: "R2", symbolId: "resistor", placement: null },
    );
    document.nets.push({
      id: "signal",
      terminals: [
        { instanceId: "R1", pinName: "1" },
        { instanceId: "R2", pinName: "1" },
      ],
    });

    const copied = copySelection(document, ["R1"]);
    const proposal = proposePaste(document, copied!, { x: 20, y: 0 }, 1);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-boundary-open",
        documentId: document.id,
        expectedRevision: 0,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      result.document.nets.some((net) =>
        net.terminals.some((terminal) => terminal.instanceId === "R1-copy-1"),
      ),
    ).toBe(false);
  });
});

describe("copyWholeDocument", () => {
  it("keeps a Power Rail that no device is wired to yet", () => {
    const document = createEmptyDocument("document-main", "Main");
    document.nets.push({
      id: "net-vdd",

      terminals: [],
    });
    document.connectivityEvidence.push({
      id: "claim-vdd",
      kind: "name-claim",
      netId: "net-vdd",
      name: "VDD",
      owner: { kind: "explicit-net-property" },
      scope: "global",
      powerDomain: "vdd",
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
    document.routes.push(
      createRoutePath({
        id: "rail-vdd",
        netId: "net-vdd",
        start: { kind: "junction", junctionId: "junction-vdd-start" },
        end: { kind: "junction", junctionId: "junction-vdd-end" },
        bends: [],
        modes: ["manual"],
        presentation: "power-rail",
      }),
    );

    // A selection copy keeps only Nets whose every terminal is selected, so a
    // rail with no device on it yet is not part of any selection.
    expect(copySelection(document, [])).toBeNull();

    const whole = copyWholeDocument(document);
    expect(whole?.routes).toHaveLength(1);
    expect(whole?.routes[0]?.presentation).toBe("power-rail");
    expect(whole?.junctions).toHaveLength(2);
    expect(whole?.connectivityEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "name-claim", name: "VDD" }),
      ]),
    );
  });

  it("retains migrated Power Rail name claims when inserting an example", () => {
    const example = createLibraryExampleProject("common-source-amplifier");
    expect(example).not.toBeNull();
    const clipboard = copyWholeDocument(example!.documents[0]!);
    expect(clipboard).not.toBeNull();
    const target = createEmptyDocument("target", "Target");
    const proposal = proposePaste(target, clipboard!, { x: 20, y: 20 }, 1);
    expect(proposal.errors).toEqual([]);
    const result = executeTransaction(
      target,
      {
        transactionId: "paste-example",
        documentId: target.id,
        expectedRevision: target.revision,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(JSON.stringify(result, null, 2));
    expect(
      [...resolveDocumentLogicalNets(result.document).groups].some(
        (logicalNet) => logicalNet.name === "VDD",
      ),
    ).toBe(true);
  });
});

describe("a copy stands on its own", () => {
  it("gives a device without a netlist block a fresh designator", () => {
    const document = createEmptyDocument("document-main", "Copy");
    // An ideal switch carries a schematic reference but no netlist block, so
    // the reference sequence never allocated it a fresh designator and the
    // internal copy id leaked onto the canvas as "X1-copy-3".
    document.instances.push({
      id: "X1",
      symbolId: "ideal-switch",
      schematicReference: "X1",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });

    const clipboard = copySelection(document, ["X1"]);
    expect(clipboard).not.toBeNull();
    const proposal = proposePaste(document, clipboard!, { x: 80, y: 0 }, 3);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-switch",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    const copy = result.document.instances.find(
      (instance) => instance.id === proposal.instanceIds[0],
    )!;
    expect(copy.schematicReference).toBe("X2");
    expect(copy.schematicReference).not.toMatch(/copy/u);
  });

  it("keeps a copied Cell Pin separate from its source", () => {
    const document = createEmptyDocument("document-main", "Copy");
    document.instances.push({
      id: "P1",
      symbolId: "port",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror: "none" },
    });
    document.nets.push({
      id: "net-p12",

      terminals: [{ instanceId: "P1", pinName: "P" }],
    });
    document.netlist = {
      name: "Copy",
      formalParameters: [],
      terminals: [
        {
          id: "terminal-p12",
          name: "P12",
          netId: "net-p12",
          direction: "passive",
          interfaceInstanceIds: ["P1"],
        },
      ],
    };

    const clipboard = copySelection(document, ["P1"]);
    expect(clipboard).not.toBeNull();
    const proposal = proposePaste(document, clipboard!, { x: 120, y: 0 }, 1);
    const result = executeTransaction(
      document,
      {
        transactionId: "paste-port",
        documentId: document.id,
        expectedRevision: document.revision,
        actor: { kind: "human", id: "test" },
        edits: proposal.edits,
      },
      { symbolResolver: resolver },
    );
    if (!result.ok) throw new Error(JSON.stringify(result.diagnostics));

    const copyId = proposal.instanceIds[0]!;
    const netOf = (instanceId: string) =>
      result.document.nets.find((net) =>
        net.terminals.some((terminal) => terminal.instanceId === instanceId),
      );
    expect(netOf("P1")?.id).not.toBe(netOf(copyId)?.id);
    expect(
      result.document.netlist?.terminals.find((terminal) =>
        terminal.interfaceInstanceIds.includes(copyId),
      )?.name,
    ).toBe("P12");

    const secondProposal = proposePaste(
      result.document,
      clipboard!,
      { x: 240, y: 0 },
      2,
    );
    const secondResult = executeTransaction(
      result.document,
      {
        transactionId: "paste-port-again",
        documentId: result.document.id,
        expectedRevision: result.document.revision,
        actor: { kind: "human", id: "test" },
        edits: secondProposal.edits,
      },
      { symbolResolver: resolver },
    );
    if (!secondResult.ok)
      throw new Error(JSON.stringify(secondResult.diagnostics));
    const secondCopyId = secondProposal.instanceIds[0]!;
    expect(
      secondResult.document.netlist?.terminals.find((terminal) =>
        terminal.interfaceInstanceIds.includes(secondCopyId),
      )?.name,
    ).toBe("P12");
  });
});
