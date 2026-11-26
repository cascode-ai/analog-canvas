// @vitest-environment jsdom
import { executeTransaction } from "@icm/edit-engine";
import { createEmptyDocument, flattenRichText } from "@icm/model";
import type { DraftingObject, SchematicDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it, vi } from "vitest";

import type { CanvasDragSession } from "../../canvas/canvas-drag-session";
import { createDraftingDragController } from "./drafting-drag-controller";
import {
  proposeRectangleLabel,
  type DraftingRectangle,
} from "./rectangle-label";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function rectangle(
  id: string,
  center: { x: number; y: number },
  width: number,
  height: number,
): DraftingRectangle {
  return {
    id,
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: center },
    center,
    width,
    height,
    rotation: 0,
    lineStyle: "solid",
  };
}

function documentWith(objects: DraftingObject[]): SchematicDocument {
  const document = createEmptyDocument("doc", "Drafting drag");
  document.drafting = { objects };
  return document;
}

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
    ReturnType<typeof createDraftingDragController>["beginDrag"]
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

function createControllerHarness(initialDocument: SchematicDocument) {
  let liveDocument = initialDocument;
  const dragSessionRef: { current: CanvasDragSession | null } = {
    current: null,
  };
  const transactSpy = vi.fn((edits) => {
    const result = executeTransaction(
      liveDocument,
      {
        transactionId: `drag-${liveDocument.revision}`,
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
  const controller = createDraftingDragController({
    getDocument: () => liveDocument,
    annotationGrid: 1,
    resolver,
    visibleEndpoints: [],
    dragSessionRef,
    dragThresholdPx: 2,
    snapCaptureRadiusPx: 0,
    pointFromClient: (x, y) => ({ x, y }),
    logicalRadiusForPixels: () => 0,
    paintSnapGuides: vi.fn(),
    snapDraftingPoint: (point) => ({ point, guides: [] }),
    onCompositeMove: () => false,
    selectDraftingObject: vi.fn(),
    setInspectorSegment: vi.fn(),
    setHandlePreview: vi.fn(),
    transact: transactSpy,
    setStatus: vi.fn(),
  });
  return {
    controller,
    transactSpy,
    getDocument: () => liveDocument,
    setDocument: (next: SchematicDocument) => {
      liveDocument = next;
    },
  };
}

describe("createDraftingDragController live document reads (#2485)", () => {
  it("preserves freshly committed FIR text when dragging a label from a pre-commit closure", () => {
    const box = rectangle("box-1", { x: 100, y: 60 }, 80, 40);
    const staleEmptyLabel = proposeRectangleLabel(box, "note-2");
    const committedLabel: Extract<DraftingObject, { kind: "text" }> = {
      ...staleEmptyLabel,
      content: { runs: [{ kind: "text", value: "FIR" }] },
    };
    const harness = createControllerHarness(
      documentWith([box, committedLabel]),
    );
    const { svg, target } = createDragSvgTarget();
    try {
      harness.controller.beginDrag(
        pointerDownEvent(target, 100, 60),
        staleEmptyLabel,
        target,
      );
      dispatchPointer(window, "pointermove", 112, 68);
      dispatchPointer(window, "pointerup", 112, 68);

      const moved = harness
        .getDocument()
        .drafting?.objects.find((item) => item.id === "note-2");
      expect(moved?.kind).toBe("text");
      if (moved?.kind === "text") {
        expect(flattenRichText(moved.content)).toBe("FIR");
        expect(
          moved.anchor.kind === "object" && moved.anchor.localOffset,
        ).toEqual({ x: 12, y: 8 });
      }
    } finally {
      svg.remove();
    }
  });

  it("preserves text committed mid-drag on pointerup and does not resurrect mid-drag deletions", () => {
    const box = rectangle("box-1", { x: 100, y: 60 }, 80, 40);
    const emptyLabel = proposeRectangleLabel(box, "note-2");
    const harness = createControllerHarness(documentWith([box, emptyLabel]));
    const { svg, target } = createDragSvgTarget();
    try {
      // Mid-drag commit: FIR lands while the pointer is moving before pointerup.
      harness.controller.beginDrag(
        pointerDownEvent(target, 100, 60),
        emptyLabel,
        target,
      );
      dispatchPointer(window, "pointermove", 112, 68);
      harness.setDocument(
        documentWith([
          box,
          {
            ...emptyLabel,
            content: { runs: [{ kind: "text", value: "FIR" }] },
          },
        ]),
      );
      dispatchPointer(window, "pointerup", 112, 68);

      const moved = harness
        .getDocument()
        .drafting?.objects.find((item) => item.id === "note-2");
      expect(moved?.kind).toBe("text");
      if (moved?.kind === "text") {
        expect(flattenRichText(moved.content)).toBe("FIR");
      }

      // Mid-drag deletion: label is deleted before pointerup; onFinish must not resurrect it.
      harness.transactSpy.mockClear();
      harness.controller.beginDrag(
        pointerDownEvent(target, 112, 68),
        moved!,
        target,
      );
      dispatchPointer(window, "pointermove", 130, 80);
      harness.setDocument(documentWith([box]));
      dispatchPointer(window, "pointerup", 130, 80);

      expect(harness.transactSpy).not.toHaveBeenCalled();
      expect(
        harness
          .getDocument()
          .drafting?.objects.find((item) => item.id === "note-2"),
      ).toBeUndefined();
    } finally {
      svg.remove();
    }
  });

  it("aborts drag start if the label was deleted by an empty text commit in the same tick", () => {
    const box = rectangle("box-1", { x: 100, y: 60 }, 80, 40);
    const staleEmptyLabel = proposeRectangleLabel(box, "note-2");
    const harness = createControllerHarness(documentWith([box]));
    const { svg, target } = createDragSvgTarget();
    try {
      harness.controller.beginDrag(
        pointerDownEvent(target, 100, 60),
        staleEmptyLabel,
        target,
      );
      dispatchPointer(window, "pointermove", 112, 68);
      dispatchPointer(window, "pointerup", 112, 68);

      expect(harness.transactSpy).not.toHaveBeenCalled();
    } finally {
      svg.remove();
    }
  });
});
