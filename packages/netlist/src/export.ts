import { deviceDescriptor, requiredParameterNames } from "@icm/devices";
import type { CircuitProject } from "@icm/model";
import {
  analyzeDesignNetlist,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
import type { NetlistDiagnostic } from "./ir.js";
import { printDesignNetlist, type NetlistFileDescriptor } from "./printers.js";

export interface NetlistExportPlaceholder {
  cellName: string;
  reference: string;
  field: string;
  token: string;
}

export type DesignNetlistExportResult = {
  diagnostics: NetlistDiagnostic[];
} & (
  | { status: "blocked" }
  | {
      status: "ready";
      file: NetlistFileDescriptor;
      placeholders: NetlistExportPlaceholder[];
      cellCount: number;
      externalMasterCount: number;
    }
);

/**
 * Download-only projection. Missing device values/models become undefined
 * tokens on a copy, which must then pass strict extraction. Never expose the
 * permissive authoring IR as an export or change simulation readiness.
 */
export function createDesignNetlistExport(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions = {},
): DesignNetlistExportResult {
  const format = options.format ?? "spice";
  const analysis = analyzeDesignNetlist(project, options);
  const errors = analysis.diagnostics.filter(
    (item) => item.severity === "error",
  );
  const blocked = {
    status: "blocked",
    diagnostics: analysis.diagnostics,
  } as const;
  if (
    errors.some(
      (item) =>
        item.code !== "MISSING_MODEL_TARGET" &&
        item.code !== "MISSING_REQUIRED_PARAMETER",
    )
  )
    return blocked;

  let ir = analysis.ir;
  const placeholders: NetlistExportPlaceholder[] = [];
  if (!ir) {
    const draft = structuredClone(project);
    // Reserve authored identifiers, including those inside expressions, so a
    // TODO can never accidentally resolve to an existing parameter or model.
    const electricalData = [
      project.externalSubcircuitDefinitions,
      ...project.documents.map((document) => [
        document.netlist,
        ...document.instances.map((instance) => [
          instance.reference,
          instance.netlist,
        ]),
      ]),
    ];
    const reserved = new Set(
      (
        JSON.stringify(electricalData).match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []
      ).map((name) => name.toLowerCase()),
    );
    const affected = new Map<string, Set<string>>();
    for (const error of errors) {
      const instances = affected.get(error.documentId) ?? new Set<string>();
      for (const id of error.objectIds) instances.add(id);
      affected.set(error.documentId, instances);
    }
    for (const document of draft.documents) {
      for (const instance of document.instances) {
        if (!affected.get(document.id)?.has(instance.id)) continue;
        const definition = deviceDescriptor(instance.symbolId);
        const netlist = instance.netlist;
        if (!definition || !netlist || !document.netlist) return blocked;
        const placeholder = (field: string) => {
          const base = `TODO_${document.netlist!.name}_${instance.reference}_${field}`;
          let token = base;
          for (let suffix = 2; reserved.has(token.toLowerCase()); suffix++) {
            token = `${base}_${suffix}`;
          }
          reserved.add(token.toLowerCase());
          placeholders.push({
            cellName: document.netlist!.name,
            reference: instance.reference!,
            field,
            token,
          });
          return token;
        };
        if (definition.targetPolicy === "required-model" && !netlist.binding) {
          netlist.binding = {
            kind: "model",
            deviceClass: definition.deviceClass,
            name: placeholder("model"),
          };
        }
        for (const required of requiredParameterNames(definition)) {
          const key =
            Object.keys(netlist.parameters).find(
              (name) => name.toLowerCase() === required.toLowerCase(),
            ) ?? required;
          if (netlist.parameters[key]?.trim()) continue;
          const token = placeholder(required);
          netlist.parameters[key] = format === "spice" ? `{${token}}` : token;
        }
      }
    }
    ir = analyzeDesignNetlist(draft, options).ir;
    if (!ir) return blocked;
  }
  const file = printDesignNetlist(format, ir);
  const comments = [
    ...(placeholders.length
      ? [
          "INCOMPLETE NETLIST - replace TODO fields before simulation.",
          "No missing values or models have been inferred.",
          ...placeholders.map(
            (item) =>
              `${item.token}: ${item.cellName}/${item.reference} ${item.field}`,
          ),
        ]
      : []),
    ...analysis.diagnostics.map((item) => `${item.code}: ${item.message}`),
  ];
  const prefix = format === "spice" ? "*" : "//";
  if (comments.length) {
    // Every line stays a comment even when an authored name contains newlines.
    file.text =
      comments
        .flatMap((line) => line.split(/\r\n?|\n/u))
        .map((line) => `${prefix} ${line}\n`)
        .join("") + file.text;
  }
  return {
    status: "ready",
    diagnostics: analysis.diagnostics,
    file,
    placeholders,
    cellCount: ir.cells.length,
    externalMasterCount: ir.externalMasters?.length ?? 0,
  };
}
