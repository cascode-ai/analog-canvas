import { deviceDescriptor, requiredParameterNames } from "@icm/devices";
import type { CircuitProject } from "@icm/model";
import {
  analyzeDesignNetlist,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
import type { NetlistDiagnostic } from "./ir.js";
import {
  projectNetlistExportProfile,
  type NetlistExportProfile,
} from "./export-profiles.js";
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
 * Copy/export projection. Missing device values/models become undefined
 * tokens on a copy, which must then pass strict extraction. Never expose the
 * permissive authoring IR as an export or change simulation readiness.
 */
export function createDesignNetlistExport(
  source: CircuitProject,
  options: DesignNetlistAnalysisOptions & {
    profile?: NetlistExportProfile;
  } = {},
): DesignNetlistExportResult {
  const requestedFormat = options.format ?? "spice";
  const profiled = options.profile
    ? projectNetlistExportProfile(
        source,
        options.profile,
        options.rootDocumentId,
      )
    : undefined;
  const project = profiled?.project ?? source;
  const format = requestedFormat;
  const analysisOptions = { ...options, format };
  const extracted = analyzeDesignNetlist(project, analysisOptions);
  const analysis = {
    ...extracted,
    diagnostics: [...(profiled?.diagnostics ?? []), ...extracted.diagnostics],
  };
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
    ir = analyzeDesignNetlist(draft, analysisOptions).ir;
    if (!ir) return blocked;
  }
  const file = printDesignNetlist(format, ir);
  // Presentation export omits the strict printer's title. Keep that printer
  // unchanged for simulation/source offsets; a blank SPICE title below keeps
  // the first directive intact when this structural file is used as an entry.
  file.text = file.text.slice(file.text.indexOf("\n") + 1).trimStart();
  const library = options.profile?.library;
  if (library?.path) {
    const spiceLoad = library.section
      ? `.lib "${library.path}" ${library.section}`
      : `.include "${library.path}"`;
    if (format === "spice") {
      file.text = `${spiceLoad}\n${file.text}`;
    } else if (profiled?.spiceLibraryDialect) {
      file.text = file.text.replace(
        "simulator lang=spectre\n",
        `simulator lang=spice\n${spiceLoad}\nsimulator lang=spectre\n`,
      );
    } else {
      const spectreLoad = `include "${library.path}"${library.section ? ` section=${library.section}` : ""}`;
      file.text = file.text.replace(
        "simulator lang=spectre\n",
        `simulator lang=spectre\n${spectreLoad}\n`,
      );
    }
  }
  if (format === "spice") file.text = `\n${file.text}`;
  return {
    status: "ready",
    diagnostics: analysis.diagnostics,
    file,
    placeholders,
    cellCount: ir.cells.length,
    externalMasterCount: ir.externalMasters?.length ?? 0,
  };
}
