import { executeTransaction } from "@icm/edit-engine";
import { createEmptyDocument } from "@icm/model";
import { buildSvgScene } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import {
  clipboardPlacementAnchor,
  clipboardPreviewDocument,
  copySelection,
  proposePaste,
} from "./clipboard";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("schematic clipboard", () => {
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
        properties: {},
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
        properties: {},
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
      from: { instanceId: "R1-copy-1" },
      to: { instanceId: "R2-copy-1" },
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
      properties: {},
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
      90,
    );
    expect(rotatedPreview.instances[0]?.placement).toMatchObject({
      position: { x: 140, y: 80 },
      rotation: 90,
    });
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
      properties: {},
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
        properties: {},
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
        properties: {},
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
