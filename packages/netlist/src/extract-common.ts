// What every extraction stage shares: the resolved options, the portable
// identifier subset, name order, and how a finding is recorded.
import { directObjectLocator } from "@icm/derived";
import type { StableId } from "@icm/model";
import type { NetlistDiagnostic } from "./ir.js";
import type { DesignNetlistAnalysisOptions } from "./extract.js";

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;

export function isIdentifier(value: string, allowGround = false): boolean {
  return (allowGround && value === "0") || IDENTIFIER.test(value);
}

export function compareText(left: string, right: string): number {
  return left.localeCompare(right, "en", { sensitivity: "base" });
}

export function diagnostic(
  diagnostics: NetlistDiagnostic[],
  documentId: StableId,
  code: string,
  message: string,
  objectIds: StableId[] = [],
  severity: NetlistDiagnostic["severity"] = "error",
  parameter?: string,
): void {
  diagnostics.push({
    code,
    severity,
    documentId,
    objectIds,
    primary: directObjectLocator(documentId, "document", documentId),
    message,
    ...(parameter === undefined ? {} : { parameter }),
  });
}

export type ResolvedDesignNetlistAnalysisOptions =
  Required<DesignNetlistAnalysisOptions>;
