import {
  deviceDescriptor,
  parameterReferences,
  parameterExpressionBody,
  renameParameterReference,
  supportsScalarParameterExpression,
} from "@icm/devices";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type { ProjectStructureEdit } from "./project-transaction.js";
import type { SchematicEdit } from "./edit-schema.js";

function requireCell(project: CircuitProject, documentId: string) {
  const cell = project.documents.find((document) => document.id === documentId);
  if (!cell?.netlist) throw new Error("Cell has no parameter interface");
  return cell as SchematicDocument & {
    netlist: NonNullable<SchematicDocument["netlist"]>;
  };
}

function validateName(name: string) {
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(name) || name.length > 128)
    throw new Error(
      "Parameter name must start with a letter or underscore and contain only letters, digits or underscores",
    );
}

function documentEdit(
  document: SchematicDocument,
  edits: SchematicEdit[],
): ProjectStructureEdit {
  return {
    kind: "transact_document",
    documentId: document.id,
    expectedRevision: document.revision,
    edits,
  };
}

function validateDefaults(
  parameters: NonNullable<SchematicDocument["netlist"]>["formalParameters"],
) {
  const byName = new Map(
    parameters.map((parameter) => [parameter.name.toLowerCase(), parameter]),
  );
  const visiting = new Set<string>();
  const done = new Set<string>();
  function visit(name: string) {
    if (visiting.has(name))
      throw new Error(`Cyclic Cell parameter default: ${name}`);
    if (done.has(name)) return;
    visiting.add(name);
    for (const reference of parameterReferences(
      byName.get(name)?.defaultValue ?? "",
    )) {
      const key = reference.name.toLowerCase();
      if (byName.has(key)) visit(key);
    }
    visiting.delete(name);
    done.add(name);
  }
  for (const name of byName.keys()) visit(name);
}

function validateDefaultValue(value: string) {
  if (
    !value.trim() ||
    value.length > 1024 ||
    (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(value.trim()) &&
      !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?[A-Za-z]*$/iu.test(
        value.trim(),
      ) &&
      parameterExpressionBody(value) === undefined)
  )
    throw new Error(
      "Default must be a number, parameter name or a braced expression",
    );
}

export function cellParameterCallers(
  project: CircuitProject,
  documentId: string,
  name: string,
) {
  return project.documents.flatMap((document) =>
    document.instances.flatMap((instance) => {
      const binding = instance.netlist?.binding;
      return binding?.kind === "subcircuit" &&
        binding.childDocumentId === documentId &&
        Object.keys(instance.netlist!.parameters).some(
          (key) => key.toLowerCase() === name.toLowerCase(),
        )
        ? [{ documentId: document.id, instanceId: instance.id }]
        : [];
    }),
  );
}

export function planSetCellParameterDefault(
  project: CircuitProject,
  documentId: string,
  name: string,
  defaultValue: string,
): ProjectStructureEdit[] {
  const cell = requireCell(project, documentId);
  const parameter = cell.netlist.formalParameters.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  if (!parameter) throw new Error(`Unknown Cell parameter: ${name}`);
  validateDefaultValue(defaultValue);
  if (parameter.defaultValue === defaultValue.trim()) return [];
  const formalParameters = cell.netlist.formalParameters.map((item) =>
    item === parameter ? { ...item, defaultValue: defaultValue.trim() } : item,
  );
  validateDefaults(formalParameters);
  return [
    documentEdit(cell, [
      { kind: "set_cell_formal_parameters", formalParameters },
    ]),
  ];
}

export function planRemoveCellParameter(
  project: CircuitProject,
  documentId: string,
  name: string,
): ProjectStructureEdit[] {
  const cell = requireCell(project, documentId);
  const parameter = cell.netlist.formalParameters.find(
    (item) => item.name.toLowerCase() === name.toLowerCase(),
  );
  if (!parameter) throw new Error(`Unknown Cell parameter: ${name}`);
  const usage = cellParameterUsage(cell, parameter.name);
  if (
    usage.fields.length ||
    usage.defaults.length ||
    cellParameterCallers(project, documentId, name).length
  )
    throw new Error(
      `Parameter ${name} is still referenced or overridden; remove those uses first`,
    );
  const labelInUse = project.documents.some((parent) =>
    parent.annotations.some((annotation) => {
      const textBinding = annotation.binding;
      if (
        textBinding?.kind !== "instance-value" ||
        textBinding.parameter?.toLowerCase() !== name.toLowerCase()
      )
        return false;
      const binding = parent.instances.find(
        (instance) => instance.id === textBinding.instanceId,
      )?.netlist?.binding;
      return (
        binding?.kind === "subcircuit" && binding.childDocumentId === documentId
      );
    }),
  );
  if (labelInUse)
    throw new Error(`Parameter ${name} is still displayed by a caller`);
  return [
    documentEdit(cell, [
      {
        kind: "set_cell_formal_parameters",
        formalParameters: cell.netlist.formalParameters.filter(
          (item) => item !== parameter,
        ),
      },
    ]),
  ];
}

function expressionEntries(instance: SchematicDocument["instances"][number]) {
  const parameters = deviceDescriptor(instance.symbolId)?.parameters;
  return Object.entries(instance.netlist?.parameters ?? {}).filter(
    ([key]) =>
      parameters?.find((parameter) => parameter.name === key)?.editor !==
      "select",
  );
}

export function cellParameterUsage(cell: SchematicDocument, name: string) {
  const uses = (value: string) =>
    parameterReferences(value).some(
      (reference) => reference.name.toLowerCase() === name.toLowerCase(),
    );
  return {
    fields: cell.instances.flatMap((instance) =>
      expressionEntries(instance)
        .filter(([, value]) => uses(value))
        .map(([parameter]) => ({ instanceId: instance.id, parameter })),
    ),
    defaults: (cell.netlist?.formalParameters ?? [])
      .filter(
        (parameter) =>
          parameter.defaultValue !== undefined && uses(parameter.defaultValue),
      )
      .map((parameter) => parameter.name),
  };
}

/** Declare/reuse a Cell parameter and bind a device field in one Project history entry. */
export function planBindCellParameter(
  project: CircuitProject,
  documentId: string,
  instanceId: string,
  field: string,
  name: string,
  defaultValue?: string,
): ProjectStructureEdit[] {
  validateName(name);
  const cell = requireCell(project, documentId);
  const instance = cell.instances.find((item) => item.id === instanceId);
  if (!instance?.netlist)
    throw new Error("Instance has no electrical parameters");
  if (!supportsScalarParameterExpression(instance.symbolId, field))
    throw new Error("This field is not a native scalar parameter expression");
  if (!expressionEntries(instance).some(([key]) => key === field))
    throw new Error("Choose an existing expression-capable device field");
  const existing = cell.netlist.formalParameters.find(
    (parameter) => parameter.name.toLowerCase() === name.toLowerCase(),
  );
  const edits: SchematicEdit[] = [];
  if (!existing) {
    if (
      !defaultValue?.trim() ||
      defaultValue.length > 1024 ||
      /[\r\n;]/u.test(defaultValue)
    )
      throw new Error("A new Cell parameter needs a default value");
    validateDefaultValue(defaultValue);
    if (
      parameterReferences(defaultValue).some(
        (reference) => reference.name.toLowerCase() === name.toLowerCase(),
      )
    )
      throw new Error("A parameter default cannot reference itself");
    const usage = cellParameterUsage(cell, name);
    if (usage.fields.length || usage.defaults.length)
      throw new Error(
        `Parameter ${name} would capture an existing undeclared reference; choose another name`,
      );
    validateDefaults([
      ...cell.netlist.formalParameters,
      { name, defaultValue },
    ]);
    edits.push({
      kind: "set_cell_formal_parameters",
      formalParameters: [
        ...cell.netlist.formalParameters,
        { name, defaultValue: defaultValue.trim() },
      ],
    });
  }
  edits.push({
    kind: "patch_instance_netlist_parameters",
    instanceId,
    set: { [field]: `{${existing?.name ?? name}}` },
  });
  return [documentEdit(cell, edits)];
}

/** Rename scope-local references and every caller's override key, not parent expressions. */
export function planRenameCellParameter(
  project: CircuitProject,
  documentId: string,
  oldName: string,
  newName: string,
): ProjectStructureEdit[] {
  validateName(newName);
  const cell = requireCell(project, documentId);
  const old = cell.netlist.formalParameters.find(
    (parameter) => parameter.name.toLowerCase() === oldName.toLowerCase(),
  );
  if (!old) throw new Error(`Unknown Cell parameter: ${oldName}`);
  if (old.name === newName) return [];
  const sameIdentity = old.name.toLowerCase() === newName.toLowerCase();
  if (
    cell.netlist.formalParameters.some(
      (parameter) =>
        parameter !== old &&
        parameter.name.toLowerCase() === newName.toLowerCase(),
    )
  )
    throw new Error(`Cell parameter ${newName} already exists`);
  const capture = cellParameterUsage(cell, newName);
  if (!sameIdentity && (capture.fields.length || capture.defaults.length))
    throw new Error(
      `Renaming to ${newName} would capture an existing reference`,
    );
  const childEdits: SchematicEdit[] = [
    {
      kind: "set_cell_formal_parameters",
      formalParameters: cell.netlist.formalParameters.map((parameter) => ({
        ...parameter,
        name: parameter === old ? newName : parameter.name,
        ...(parameter.defaultValue !== undefined
          ? {
              defaultValue: renameParameterReference(
                parameter.defaultValue,
                old.name,
                newName,
              ),
            }
          : {}),
      })),
    },
  ];
  for (const instance of cell.instances) {
    const set = Object.fromEntries(
      expressionEntries(instance).flatMap(([key, value]) => {
        const next = renameParameterReference(value, old.name, newName);
        return next === value ? [] : [[key, next]];
      }),
    );
    if (Object.keys(set).length)
      childEdits.push({
        kind: "patch_instance_netlist_parameters",
        instanceId: instance.id,
        set,
      });
  }
  const result = [documentEdit(cell, childEdits)];
  for (const parent of project.documents) {
    const edits: SchematicEdit[] = [];
    for (const instance of parent.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind !== "subcircuit" || binding.childDocumentId !== cell.id)
        continue;
      const entries = Object.entries(instance.netlist!.parameters);
      const overrides = entries.filter(
        ([key]) => key.toLowerCase() === old.name.toLowerCase(),
      );
      for (const annotation of parent.annotations) {
        const textBinding = annotation.binding;
        if (
          textBinding?.kind === "instance-value" &&
          textBinding.instanceId === instance.id &&
          textBinding.parameter?.toLowerCase() === old.name.toLowerCase()
        ) {
          edits.push({
            kind: "upsert_schematic_annotation",
            annotation: {
              ...annotation,
              binding: { ...textBinding, parameter: newName },
            },
          });
        }
      }
      if (!overrides.length) continue;
      if (
        overrides.length > 1 ||
        (!sameIdentity &&
          entries.some(([key]) => key.toLowerCase() === newName.toLowerCase()))
      )
        throw new Error(
          `Caller ${instance.reference ?? instance.id} has conflicting parameter overrides`,
        );
      const [key, value] = overrides[0]!;
      edits.push({
        kind: "patch_instance_netlist_parameters",
        instanceId: instance.id,
        set: { [newName]: value },
        ...(key !== newName ? { unset: [key] } : {}),
      });
    }
    if (edits.length) {
      if (parent.id === cell.id)
        throw new Error(
          "Recursive Cell calls must be repaired before parameter renaming",
        );
      result.push(documentEdit(parent, edits));
    }
  }
  return result;
}
