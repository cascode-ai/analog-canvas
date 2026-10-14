import { symbolSupportsValueAnnotation } from "@icm/derived";
import { instanceValueAnnotation } from "@icm/edit-engine";
import type { Annotation, Instance, SchematicDocument } from "@icm/model";
import type { ComponentParameter } from "../component-insert/component-parameters";
import { instanceLabelAnnotationFor } from "../instance-display/default-instance-display";
import { shownPartName } from "./group-naming";
import {
  commonGroupValue,
  groupForeground,
  groupParameterContext,
  groupPropertyItems,
} from "./group-property-code";

/** One current selection read, retaining the canonical label and value rules. */
export function readSelectionGroupProperties(
  document: SchematicDocument,
  selectedIds: readonly string[],
  propertyParametersForInstance: (
    instance: Instance,
  ) => readonly ComponentParameter[],
  foreground: string,
) {
  const instancesById = new Map<string, Instance>();
  for (const instance of document.instances)
    if (!instancesById.has(instance.id))
      instancesById.set(instance.id, instance);
  const annotationsByObjectId = new Map<string, Annotation[]>();
  for (const annotation of document.annotations) {
    if (annotation.anchor.kind !== "object") continue;
    const id = annotation.anchor.objectId;
    let bucket = annotationsByObjectId.get(id);
    if (!bucket) annotationsByObjectId.set(id, (bucket = []));
    bucket.push(annotation);
  }
  // These selectors read annotations only; a bucket is not an electrical
  // Document or a second label policy. Keep the source order within it.
  const annotationsFor = (id: string) => ({
    annotations: annotationsByObjectId.get(id) ?? [],
  });
  const terminalNamesByInstanceId = new Map<string, string>();
  for (const terminal of document.netlist?.terminals ?? [])
    for (const id of terminal.interfaceInstanceIds)
      if (!terminalNamesByInstanceId.has(id))
        terminalNamesByInstanceId.set(id, terminal.name);
  const labelsById = new Map(
    selectedIds.map((id) => [
      id,
      instanceLabelAnnotationFor(annotationsFor(id), id),
    ]),
  );
  const selectedGroupInstances = selectedIds.flatMap((id) => {
    const instance = instancesById.get(id);
    return instance ? [instance] : [];
  });
  const selectedGroupReferenceVisibility = commonGroupValue(
    selectedIds.map((id) => {
      const label = labelsById.get(id);
      return label !== undefined && label.visible !== false;
    }),
  );
  const selectedGroupValueInstances = selectedGroupInstances.filter(
    (instance) => symbolSupportsValueAnnotation(instance.symbolId),
  );
  const valuesById = new Map(
    selectedGroupValueInstances.map((instance) => [
      instance.id,
      instanceValueAnnotation(annotationsFor(instance.id), instance.id),
    ]),
  );
  const selectedGroupValueVisibility =
    selectedGroupValueInstances.length === 0
      ? null
      : commonGroupValue(
          selectedGroupValueInstances.map((instance) => {
            const value = valuesById.get(instance.id) ?? null;
            return value !== null && value.visible !== false;
          }),
        );
  const parametersById = new Map<string, readonly ComponentParameter[]>();
  const parametersFor = (instance: Instance) => {
    let parameters = parametersById.get(instance.id);
    if (!parameters) {
      parameters = propertyParametersForInstance(instance);
      parametersById.set(instance.id, parameters);
    }
    return parameters;
  };
  const selectedGroupParameters = groupParameterContext(
    selectedGroupInstances,
    parametersFor,
  );
  const selectedGroupContext = {
    ...selectedGroupParameters,
    reference: selectedGroupReferenceVisibility,
    value: selectedGroupValueVisibility,
    foreground: groupForeground(selectedGroupInstances, foreground),
    items:
      selectedGroupInstances.length < 2
        ? []
        : groupPropertyItems(selectedGroupInstances, {
            parametersFor,
            parameterKeys: Object.keys(
              selectedGroupParameters.parameters ?? {},
            ),
            nameOf: (instance) =>
              terminalNamesByInstanceId.get(instance.id) ??
              instance.reference ??
              instance.id,
            shownNameOf: (instance) => {
              const name =
                terminalNamesByInstanceId.get(instance.id) ??
                instance.reference;
              return name === undefined
                ? null
                : shownPartName(labelsById.get(instance.id), name);
            },
            referenceVisible: (instance) => {
              const label = labelsById.get(instance.id);
              return label !== undefined && label.visible !== false;
            },
            valueVisible: (instance) => {
              if (!symbolSupportsValueAnnotation(instance.symbolId))
                return null;
              const value = valuesById.get(instance.id) ?? null;
              return value !== null && value.visible !== false;
            },
            defaultForeground: foreground,
          }),
  };
  return {
    selectedGroupInstances,
    selectedGroupReferenceVisibility,
    selectedGroupValueInstances,
    selectedGroupValueVisibility,
    selectedGroupContext,
  };
}
