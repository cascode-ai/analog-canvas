import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import {
  createRoutingOperationPlan,
  gateRoutingOperationPlan,
  type SchematicEdit,
} from "@icm/edit-engine";
import { flattenRichText, semanticTextDocument } from "@icm/model";
import { resolveAnnotationText } from "@icm/derived";
import type {
  Annotation,
  DraftingObject,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import {
  componentParameters,
  effectiveComponentParameterValue,
} from "../component-insert/component-parameters";
import type { ComponentParameter } from "../component-insert/component-parameters";
import {
  additionalParameterDrafts,
  planAdditionalParameterPatch,
} from "./additional-parameters";
import type { AdditionalParameterDraft } from "./additional-parameters";
import {
  createTextEditingSession,
  proposeTextEditingCommit,
  textDeletionEdit,
  updateTextEditingSession,
} from "../text-editing/text-editing";
import type {
  ReferenceLabelOffer,
  TextEditingSession,
} from "../text-editing/text-editing";
import { attachedInstanceFormulaAnnotation } from "../text-editing/bound-formula";
import {
  literalLabelFromReferenceEdit,
  referencePrefixConflict,
} from "../instance-display/literal-instance-label";
import { planElectricalMarkerName } from "./electrical-marker-name";

export interface InstancePropertyDraft {
  instanceId: string | null;
  parameters: Record<string, string>;
  x: string;
  y: string;
  rotation: "0" | "90" | "180" | "270";
}

const EMPTY_INSTANCE_PROPERTY_DRAFT: InstancePropertyDraft = {
  instanceId: null,
  parameters: {},
  x: "",
  y: "",
  rotation: "0",
};

function sameInstancePropertyDraft(
  left: InstancePropertyDraft,
  right: InstancePropertyDraft,
): boolean {
  if (
    left.instanceId !== right.instanceId ||
    left.x !== right.x ||
    left.y !== right.y ||
    left.rotation !== right.rotation
  ) {
    return false;
  }
  const keys = new Set([
    ...Object.keys(left.parameters),
    ...Object.keys(right.parameters),
  ]);
  return [...keys].every(
    (key) => left.parameters[key] === right.parameters[key],
  );
}

function sameAdditionalParameterDrafts(
  left: readonly AdditionalParameterDraft[],
  right: readonly AdditionalParameterDraft[],
): boolean {
  return (
    left.length === right.length &&
    left.every(
      (entry, index) =>
        entry.originalName === right[index]?.originalName &&
        entry.name === right[index]?.name &&
        entry.value === right[index]?.value,
    )
  );
}

type TransactionResult = { ok: boolean; revision: number };
type Route = SchematicDocument["routes"][number];
type Instance = SchematicDocument["instances"][number];

export interface UsePropertiesEditorOptions {
  document: SchematicDocument;
  resolver: SymbolResolver;
  selectedRoute: Route | undefined;
  selectedRouteNetLabel: Annotation | null;
  selectedRouteNetLabels: readonly Annotation[];
  selectedInstance: Instance | undefined;
  componentParametersForInstance?: (
    instance: Instance,
  ) => readonly ComponentParameter[];
  wireSourceActive: boolean;
  netLabelEditorInputRef: MutableRefObject<HTMLInputElement | null>;
  transact: (edits: SchematicEdit[]) => TransactionResult;
  setStatus: (status: string) => void;
  replaceSelectionKind: (kind: "annotation", ids: readonly string[]) => void;
  selectOnly: (kind: "annotation", ids: readonly string[]) => void;
  selectDraftingObject: (id: string) => void;
  clearSelectionKinds: (kinds: readonly ("annotation" | "drafting")[]) => void;
  netLabelForRoute: (route: Route) => Annotation | null | undefined;
  netLabelEditsForRoute: (
    route: Route,
    draft: string,
    presentation?: {
      alignment: "start" | "middle" | "end";
      sizeScale: number;
      formatOverride?: RichTextDocument;
    },
  ) => SchematicEdit[] | null;
  netLabelScopeEdit: (
    annotation: Annotation,
    scope: "local" | "global",
  ) => SchematicEdit[] | null;
  netNameEditsForAnnotation?: (
    annotation: Annotation,
    name: string,
    presentationAnnotation?: Annotation,
  ) => SchematicEdit[] | null | undefined;
  instancePropertyEdits: (draft: InstancePropertyDraft) => {
    edits: SchematicEdit[];
    invalidPosition: boolean;
  };
  referenceLabelVisibilityEdits: (
    instanceIds: readonly string[],
    visible: boolean,
  ) => SchematicEdit[];
  valueVisibilityEdits: (
    source: SchematicDocument,
    instanceIds: readonly string[],
    visible: boolean,
  ) => SchematicEdit[];
  isCellPinAnnotation?: (annotation: Annotation) => boolean;
  commitCellPinAnnotation?: (annotation: Annotation, name: string) => boolean;
  nextId: (prefix: string) => string;
}

/** Flat owner for property drafts, Net Labels, and canvas text sessions. */
export function usePropertiesEditor(options: UsePropertiesEditorOptions) {
  const [netLabelDraft, setNetLabelDraft] = useState("");
  const [netLabelEditorOpen, setNetLabelEditorOpen] = useState(false);
  const [instancePropertyDraft, setInstancePropertyDraft] =
    useState<InstancePropertyDraft>(EMPTY_INSTANCE_PROPERTY_DRAFT);
  const [additionalParameterDraft, setAdditionalParameterDraft] = useState<
    readonly AdditionalParameterDraft[]
  >([]);
  const [textEditing, setTextEditing] = useState<TextEditingSession | null>(
    null,
  );
  const [referenceLabelOffer, setReferenceLabelOffer] =
    useState<ReferenceLabelOffer | null>(null);
  // The offer answers one typed text in one session; anything else moving on
  // withdraws it.
  useEffect(() => {
    setReferenceLabelOffer(null);
  }, [textEditing?.owner, textEditing?.id]);
  const netLabelDraftRouteRef = useRef<string | null>(null);
  const lastSelectedInstanceKeyRef = useRef<string | null>(null);
  const instancePropertyDraftRef = useRef<InstancePropertyDraft>(
    EMPTY_INSTANCE_PROPERTY_DRAFT,
  );
  const instancePropertyBaselineRef = useRef<InstancePropertyDraft>(
    EMPTY_INSTANCE_PROPERTY_DRAFT,
  );
  const additionalParameterBaselineRef = useRef<
    readonly AdditionalParameterDraft[]
  >([]);
  const additionalParameterSerialRef = useRef(0);

  const transactNamedNet = (edits: readonly SchematicEdit[]): boolean => {
    const gate = gateRoutingOperationPlan(
      options.document,
      createRoutingOperationPlan(options.document, {
        intent: "rename-marker",
        diagnostics: [],
        edits,
      }),
      { symbolResolver: options.resolver },
    );
    if (!gate.ok) {
      options.setStatus(gate.message);
      return false;
    }
    return options.transact([...gate.edits]).ok;
  };

  const parametersForInstance = (instance: Instance) =>
    options.componentParametersForInstance?.(instance) ??
    componentParameters(instance.symbolId);

  const commitElectricalMarkerName = (
    instanceId: string,
    name: string,
  ): void => {
    const plan = planElectricalMarkerName(options.document, instanceId, name);
    if (plan.status === "noop") return;
    if (plan.status === "rejected") {
      options.setStatus(plan.message);
      return;
    }
    const gate = gateRoutingOperationPlan(
      options.document,
      plan.operationPlan,
      { symbolResolver: options.resolver },
    );
    if (!gate.ok) {
      options.setStatus(gate.message);
      return;
    }
    if (options.transact([...gate.edits]).ok) options.setStatus(plan.message);
  };

  const draftForInstance = (instance: Instance): InstancePropertyDraft => ({
    instanceId: instance.id,
    parameters: Object.fromEntries(
      parametersForInstance(instance).map((parameter) => [
        parameter.key,
        effectiveComponentParameterValue(instance, parameter),
      ]),
    ),
    x: instance.placement ? String(instance.placement.position.x) : "",
    y: instance.placement ? String(instance.placement.position.y) : "",
    rotation: String(instance.placement?.rotation ?? 0) as
      "0" | "90" | "180" | "270",
  });

  const commitPendingNetLabelDraft = (): void => {
    const routeId = netLabelDraftRouteRef.current;
    netLabelDraftRouteRef.current = null;
    if (!routeId) return;
    const route = options.document.routes.find(
      (candidate) => candidate.id === routeId,
    );
    if (!route) return;
    const existing = options.netLabelForRoute(route);
    const draftName = netLabelDraft.trim();
    const currentName = existing
      ? flattenRichText(
          resolveAnnotationText(options.document, existing),
        ).trim()
      : "";
    if (existing ? draftName === currentName : draftName === "") return;
    const edits = options.netLabelEditsForRoute(route, netLabelDraft);
    if (!edits) return;
    if (transactNamedNet(edits)) {
      options.setStatus(
        draftName ? `Saved Net Label ${draftName}` : "Removed Net Label",
      );
    }
  };

  useEffect(() => {
    commitPendingNetLabelDraft();
    if (!options.selectedRoute) {
      setNetLabelDraft("");
      setNetLabelEditorOpen(false);
      return;
    }
    setNetLabelDraft(
      options.selectedRouteNetLabel
        ? flattenRichText(
            resolveAnnotationText(
              options.document,
              options.selectedRouteNetLabel,
            ),
          )
        : "",
    );
    netLabelDraftRouteRef.current = options.selectedRoute.id;
  }, [options.selectedRoute, options.selectedRouteNetLabel]);

  useEffect(() => {
    const instanceId = options.selectedInstance?.id ?? null;
    const instanceKey = options.selectedInstance
      ? `${options.selectedInstance.id}:${options.selectedInstance.symbolId}`
      : null;
    if (instanceKey === lastSelectedInstanceKeyRef.current) return;
    lastSelectedInstanceKeyRef.current = instanceKey;
    const nextDraft = options.selectedInstance
      ? draftForInstance(options.selectedInstance)
      : EMPTY_INSTANCE_PROPERTY_DRAFT;
    instancePropertyDraftRef.current = nextDraft;
    instancePropertyBaselineRef.current = nextDraft;
    setInstancePropertyDraft(nextDraft);
    const nextAdditionalDraft = options.selectedInstance
      ? additionalParameterDrafts(
          options.selectedInstance,
          parametersForInstance(options.selectedInstance).map(
            (parameter) => parameter.key,
          ),
        )
      : [];
    additionalParameterBaselineRef.current = nextAdditionalDraft;
    setAdditionalParameterDraft(nextAdditionalDraft);
  }, [options.selectedInstance]);

  const updateInstancePropertyDraft = (
    update: (current: InstancePropertyDraft) => InstancePropertyDraft,
  ): void => {
    const nextDraft = update(instancePropertyDraftRef.current);
    instancePropertyDraftRef.current = nextDraft;
    setInstancePropertyDraft(nextDraft);
    if (
      !options.selectedInstance ||
      nextDraft.instanceId !== options.selectedInstance.id
    ) {
      return;
    }
    const { edits, invalidPosition } = options.instancePropertyEdits(nextDraft);
    if (!invalidPosition && edits.length > 0) options.transact(edits);
  };

  const addAdditionalParameter = (): void => {
    const instance = options.selectedInstance;
    if (!instance?.netlist) {
      options.setStatus("This component has no netlist parameters to edit");
      return;
    }
    additionalParameterSerialRef.current += 1;
    setAdditionalParameterDraft((current) => [
      ...current,
      {
        id: `${instance.id}:additional:new:${additionalParameterSerialRef.current}`,
        originalName: null,
        name: "",
        value: "",
      },
    ]);
  };

  const updateAdditionalParameter = (
    id: string,
    change: Partial<Pick<AdditionalParameterDraft, "name" | "value">>,
  ): void => {
    setAdditionalParameterDraft((current) =>
      current.map((entry) =>
        entry.id === id ? { ...entry, ...change } : entry,
      ),
    );
  };

  const removeAdditionalParameter = (id: string): void => {
    setAdditionalParameterDraft((current) =>
      current.filter((entry) => entry.id !== id),
    );
  };

  const applyAdditionalParameters = (): void => {
    const instance = options.selectedInstance;
    if (!instance) return;
    const plan = planAdditionalParameterPatch(
      instance,
      additionalParameterDraft,
      parametersForInstance(instance).map((parameter) => parameter.key),
    );
    if (plan.kind === "invalid") {
      options.setStatus(plan.message);
      return;
    }
    if (plan.kind === "unchanged") {
      // The draft can differ from the baseline (whitespace, a new row with a
      // blank value) while producing no persisted change; without a message
      // the still-visible Apply button reads as broken.
      options.setStatus("No additional-parameter changes to apply");
      return;
    }
    if (!options.transact([plan.edit]).ok) return;
    const baseline = additionalParameterDraft
      .filter((entry) => entry.name.trim() && entry.value.trim())
      .map((entry) => ({
        ...entry,
        originalName: entry.name.trim(),
        name: entry.name.trim(),
        value: entry.value.trim(),
      }));
    additionalParameterBaselineRef.current = baseline;
    setAdditionalParameterDraft(baseline);
    options.setStatus(`Updated additional parameters for ${instance.id}`);
  };

  const cancelAdditionalParameters = (): void => {
    setAdditionalParameterDraft(additionalParameterBaselineRef.current);
  };

  const applyNetLabel = (): void => {
    const route = options.selectedRoute;
    if (!route) return;
    const existingLabel = options.netLabelForRoute(route);
    const name = netLabelDraft.trim();
    if (!name && !existingLabel) {
      options.setStatus("Selected Route has no Net Label");
      return;
    }
    const edits = options.netLabelEditsForRoute(route, netLabelDraft);
    if (!edits || !transactNamedNet(edits)) return;
    netLabelDraftRouteRef.current = null;
    if (!name) {
      options.replaceSelectionKind("annotation", []);
      options.setStatus(
        `Deleted Net Label ${flattenRichText(resolveAnnotationText(options.document, existingLabel!))}`,
      );
      return;
    }
    options.replaceSelectionKind("annotation", [
      existingLabel?.id ?? `net-label-${route.id}`,
    ]);
    options.setStatus(
      edits.some((edit) => edit.kind === "merge_nets")
        ? `Connected Nets through label ${name}`
        : `Named Net ${name}`,
    );
  };

  const updateNetLabelDraft = (draft: string): void => {
    setNetLabelDraft(draft);
    const route = options.selectedRoute;
    if (!route) return;
    const existing = options.netLabelForRoute(route);
    const nextName = draft.trim();
    const currentName = existing
      ? flattenRichText(
          resolveAnnotationText(options.document, existing),
        ).trim()
      : "";
    if (nextName === currentName || (!nextName && !existing)) return;
    const edits = options.netLabelEditsForRoute(route, draft);
    if (!edits || !transactNamedNet(edits)) return;
    options.setStatus(
      nextName ? `Saved Net Label ${nextName}` : "Removed Net Label",
    );
  };

  const deleteSelectedRouteNetLabel = (): void => {
    const label = options.selectedRouteNetLabel;
    if (!options.selectedRoute || !label) {
      options.setStatus(
        options.selectedRouteNetLabels.length > 1
          ? "This Net has multiple labels; select the label to delete"
          : "Selected Route has no Net Label",
      );
      return;
    }
    if (
      transactNamedNet([
        { kind: "remove_schematic_annotation", annotationId: label.id },
      ])
    ) {
      options.replaceSelectionKind("annotation", []);
      setNetLabelDraft("");
      options.setStatus(
        `Deleted Net Label ${flattenRichText(resolveAnnotationText(options.document, label))}`,
      );
    }
  };

  const commitNetLabelScope = (
    annotation: Annotation,
    scope: "local" | "global",
  ): void => {
    const edits = options.netLabelScopeEdit(annotation, scope);
    if (!edits || edits.length === 0) return;
    if (transactNamedNet(edits)) {
      options.setStatus(
        `Net Label ${flattenRichText(resolveAnnotationText(options.document, annotation))} is now ${scope}`,
      );
    }
  };

  const commitInstancePropertyDraft = (): boolean => {
    const { edits, invalidPosition } = options.instancePropertyEdits(
      instancePropertyDraftRef.current,
    );
    return !invalidPosition && edits.length > 0 && options.transact(edits).ok;
  };

  const discardInstancePropertyDraft = (): void => {
    const instance = options.selectedInstance;
    const baseline = instancePropertyBaselineRef.current;
    if (!instance || baseline.instanceId !== instance.id) return;
    const { edits, invalidPosition } = options.instancePropertyEdits(baseline);
    if (!invalidPosition && edits.length > 0) options.transact(edits);
    instancePropertyDraftRef.current = baseline;
    setInstancePropertyDraft(baseline);
    options.setStatus(`Discarded property edits for ${instance.id}`);
  };

  const setReferenceLabelsVisible = (
    instanceIds: readonly string[],
    visible: boolean,
  ): void => {
    const edits = options.referenceLabelVisibilityEdits(instanceIds, visible);
    if (edits.length === 0) {
      options.setStatus(
        visible
          ? "No reference labels are available for this selection"
          : "Selected components have no reference labels",
      );
      return;
    }
    if (options.transact(edits).ok) {
      options.setStatus(
        `${visible ? "Showing" : "Hiding"} reference labels on ${edits.length} component${edits.length === 1 ? "" : "s"}`,
      );
    }
  };

  const setValueLabelsVisible = (
    instanceIds: readonly string[],
    visible: boolean,
  ): void => {
    const edits = options.valueVisibilityEdits(
      options.document,
      instanceIds,
      visible,
    );
    if (edits.length === 0) {
      options.setStatus(
        visible
          ? "No component values are available for this selection"
          : "Selected components have no value displays",
      );
      return;
    }
    if (options.transact(edits).ok) {
      options.setStatus(
        `${visible ? "Showing" : "Hiding"} component values on ${edits.length} component${edits.length === 1 ? "" : "s"}`,
      );
    }
  };

  const showSelectedInstanceValue = (): void => {
    const instance = options.selectedInstance;
    if (!instance) return;
    const propertyEdits =
      instancePropertyDraft.instanceId === instance.id
        ? options
            .instancePropertyEdits(instancePropertyDraft)
            .edits.filter(
              (edit) =>
                edit.kind === "set_instance_netlist" ||
                edit.kind === "patch_instance_netlist_parameters",
            )
        : [];
    const projected = structuredClone(options.document);
    for (const edit of propertyEdits) {
      const target = projected.instances.find(
        (item) => item.id === edit.instanceId,
      );
      if (!target) continue;
      if (edit.kind === "set_instance_netlist") {
        target.netlist = structuredClone(edit.netlist);
      } else if (edit.kind === "patch_instance_netlist_parameters") {
        if (!target.netlist) continue;
        for (const [name, value] of Object.entries(edit.set ?? {})) {
          target.netlist.parameters[name] = value;
        }
        for (const name of edit.unset ?? []) {
          delete target.netlist.parameters[name];
        }
      }
    }
    const valueEdits = options.valueVisibilityEdits(
      projected,
      [instance.id],
      true,
    );
    if (propertyEdits.length === 0 && valueEdits.length === 0) {
      options.setStatus("No component value is available for this selection");
      return;
    }
    if (options.transact([...propertyEdits, ...valueEdits]).ok) {
      options.setStatus(`Showing component value for ${instance.id}`);
    }
  };

  const beginNetLabelEditing = (): void => {
    if (!options.selectedRoute || options.wireSourceActive) {
      options.setStatus("Select a wire segment before adding a Net Label");
      return;
    }
    setNetLabelEditorOpen(true);
    requestAnimationFrame(() =>
      options.netLabelEditorInputRef.current?.focus(),
    );
  };

  const commitNetLabelEditing = (): void => {
    applyNetLabel();
    setNetLabelEditorOpen(false);
  };

  const beginAnnotationTextEditing = (annotation: Annotation): void => {
    options.selectOnly("annotation", [annotation.id]);
    setTextEditing(
      createTextEditingSession(
        { owner: "annotation", object: annotation },
        options.document,
      ),
    );
  };

  const beginDraftingTextEditing = (
    object: Extract<DraftingObject, { kind: "text" }>,
  ): void => {
    options.selectDraftingObject(object.id);
    setTextEditing(createTextEditingSession({ owner: "drafting", object }));
  };

  /**
   * The text a Symbol draws inside its own body. It edits on the canvas where
   * it is drawn, through the same session and overlay every other editable
   * text uses, and commits to the same field the Properties panel writes.
   */
  const beginInstanceFormulaEditing = (
    instance: Instance,
    defaultFormula: string,
  ): void => {
    setTextEditing(
      createTextEditingSession({
        owner: "instance-formula",
        object: instance,
        defaultFormula,
      }),
    );
  };

  const updateTextEditing = (
    change: Partial<
      Pick<TextEditingSession, "content" | "sizeScale" | "alignment">
    >,
  ): void => {
    if (change.content) setReferenceLabelOffer(null);
    setTextEditing((current) =>
      current ? updateTextEditingSession(current, change) : null,
    );
  };

  const deleteTextEditing = (): void => {
    if (!textEditing) return;
    const editedAnnotation =
      textEditing.owner === "annotation"
        ? options.document.annotations.find(
            (annotation) => annotation.id === textEditing.id,
          )
        : undefined;
    if (editedAnnotation && options.isCellPinAnnotation?.(editedAnnotation)) {
      options.setStatus(
        "Cell Pin name cannot be empty or deleted independently",
      );
      return;
    }
    if (options.transact([textDeletionEdit(textEditing)]).ok) {
      options.clearSelectionKinds(["annotation", "drafting"]);
      setTextEditing(null);
      options.setStatus(`Deleted text ${textEditing.id}`);
    }
  };

  const commitTextEditing = (): void => {
    if (!textEditing) return;
    const boundAnnotation =
      textEditing.owner === "annotation"
        ? options.document.annotations.find(
            (annotation) => annotation.id === textEditing.id,
          )
        : undefined;
    if (boundAnnotation?.binding) {
      const name = flattenRichText(textEditing.content).trim();
      const currentName = flattenRichText(
        resolveAnnotationText(options.document, boundAnnotation),
      ).trim();
      const presentationChanged =
        (boundAnnotation.sizeScale ?? 1) !== textEditing.sizeScale ||
        boundAnnotation.alignment !== textEditing.alignment;
      const formatOverrideAllowed =
        boundAnnotation.binding.kind === "instance-reference" ||
        boundAnnotation.binding.kind === "net-name" ||
        boundAnnotation.binding.kind === "cell-terminal-name";
      const { formatOverride: _currentOverride, ...annotationWithoutOverride } =
        boundAnnotation;
      const semanticContent =
        boundAnnotation.binding.kind === "instance-reference"
          ? semanticTextDocument(name, "instance-label")
          : boundAnnotation.binding.kind === "cell-terminal-name"
            ? semanticTextDocument(name, "formal-port")
            : boundAnnotation.binding.kind === "net-name"
              ? semanticTextDocument(
                  name,
                  boundAnnotation.kind === "power-label"
                    ? "power-label"
                    : "net-label",
                )
              : resolveAnnotationText(
                  options.document,
                  annotationWithoutOverride,
                );
      const nextFormatOverride = formatOverrideAllowed
        ? JSON.stringify(semanticContent) ===
          JSON.stringify(textEditing.content)
          ? undefined
          : textEditing.content
        : boundAnnotation.formatOverride;
      const presentationEdit: SchematicEdit = {
        kind: "upsert_schematic_annotation",
        annotation: {
          ...annotationWithoutOverride,
          ...(nextFormatOverride ? { formatOverride: nextFormatOverride } : {}),
          sizeScale: textEditing.sizeScale,
          alignment: textEditing.alignment,
        },
      };
      const formatOverrideChanged =
        JSON.stringify(boundAnnotation.formatOverride ?? null) !==
        JSON.stringify(nextFormatOverride ?? null);
      if (!name) {
        options.setStatus("Bound electrical names cannot be empty");
        return;
      }
      if (name === currentName && !formatOverrideChanged) {
        if (presentationChanged && !options.transact([presentationEdit]).ok) {
          return;
        }
        setTextEditing(null);
        return;
      }
      switch (boundAnnotation.binding.kind) {
        case "net-name":
          const routeAnchor = boundAnnotation.anchor;
          const boundRoute =
            routeAnchor.kind === "route"
              ? options.document.routes.find(
                  (route) => route.id === routeAnchor.routeId,
                )
              : undefined;
          const annotationNetEdits = boundRoute
            ? undefined
            : options.netNameEditsForAnnotation?.(
                boundAnnotation,
                name,
                presentationChanged || formatOverrideChanged
                  ? presentationEdit.annotation
                  : undefined,
              );
          const netLabelEdits = boundRoute
            ? options.netLabelEditsForRoute(
                boundRoute,
                name,
                presentationChanged || formatOverrideChanged
                  ? {
                      alignment: textEditing.alignment,
                      sizeScale: textEditing.sizeScale,
                      ...(nextFormatOverride
                        ? { formatOverride: nextFormatOverride }
                        : {}),
                    }
                  : undefined,
              )
            : annotationNetEdits !== undefined
              ? annotationNetEdits
              : name !== currentName
                ? null
                : presentationChanged || formatOverrideChanged
                  ? [presentationEdit]
                  : [];
          if (
            netLabelEdits === null &&
            !boundRoute &&
            annotationNetEdits === undefined
          ) {
            // No planner owns this label (not route-anchored, not a
            // power-label): say so instead of leaving Apply visibly inert.
            options.setStatus(
              "This label cannot rename its Net — edit the name from a wire on that Net",
            );
            return;
          }
          if (netLabelEdits && transactNamedNet(netLabelEdits)) {
            setTextEditing(null);
          }
          return;
        case "cell-terminal-name":
          if (name !== currentName) {
            if (
              !options.commitCellPinAnnotation?.(
                presentationEdit.annotation,
                name,
              )
            )
              return;
          } else if (
            (presentationChanged || formatOverrideChanged) &&
            !options.transact([presentationEdit]).ok
          ) {
            return;
          }
          {
            setTextEditing(null);
          }
          return;
        case "instance-reference":
          if (
            name === currentName &&
            !presentationChanged &&
            !formatOverrideChanged
          ) {
            setTextEditing(null);
            return;
          }
          if (name !== currentName) {
            // A text the prefix policy refuses is more often a label than a
            // typo: offer to keep the Reference and show the text as literal
            // attached text, instead of ending in the Edit Engine's refusal.
            const referenceBinding = boundAnnotation.binding;
            const instance = options.document.instances.find(
              (candidate) => candidate.id === referenceBinding.instanceId,
            );
            const conflict = instance
              ? referencePrefixConflict(instance, name)
              : null;
            if (conflict && instance?.reference) {
              setReferenceLabelOffer({
                annotationId: boundAnnotation.id,
                text: name,
                reference: instance.reference,
                prefix: conflict.prefix,
              });
              return;
            }
          }
          if (
            options.transact([
              ...(name !== currentName
                ? [
                    {
                      kind: "set_instance_reference" as const,
                      instanceId: boundAnnotation.binding.instanceId,
                      reference: name,
                    },
                  ]
                : []),
              ...(presentationChanged || formatOverrideChanged
                ? [presentationEdit]
                : []),
            ]).ok
          ) {
            setTextEditing(null);
          }
          return;
        case "instance-value":
          options.setStatus("Edit component values in Properties");
          return;
      }
    }
    const proposal = proposeTextEditingCommit(options.document, textEditing);
    if (proposal.kind === "blocked") {
      options.setStatus("This text can no longer be edited");
      return;
    }
    if (proposal.kind === "delete" && textEditing.owner === "annotation") {
      const annotation = options.document.annotations.find(
        (candidate) => candidate.id === textEditing.id,
      );
      if (annotation && options.isCellPinAnnotation?.(annotation)) {
        options.setStatus("Cell Pin name cannot be empty");
        return;
      }
    }
    if (proposal.kind === "unchanged") {
      setTextEditing(null);
      return;
    }
    if (
      proposal.kind === "update" &&
      proposal.edit.kind === "upsert_schematic_annotation" &&
      options.commitCellPinAnnotation &&
      options.isCellPinAnnotation?.(proposal.edit.annotation) &&
      proposal.edit.annotation.kind === "instance-label" &&
      proposal.edit.annotation.anchor.kind === "object"
    ) {
      const content = proposal.edit.annotation.content ?? { runs: [] };
      const name = flattenRichText(content).trim();
      if (!name) {
        options.setStatus("Cell Pin name cannot be empty");
        return;
      }
      if (!options.commitCellPinAnnotation(proposal.edit.annotation, name))
        return;
      setTextEditing(null);
      return;
    }
    if (!options.transact([proposal.edit]).ok) return;
    if (proposal.kind === "delete") {
      options.clearSelectionKinds(["annotation", "drafting"]);
      options.setStatus(`Deleted text ${proposal.id}`);
    } else {
      options.setStatus(`Updated text ${proposal.id}`);
    }
    setTextEditing(null);
  };

  const acceptReferenceLabelOffer = (): void => {
    if (
      !referenceLabelOffer ||
      !textEditing ||
      textEditing.owner !== "annotation" ||
      textEditing.id !== referenceLabelOffer.annotationId
    ) {
      return;
    }
    const source = options.document.annotations.find(
      (annotation) => annotation.id === textEditing.id,
    );
    if (!source) return;
    const conversion = literalLabelFromReferenceEdit({
      source,
      content: textEditing.content,
      sizeScale: textEditing.sizeScale,
      alignment: textEditing.alignment,
      id: options.nextId("instance-text"),
    });
    if (!conversion) {
      options.setStatus("This text cannot become a component label");
      return;
    }
    if (!options.transact([...conversion.edits]).ok) return;
    setReferenceLabelOffer(null);
    setTextEditing(null);
    options.selectOnly("annotation", [conversion.label.id]);
    options.setStatus(
      `Showing “${referenceLabelOffer.text}” as a label; Reference ${referenceLabelOffer.reference} is unchanged`,
    );
  };

  const declineReferenceLabelOffer = (): void => {
    setReferenceLabelOffer(null);
  };

  const convertFormulaToAttachedLiteral = (
    formula: RichTextDocument,
  ): boolean => {
    if (!textEditing || textEditing.owner !== "annotation") return false;
    const source = options.document.annotations.find(
      (annotation) => annotation.id === textEditing.id,
    );
    if (!source) return false;
    const annotation = attachedInstanceFormulaAnnotation({
      document: options.document,
      source,
      formula,
      resolver: options.resolver,
      id: options.nextId("instance-formula"),
    });
    if (!annotation) {
      options.setStatus("This formula cannot be attached to the component");
      return false;
    }
    if (
      !options.transact([{ kind: "upsert_schematic_annotation", annotation }])
        .ok
    ) {
      return false;
    }
    setTextEditing(null);
    options.selectOnly("annotation", [annotation.id]);
    options.setStatus(
      "Added a component formula annotation; the electrical Reference is unchanged",
    );
    return true;
  };

  return {
    acceptReferenceLabelOffer,
    additionalParameterDraft,
    additionalParameterDraftChanges: !sameAdditionalParameterDrafts(
      additionalParameterDraft,
      additionalParameterBaselineRef.current,
    ),
    addAdditionalParameter,
    applyNetLabel,
    applyAdditionalParameters,
    beginAnnotationTextEditing,
    beginDraftingTextEditing,
    beginInstanceFormulaEditing,
    beginNetLabelEditing,
    commitInstancePropertyDraft,
    commitElectricalMarkerName,
    commitNetLabelScope,
    commitNetLabelEditing,
    commitPendingNetLabelDraft,
    commitTextEditing,
    convertFormulaToAttachedLiteral,
    cancelAdditionalParameters,
    declineReferenceLabelOffer,
    referenceLabelOffer,
    clearTextEditing: () => setTextEditing(null),
    deleteSelectedRouteNetLabel,
    deleteTextEditing,
    discardInstancePropertyDraft,
    instancePropertyDraft,
    hasInstancePropertyDraftChanges: !sameInstancePropertyDraft(
      instancePropertyDraft,
      instancePropertyBaselineRef.current,
    ),
    netLabelDraft,
    netLabelEditorOpen,
    removeAdditionalParameter,
    updateInstancePropertyDraft,
    updateAdditionalParameter,
    updateNetLabelDraft,
    setNetLabelEditorOpen,
    setReferenceLabelsVisible,
    setValueLabelsVisible,
    showSelectedInstanceValue,
    textEditing,
    updateTextEditing,
  };
}
