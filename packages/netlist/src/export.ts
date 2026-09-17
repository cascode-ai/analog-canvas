import { deviceDescriptor, requiredParameterNames } from "@icm/devices";
import type { CircuitProject } from "@icm/model";
import {
  analyzeDesignNetlist,
  type DesignNetlistAnalysisOptions,
} from "./extract.js";
import type { DesignNetlistIR, NetlistDiagnostic } from "./ir.js";
import {
  projectNetlistExportProfile,
  type NetlistExportProfile,
} from "./export-profiles.js";
import { printDesignNetlist, type NetlistFileDescriptor } from "./printers.js";
import type { NetlistPortCase } from "./net-name-codec.js";

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

/** Change only formal interface spelling and the internal nodes they own. */
function applyPortCase(ir: DesignNetlistIR, portCase: NetlistPortCase): void {
  const spell = (name: string) =>
    portCase === "upper" ? name.toUpperCase() : name.toLowerCase();
  for (const cell of ir.cells) {
    const netRenames = new Map<string, string>();
    for (const port of cell.ports) {
      const nextName = spell(port.name);
      netRenames.set(port.netName, nextName);
      port.name = nextName;
      port.netName = nextName;
    }
    for (const net of cell.nets) {
      const nextName = netRenames.get(net.name);
      if (nextName) net.name = nextName;
    }
    for (const instance of cell.instances) {
      for (const node of instance.nodes) {
        const nextNetName = netRenames.get(node.netName);
        if (nextNetName) node.netName = nextNetName;
        if (instance.deviceClass === "hierarchical") {
          node.pinName = spell(node.pinName);
        }
      }
    }
  }
  for (const master of ir.externalMasters ?? []) {
    for (const terminal of master.terminals)
      terminal.name = spell(terminal.name);
  }
}

/**
 * Whether this Cell extracts far enough to write a netlist file.
 *
 * Missing model targets and device parameters are a process-library choice,
 * not an incomplete drawing: the export writes them as TODO placeholders, so
 * they never decide this answer. Connectivity, references and interface
 * contracts do. One definition serves the editor, the Gallery badge and any
 * report, so a circuit is never called extractable in one place and not in
 * another.
 */
export function designExtractsNetlist(
  project: CircuitProject,
  options: DesignNetlistAnalysisOptions = {},
): boolean {
  return (
    createDesignNetlistExport(project, { format: "spice", ...options })
      .status === "ready"
  );
}

/**
 * Copy/export projection. Missing device values/models become undefined
 * tokens on a copy, which must then pass strict extraction. Never expose the
 * permissive authoring IR as an export or change simulation readiness.
 */
export function createDesignNetlistExport(
  source: CircuitProject,
  options: DesignNetlistAnalysisOptions & {
    profile?: NetlistExportProfile;
    portCase?: NetlistPortCase;
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
  if (options.portCase) applyPortCase(ir, options.portCase);
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
