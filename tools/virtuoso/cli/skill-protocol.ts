import type { prepareMappings } from "@icm/virtuoso-import/core";
import type {
  loadCatalog,
  loadFullCatalog,
} from "@icm/virtuoso-import/canvas-adapter";

export const SKILL_UI_PROTOCOL_VERSION = 1;
type Prepared = ReturnType<typeof prepareMappings>;
type Catalog = Awaited<ReturnType<typeof loadCatalog>>;
type FullCatalog = Awaited<ReturnType<typeof loadFullCatalog>>;

// This file is loaded as SKILL code. Never interpolate unescaped source text.
export function skillString(value: string): string {
  return (
    '"' +
    value
      .replace(/[\x00-\x1f\x7f]/g, " ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"') +
    '"'
  );
}

function skillStrings(values: string[]): string {
  return `list(${values.map(skillString).join(" ")})`;
}

function skillPairs(values: Record<string, string>): string {
  return `list(${Object.entries(values)
    .map(([left, right]) => skillStrings([left, right]))
    .join(" ")})`;
}

export function renderScanResult(
  snapshot: { instances: unknown[]; nets: unknown[] },
  prepared: Prepared,
  catalog: Catalog,
  fullCatalog: FullCatalog,
): string {
  const supported = catalog.map(
    (item) =>
      `list(${skillString(item.id)} ${skillStrings(item.pins)} ${skillStrings(item.parameters)})`,
  );
  const allSymbols = fullCatalog.symbols.map((item) =>
    skillStrings([
      item.id,
      item.category,
      item.pins.join(", "),
      item.conversion,
    ]),
  );
  const rules = prepared.items.map((item) => {
    const rule = item.mapping;
    const symbol =
      rule === null ? "generic-box" : "omit" in rule ? "omit" : rule.symbol;
    const pins = rule && "pins" in rule ? skillPairs(rule.pins) : "list()";
    const omitted =
      rule && "omitPins" in rule ? skillStrings(rule.omitPins) : "list()";
    const parameters =
      rule && "parameters" in rule ? skillPairs(rule.parameters) : "list()";
    return `list(${skillString(item.device)} ${skillStrings(item.pins)} ${skillStrings(item.parameters)} ${skillString(symbol)} ${pins} ${omitted} ${parameters})`;
  });
  const rows = prepared.items.map((item) => {
    const target =
      item.mapping === null
        ? "generic-box"
        : "omit" in item.mapping
          ? "omit"
          : item.mapping.symbol;
    const pinSummary = item.pins.join(", ");
    return skillStrings([
      item.device,
      String(item.instances.length),
      target,
      pinSummary,
      item.origin,
      item.status,
    ]);
  });
  return (
    [
      `VCUIAcceptCatalog(${SKILL_UI_PROTOCOL_VERSION} list(${supported.join(" ")}) list(${allSymbols.join(" ")}))`,
      `VCUIAcceptRules(${SKILL_UI_PROTOCOL_VERSION} list(${rules.join(" ")}))`,
      `VCUIAcceptScan(${SKILL_UI_PROTOCOL_VERSION} ${snapshot.instances.length} ${snapshot.nets.length} list(${rows.join(" ")}))`,
    ].join("\n") + "\n"
  );
}

export function protocolEvent(
  kind: "PROGRESS" | "DONE" | "ERROR",
  stage: string,
  detail?: string,
): string {
  const parts = ["VCUI", SKILL_UI_PROTOCOL_VERSION, kind, stage];
  if (detail) parts.push(detail.toUpperCase().replace(/[^A-Z0-9_]/g, "_"));
  return parts.join("|") + "\n";
}

export function renderMappingApplied(
  device: string,
  mode: "session" | "personal",
  file: string,
): string {
  return `VCUIAcceptMapping(${SKILL_UI_PROTOCOL_VERSION} ${skillString(device)} ${skillString(mode)} ${skillString(file)})\n`;
}

export function renderConfigResult(
  mode: "load" | "save",
  powerNets: string[],
  groundNets: string[],
  file: string,
): string {
  return `VCUIAcceptConfig(${SKILL_UI_PROTOCOL_VERSION} ${skillString(mode)} ${skillStrings(powerNets)} ${skillStrings(groundNets)} ${skillString(file)})\n`;
}

export function renderExportComplete(
  status: "success" | "success_with_warnings",
  output: string,
  projectFile: string,
  diagnostics: Array<{ severity: string; message: string }>,
): string {
  const entries = diagnostics.map((item) =>
    skillStrings([item.severity, item.message]),
  );
  return `VCUIAcceptExport(${SKILL_UI_PROTOCOL_VERSION} ${skillString(status)} ${skillString(output)} ${skillString(projectFile)} list(${entries.join(" ")}))\n`;
}

export function renderExportFailure(
  code: string,
  message: string,
  diagnosticsDirectory: string,
  details: string[],
): string {
  return `VCUIAcceptExportError(${SKILL_UI_PROTOCOL_VERSION} ${skillString(code)} ${skillString(message)} ${skillString(diagnosticsDirectory)} ${skillStrings(details)})\n`;
}
