// @vitest-environment jsdom
import { executeTransaction } from "@icm/edit-engine";
import { createEmptyDocument, flattenRichText } from "@icm/model";
import type { Annotation, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import { createAnnotationDragController } from "./annotation-drag-controller";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function createDragSvgTarget(): { svg: SVGSVGElement; target: SVGRectElement } {
  const svg = globalThis.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "svg",
  );
  const target = globalThis.document.createElementNS(
    "http://www.w3.org/2000/svg",
    "rect",
  );
  let captured: number | null = null;
  target.setPointerCapture = (pointerId: number) => {
    captured = pointerId;
  };
  target.releasePointerCapture = (pointerId: number) => {
    if (captured === pointerId) captured = null;
  };
  target.hasPointerCapture = (pointerId: number) => captured === pointerId;
  svg.appendChild(target);
  globalThis.document.body.appendChild(svg);
  return { svg, target };
}

function pointerDownEvent(
  target: SVGRectElement,
  clientX: number,
  clientY: number,
) {
  return {
    button: 0,
    pointerId: 1,
    clientX,
    clientY,
    shiftKey: false,
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    stopPropagation: vi.fn(),
    currentTarget: target,
  } as unknown as Parameters<
    ReturnType<typeof createAnnotationDragController>["beginDrag"]
  >[0];
}

function dispatchPointer(
  target: EventTarget,
  type: "pointermove" | "pointerup",
  clientX: number,
  clientY: number,
): void {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX,
    clientY,
  });
  Object.defineProperty(event, "pointerId", { value: 1 });
  target.dispatchEvent(event);
}

describe("createAnnotationDragController live document reads (#2485)", () => {
  it("preserves text committed before drag start or mid-drag and ignores mid-drag deletion", () => {
    const staleAnnotation: Annotation = {
      id: "ann-1",
      kind: "instance-label",
      anchor: { kind: "free", position: { x: 100, y: 60 } },
      content: { runs: [{ kind: "text", value: "OLD" }] },
      rotation: 0,
      alignment: "start",
      locked: false,
      visible: true,
      sizeScale: 1,
    };
    const makeDoc = (annotations: Annotation[]): SchematicDocument => {
      const doc = createEmptyDocument("doc", "Annotation");
      doc.annotations = annotations;
      return doc;
    };
    let liveDocument = makeDoc([
      {
        ...staleAnnotation,
        content: { runs: [{ kind: "text", value: "SAME_TICK" }] },
      },
    ]);
    const transactSpy = vi.fn((edits) => {
      const result = executeTransaction(
        liveDocument,
        {
          transactionId: `drag-ann-${liveDocument.revision}`,
          documentId: liveDocument.id,
          expectedRevision: liveDocument.revision,
          actor: { kind: "human", id: "test" },
          edits,
        },
        { symbolResolver: resolver },
      );
      expect(result.ok).toBe(true);
      if (result.ok) liveDocument = result.document;
      return result;
    });
    const { svg, target } = createDragSvgTarget();
    try {
      const controller = createAnnotationDragController({
        getDocument: () => liveDocument,
        annotationGrid: 1,
        resolver,
        routeGeometryRecords: [],
        dragSessionRef: { current: null },
        dragThresholdPx: 2,
        pointFromClient: (x, y) => ({ x, y }),
        onCompositeMove: () => false,
        selectAnnotation: vi.fn(),
        clearSelectedEndpoint: vi.fn(),
        transact: transactSpy,
        setStatus: vi.fn(),
      });

      controller.beginDrag(
        pointerDownEvent(target, 100, 60),
        staleAnnotation,
        target,
      );
      dispatchPointer(window, "pointermove", 120, 70);
      liveDocument = makeDoc([
        {
          ...staleAnnotation,
          content: { runs: [{ kind: "text", value: "MID_DRAG" }] },
        },
      ]);
      dispatchPointer(window, "pointerup", 120, 70);

      const moved = liveDocument.annotations.find(
        (item) => item.id === "ann-1",
      );
      expect(moved?.content && flattenRichText(moved.content)).toBe("MID_DRAG");
      expect(moved?.anchor).toEqual({
        kind: "free",
        position: { x: 120, y: 70 },
      });

      transactSpy.mockClear();
      controller.beginDrag(pointerDownEvent(target, 120, 70), moved!, target);
      dispatchPointer(window, "pointermove", 140, 80);
      liveDocument = makeDoc([]);
      dispatchPointer(window, "pointerup", 140, 80);

      expect(transactSpy).not.toHaveBeenCalled();
      expect(liveDocument.annotations).toEqual([]);
    } finally {
      svg.remove();
    }
  });
});
