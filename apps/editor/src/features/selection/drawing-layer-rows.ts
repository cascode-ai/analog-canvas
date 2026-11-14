import {
  annotationOwningInstanceId,
  gatheredDrawingLabelOwners,
  isSchematicAnnotationVisible,
  resolveAnnotationText,
  type ResolvedDocumentLogicalNets,
  type ResolvedDrawingScene,
} from "@icm/derived";
import {
  flattenRichText,
  type Annotation,
  type DraftingObject,
  type DrawingOrderEntry,
  type SchematicDocument,
} from "@icm/model";
import { resolveInstanceSymbol, type SymbolResolver } from "@icm/symbols";

export interface DrawingLayerRow {
  entry: DrawingOrderEntry;
  label: string;
  ownerId?: string;
  ownerLabel?: string;
  detail?: string;
  formula?: boolean;
  attached?: DrawingLayerRow[];
  separate?: DrawingLayerRow[];
}

const annotationKindLabels: Record<Annotation["kind"], string> = {
  "instance-label": "Reference",
  "instance-value": "Value",
  "net-label": "Net name",
  "power-label": "Power label",
  "route-marker": "Route marker",
};

const draftingKindLabels: Record<DraftingObject["kind"], string> = {
  text: "Text",
  rectangle: "Rectangle",
  circle: "Circle",
  arrow: "Arrow",
  leader: "Leader",
  callout: "Callout",
  "construction-line": "Line",
  "floating-symbol": "Symbol",
};

export function drawingLayerRows(
  document: SchematicDocument,
  scene: ResolvedDrawingScene,
  resolver: SymbolResolver,
  logicalNets: ResolvedDocumentLogicalNets,
): DrawingLayerRow[] {
  const cellPinNames = new Map(
    document.netlist?.terminals.flatMap((terminal) =>
      terminal.interfaceInstanceIds.map((id) => [id, terminal.name] as const),
    ),
  );
  const instances = new Map<string, DrawingLayerRow>(
    document.instances.flatMap((instance) => {
      if (!instance.placement) return [];
      const symbol = resolveInstanceSymbol(resolver, instance)?.definition;
      return [
        [
          instance.id,
          {
            entry: { kind: "instance", id: instance.id },
            label:
              instance.reference ??
              cellPinNames.get(instance.id) ??
              symbol?.name ??
              instance.id,
            formula: Boolean(symbol?.formulaPresentation),
          } satisfies DrawingLayerRow,
        ] as const,
      ];
    }),
  );
  const annotationOwners = new Map<string, string>();
  const annotations = new Map(
    document.annotations.flatMap((annotation) => {
      const ownerId = annotationOwningInstanceId(annotation);
      if (ownerId) annotationOwners.set(annotation.id, ownerId);
      const content = resolveAnnotationText(
        document,
        annotation,
        logicalNets,
        resolver,
      );
      if (
        !isSchematicAnnotationVisible(
          document,
          annotation,
          logicalNets,
          content,
          resolver,
        )
      )
        return [];
      const owner = ownerId ? instances.get(ownerId) : undefined;
      return [
        [
          annotation.id,
          {
            entry: { kind: "annotation", id: annotation.id },
            label: flattenRichText(content).trim(),
            detail: annotationKindLabels[annotation.kind],
            ...(owner && ownerId ? { ownerId, ownerLabel: owner.label } : {}),
          } satisfies DrawingLayerRow,
        ] as const,
      ];
    }),
  );
  const drafting = new Map(
    (document.drafting?.objects ?? []).map((object) => {
      const label = draftingKindLabels[object.kind];
      const content =
        object.kind === "text" || object.kind === "callout"
          ? flattenRichText(object.content).trim()
          : undefined;
      return [
        object.id,
        {
          entry: { kind: "drafting", id: object.id },
          label: content || label,
          ...(content ? { detail: label } : {}),
        } satisfies DrawingLayerRow,
      ] as const;
    }),
  );

  const gathered = gatheredDrawingLabelOwners(scene.order, annotationOwners);
  const rows: DrawingLayerRow[] = [];
  for (const entry of scene.order) {
    const row: DrawingLayerRow | undefined =
      entry.kind === "instance"
        ? instances.get(entry.id)
        : entry.kind === "annotation"
          ? annotations.get(entry.id)
          : entry.kind === "drafting"
            ? drafting.get(entry.id)
            : {
                entry,
                label:
                  entry.kind === "electrical"
                    ? "Electrical drawing"
                    : "Circuit marks",
              };
    if (!row) continue;
    if (entry.kind === "annotation" && row.ownerId) {
      const instance = instances.get(row.ownerId);
      if (instance) {
        if (gathered.has(entry.id)) {
          (instance.attached ??= []).unshift(row);
          continue;
        }
        (instance.separate ??= []).unshift(row);
      }
    }
    rows.push(row);
  }
  return rows.reverse();
}
