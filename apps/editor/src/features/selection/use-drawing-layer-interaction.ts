import { useEffect } from "react";
import type { ResolvedDrawingScene } from "@icm/derived";
import type { WireSource } from "@icm/edit-engine";
import type { DrawingObjectEntry, Point, SchematicDocument } from "@icm/model";
import {
  resolveInstanceSymbol,
  type SymbolFormulaPresentation,
} from "@icm/symbols";

import type { InteractionMode } from "../../interaction/interaction-state";
import {
  drawingLocationPoint,
  type DrawingLocationContext,
  type DrawingInstanceLocation,
} from "./drawing-location";
import { selectionForDrawingLayer } from "./drawing-order-actions";
import type { SelectionPolicy } from "./selection-filter";
import type { VisualSelection } from "./visual-selection";

type Annotation = SchematicDocument["annotations"][number];
type Instance = SchematicDocument["instances"][number];
type DraftText = Extract<
  NonNullable<SchematicDocument["drafting"]>["objects"][number],
  { kind: "text" }
>;

interface DrawingLayerInteractionOptions {
  scope: string;
  geometry: DrawingLocationContext;
  locatedInstance: DrawingInstanceLocation | null;
  setLocatedInstance(location: DrawingInstanceLocation | null): void;
  scene: ResolvedDrawingScene;
  selection: VisualSelection;
  policy: SelectionPolicy;
  getInteractionKind(): InteractionMode;
  textEditActive: boolean;
  wire: {
    usePin(source: WireSource): void;
    selectedEndpoint: WireSource | null;
    select(source: WireSource): void;
  };
  replaceSelection(selection: VisualSelection): void;
  prepareSelection(): void;
  frame(point: Point): void;
  edit: {
    annotation(annotation: Annotation): void;
    drafting(object: DraftText): void;
    formula(instance: Instance, presentation: SymbolFormulaPresentation): void;
  };
}

export function useDrawingLayerInteraction({
  scope,
  geometry,
  locatedInstance,
  setLocatedInstance,
  scene,
  selection,
  policy,
  getInteractionKind,
  textEditActive,
  wire,
  replaceSelection,
  prepareSelection,
  frame,
  edit,
}: DrawingLayerInteractionOptions) {
  const { document, resolver } = geometry;
  const locatedInstanceId =
    locatedInstance?.scope === scope &&
    selection.instanceIds.includes(locatedInstance.id)
      ? locatedInstance.id
      : undefined;
  useEffect(() => {
    if (locatedInstance && !locatedInstanceId) setLocatedInstance(null);
  }, [locatedInstance, locatedInstanceId, setLocatedInstance]);

  const canSelect = () => getInteractionKind() === "idle" && !textEditActive;

  function select(entry: DrawingObjectEntry, additive: boolean): boolean {
    if (!canSelect() || !policy.allowsCanvasHit(entry, "select")) return false;
    prepareSelection();
    replaceSelection(
      selectionForDrawingLayer(document, policy, entry, selection, additive),
    );
    setLocatedInstance(
      entry.kind === "instance" ? { scope, id: entry.id } : null,
    );
    return true;
  }

  function locate(entry: DrawingObjectEntry): boolean {
    if (!select(entry, false)) return false;
    const point = drawingLocationPoint(entry, geometry);
    if (point) frame(point);
    return true;
  }

  function editText(entry: DrawingObjectEntry): void {
    if (entry.kind === "annotation") {
      const annotation = document.annotations.find(({ id }) => id === entry.id);
      if (annotation && locate(entry)) edit.annotation(annotation);
    } else if (entry.kind === "drafting") {
      const object = document.drafting?.objects.find(
        ({ id }) => id === entry.id,
      );
      if (object?.kind === "text" && locate(entry)) edit.drafting(object);
    }
  }

  function editFormula(instanceId: string): void {
    const instance = document.instances.find(({ id }) => id === instanceId);
    const presentation =
      instance &&
      resolveInstanceSymbol(resolver, instance)?.definition.formulaPresentation;
    if (
      instance &&
      presentation &&
      locate({ kind: "instance", id: instanceId })
    )
      edit.formula(instance, presentation);
  }

  function choosePin(source: WireSource): void {
    if (getInteractionKind() === "wire") wire.usePin(source);
    else if (canSelect() && policy.allowsEndpoint("terminal", "select")) {
      wire.select(source);
      setLocatedInstance(null);
      frame(source.connection.contactPoint);
    }
  }

  const showConnectedNetsInFront = Boolean(
    locatedInstanceId ||
    (wire.selectedEndpoint &&
      !scene.isEndpointVisibleAt(
        wire.selectedEndpoint.endpoint,
        wire.selectedEndpoint.connection.contactPoint,
      )) ||
    (scene.hasOcclusion &&
      selection.instanceIds.some((id) => {
        const placement = document.instances.find(
          (instance) => instance.id === id,
        )?.placement;
        return (
          placement &&
          !scene.isVisibleAt({ kind: "instance", id }, placement.position)
        );
      })),
  );

  return {
    objectActionsEnabled: canSelect(),
    locatedInstanceId,
    showConnectedNetsInFront,
    select,
    locate,
    editText,
    editFormula,
    choosePin,
  };
}
