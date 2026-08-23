import { useEffect, useRef, useState } from "react";
import type { MutableRefObject } from "react";

import {
  createConnectivityProposal,
  gateConnectivityProposal,
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
import type { TextEditingSession } from "../text-editing/text-editing";

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
  isCellPortAnnotation?: (annotation: Annotation) => boolean;
  commitCellPortAnnotation?: (annotation: Annotation, name: string) => boolean;
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
    const gate = gateConnectivityProposal(
      options.document,
      createConnectivityProposal(options.document, {
        intent: "rename_or_merge_named_net",
        diagnostics: [],
        edits,
      }),
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
    if (plan.kind === "unchanged") return;
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

  const updateTextEditing = (
    change: Partial<
      Pick<TextEditingSession, "content" | "sizeScale" | "alignment">
    >,
  ): void => {
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
    if (editedAnnotation && options.isCellPortAnnotation?.(editedAnnotation)) {
      options.setStatus(
        "Cell Port name cannot be empty or deleted independently",
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
        boundAnnotation.binding.kind === "net-name" ||
        boundAnnotation.binding.kind === "cell-terminal-name";
      const { formatOverride: _currentOverride, ...annotationWithoutOverride } =
        boundAnnotation;
      const semanticContent =
        boundAnnotation.binding.kind === "cell-terminal-name"
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
      const instanceReferenceBinding =
        boundAnnotation.binding.kind === "instance-schematic-name"
          ? boundAnnotation.binding
          : undefined;
      const schematicNameInstance = instanceReferenceBinding
        ? options.document.instances.find(
            (candidate) => candidate.id === instanceReferenceBinding.instanceId,
          )
        : undefined;
      const schematicNameSourceChanged =
        instanceReferenceBinding !== undefined &&
        JSON.stringify(
          schematicNameInstance?.schematicName ??
            resolveAnnotationText(options.document, boundAnnotation),
        ) !== JSON.stringify(textEditing.content);
      const formatOverrideChanged =
        JSON.stringify(boundAnnotation.formatOverride ?? null) !==
        JSON.stringify(nextFormatOverride ?? null);
      if (!name) {
        options.setStatus("Bound electrical names cannot be empty");
        return;
      }
      if (
        name === currentName &&
        !schematicNameSourceChanged &&
        !formatOverrideChanged
      ) {
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
          if (netLabelEdits && transactNamedNet(netLabelEdits)) {
            setTextEditing(null);
          }
          return;
        case "cell-terminal-name":
          if (name !== currentName) {
            if (
              !options.commitCellPortAnnotation?.(
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
        case "instance-schematic-name":
          if (!schematicNameSourceChanged && !presentationChanged) {
            setTextEditing(null);
            return;
          }
          if (
            options.transact([
              ...(schematicNameSourceChanged
                ? [
                    {
                      kind: "set_instance_schematic_name" as const,
                      instanceId: boundAnnotation.binding.instanceId,
                      content: textEditing.content,
                    },
                  ]
                : []),
              ...(presentationChanged ? [presentationEdit] : []),
            ]).ok
          ) {
            setTextEditing(null);
          }
          return;
        case "instance-value":
          options.setStatus("Edit component values in Properties");
          return;
        case "instance-designator":
          options.setStatus("Netlist reference is edited in Properties");
          return;
        case "instance-master-name":
          options.setStatus("Master names are defined by the instance binding");
          return;
      }
    }
    const proposal = proposeTextEditingCommit(options.document, textEditing);
    if (proposal.kind === "blocked") return;
    if (proposal.kind === "delete" && textEditing.owner === "annotation") {
      const annotation = options.document.annotations.find(
        (candidate) => candidate.id === textEditing.id,
      );
      if (annotation && options.isCellPortAnnotation?.(annotation)) {
        options.setStatus("Cell Port name cannot be empty");
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
      options.commitCellPortAnnotation &&
      options.isCellPortAnnotation?.(proposal.edit.annotation) &&
      proposal.edit.annotation.kind === "instance-label" &&
      proposal.edit.annotation.anchor.kind === "object"
    ) {
      const content = proposal.edit.annotation.content ?? { runs: [] };
      const name = flattenRichText(content).trim();
      if (!name) return;
      if (!options.commitCellPortAnnotation(proposal.edit.annotation, name))
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

  return {
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
    beginNetLabelEditing,
    commitInstancePropertyDraft,
    commitNetLabelEditing,
    commitPendingNetLabelDraft,
    commitTextEditing,
    cancelAdditionalParameters,
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
