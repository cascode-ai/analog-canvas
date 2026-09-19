import { useEffect, useMemo, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

import {
  inverseTransformPoint,
  type CellSymbolSide,
  type Point,
  type SchematicDocument,
} from "@icm/model";
import {
  createBlockSymbol,
  type SymbolDefinition,
  type SymbolPin,
  type SymbolResolver,
} from "@icm/symbols";

import type { BlockSymbolLayoutTarget } from "./block-symbol-layout-target";

import { snapCoordinate } from "../../snap/engine";

type Instance = SchematicDocument["instances"][number];

export interface CellSymbolLayoutSession {
  target: BlockSymbolLayoutTarget;
  instance: Instance;
  body: { left: number; right: number; top: number; bottom: number };
  pins: readonly {
    terminal: BlockSymbolLayoutTarget["terminals"][number];
    pin: SymbolPin;
  }[];
}

type CellSymbolLayoutDrag = {
  kind: "body" | "pin";
  pointerId: number;
  terminalId?: string;
  captureTarget?: SVGCircleElement;
};

export type CellSymbolLayoutEdit =
  | { kind: "body"; width: number; height: number }
  | {
      kind: "pin";
      terminalId: string;
      side: CellSymbolSide;
      offset: number;
    }
  | null;

export function cellSymbolLayoutEditAtLocalPoint(
  layout: Pick<CellSymbolLayoutSession, "body"> &
    Partial<Pick<CellSymbolLayoutSession, "target">>,
  drag: Pick<CellSymbolLayoutDrag, "kind" | "terminalId">,
  local: Point,
): CellSymbolLayoutEdit {
  if (drag.kind === "body") {
    return {
      kind: "body",
      width: Math.max(20, snapCoordinate(local.x * 2, 20)),
      height: Math.max(20, snapCoordinate(local.y * 2, 20)),
    };
  }
  if (!drag.terminalId) return null;
  const distances = [
    ["west", Math.abs(local.x - layout.body.left)],
    ["east", Math.abs(local.x - layout.body.right)],
    ["north", Math.abs(local.y - layout.body.top)],
    ["south", Math.abs(local.y - layout.body.bottom)],
  ] as const;
  const side = distances.reduce((closest, candidate) =>
    candidate[1] < closest[1] ? candidate : closest,
  )[0];
  const requestedOffset = snapCoordinate(
    side === "west" || side === "east" ? local.y : local.x,
    10,
  );
  const occupied = new Set(
    (layout.target?.presentation?.pinPlacements ?? [])
      .filter((pin) => pin.terminalId !== drag.terminalId && pin.side === side)
      .map((pin) => pin.offset),
  );
  let offset = requestedOffset;
  for (let distance = 10; occupied.has(offset); distance += 10) {
    offset = !occupied.has(requestedOffset + distance)
      ? requestedOffset + distance
      : requestedOffset - distance;
  }
  return {
    kind: "pin",
    terminalId: drag.terminalId,
    side,
    offset,
  };
}

export function useCellSymbolLayout({
  selectedInstance,
  target,
  resolver,
  selectionOpen,
  canvasPointFromEvent,
  setBodySize,
  setPortPlacement,
}: {
  selectedInstance: Instance | undefined;
  target: BlockSymbolLayoutTarget | undefined;
  resolver: SymbolResolver;
  selectionOpen: boolean;
  canvasPointFromEvent: (event: ReactPointerEvent<SVGSVGElement>) => Point;
  setBodySize: (
    target: BlockSymbolLayoutTarget,
    width: number,
    height: number,
  ) => void;
  setPortPlacement: (
    target: BlockSymbolLayoutTarget,
    terminalId: string,
    side: CellSymbolSide,
    offset: number,
  ) => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [targetInstanceId, setTargetInstanceId] = useState<string | null>(null);
  const [drag, setDrag] = useState<CellSymbolLayoutDrag | null>(null);
  const layout = useMemo<CellSymbolLayoutSession | null>(() => {
    if (!enabled || !selectedInstance?.placement || !target) return null;
    const definition = resolver.resolve(selectedInstance.symbolId)?.definition;
    const body = definition?.primitives.find(
      (primitive) => primitive.kind === "polygon",
    );
    if (!definition || !body || body.kind !== "polygon") return null;
    const xs = body.points.map((point) => point.x);
    const ys = body.points.map((point) => point.y);
    return {
      target,
      instance: selectedInstance,
      body: {
        left: Math.min(...xs),
        right: Math.max(...xs),
        top: Math.min(...ys),
        bottom: Math.max(...ys),
      },
      pins: target.terminals.flatMap((terminal) => {
        const pin = definition.pins.find(
          (candidate) => candidate.name === terminal.name,
        );
        return pin ? [{ terminal, pin }] : [];
      }),
    };
  }, [target, enabled, resolver, selectedInstance]);

  const cancelDrag = (): void => {
    if (drag?.captureTarget?.hasPointerCapture(drag.pointerId)) {
      drag.captureTarget.releasePointerCapture(drag.pointerId);
    }
    setDrag(null);
  };

  const exit = (): void => {
    cancelDrag();
    setEnabled(false);
    setTargetInstanceId(null);
  };

  useEffect(() => {
    if (!enabled) return;
    if (selectedInstance?.id !== targetInstanceId || !target) exit();
  }, [target, enabled, selectedInstance?.id, targetInstanceId]);

  useEffect(() => {
    if (!selectionOpen && enabled) exit();
  }, [enabled, selectionOpen]);

  const toggle = (): void => {
    if (enabled) {
      exit();
      return;
    }
    if (!target || !selectedInstance?.placement) return;
    setTargetInstanceId(selectedInstance.id);
    setEnabled(true);
  };

  const beginDrag = (
    event: ReactPointerEvent<SVGCircleElement>,
    kind: "body" | "pin",
    terminalId?: string,
  ): void => {
    if (!layout || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      kind,
      pointerId: event.pointerId,
      captureTarget: event.currentTarget,
      ...(terminalId ? { terminalId } : {}),
    });
  };

  const previewDrag = (
    event: ReactPointerEvent<SVGGElement>,
  ): SymbolDefinition | null => {
    if (!drag || drag.pointerId !== event.pointerId || !layout) return null;
    const svg = event.currentTarget.ownerSVGElement;
    if (!svg) return null;
    const point = canvasPointFromEvent({ ...event, currentTarget: svg });
    const placement = layout.instance.placement!;
    const edit = cellSymbolLayoutEditAtLocalPoint(
      layout,
      drag,
      inverseTransformPoint(point, placement.position, placement),
    );
    if (!edit) return null;
    const current = layout.target.presentation;
    return createBlockSymbol({
      ...layout.target,
      presentation: {
        ...current,
        ...(edit.kind === "body"
          ? { minimumBodySize: { width: edit.width, height: edit.height } }
          : {
              pinPlacements: [
                ...(current?.pinPlacements ?? []).filter(
                  (pin) => pin.terminalId !== edit.terminalId,
                ),
                {
                  terminalId: edit.terminalId,
                  side: edit.side,
                  offset: edit.offset,
                },
              ],
            }),
      },
    });
  };

  const completeDrag = (event: ReactPointerEvent<SVGSVGElement>): boolean => {
    if (!drag || drag.pointerId !== event.pointerId || !layout) return false;
    const point = canvasPointFromEvent(event);
    const placement = layout.instance.placement!;
    const local = inverseTransformPoint(point, placement.position, placement);
    const edit = cellSymbolLayoutEditAtLocalPoint(layout, drag, local);
    cancelDrag();
    if (edit?.kind === "body") {
      setBodySize(layout.target, edit.width, edit.height);
    } else if (edit?.kind === "pin") {
      setPortPlacement(layout.target, edit.terminalId, edit.side, edit.offset);
    }
    return true;
  };

  return {
    enabled,
    layout,
    activeDragPointerId: drag?.pointerId ?? null,
    cancelDrag,
    exit,
    toggle,
    beginDrag,
    previewDrag,
    completeDrag,
  };
}
