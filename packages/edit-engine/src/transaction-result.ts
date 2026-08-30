import type { SchematicDocument } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";

import type { SchematicEdit } from "./edit-schema.js";

/** Public outcome protocol for one atomic transaction execution. */
export type EditErrorCode =
  | "INVALID_TRANSACTION"
  | "DOCUMENT_MISMATCH"
  | "STALE_REVISION"
  | "OBJECT_NOT_FOUND"
  | "EDIT_PRECONDITION"
  | "EDIT_CONTEXT_REQUIRED"
  | "HISTORY_CONTEXT_REQUIRED"
  | "HISTORY_EMPTY"
  | "INVALID_RESULT"
  /** An unexpected runtime exception inside the engine or the editor's
   * transaction fence; the Project and revision are unchanged. */
  | "INTERNAL_ERROR";

export interface EditDiagnostic {
  code: string;
  severity: "error" | "warning" | "info";
  message: string;
  objectIds?: readonly string[];
  path?: ReadonlyArray<string | number>;
  parameters?: Readonly<Record<string, string | number | boolean | null>>;
}

export interface EditDiff {
  documentId: string;
  fromRevision: number;
  toRevision: number;
  editKinds: readonly SchematicEdit["kind"][];
  changedObjectIds: readonly string[];
}

export interface AppliedTransaction {
  ok: true;
  applied: boolean;
  revision: number;
  proposedRevision: number;
  document: SchematicDocument;
  diff: EditDiff;
  diagnostics: readonly EditDiagnostic[];
  /**
   * Junction endpoints the conductor-topology normalizer folded away in this
   * transaction, mapped to the Base Net whose conductor absorbed them.
   * Effect validation treats these as surviving connectivity, not as loss.
   */
  coalescedEndpoints?: ReadonlyMap<string, string>;
}

export interface RejectedTransaction {
  ok: false;
  applied: false;
  revision: number;
  document: SchematicDocument;
  error: {
    code: EditErrorCode;
    message: string;
  };
  diagnostics: readonly EditDiagnostic[];
}

export type EditTransactionResult = AppliedTransaction | RejectedTransaction;

export interface EditExecutionContext {
  symbolResolver?: SymbolResolver;
}

export function rejectTransaction(
  document: SchematicDocument,
  code: EditErrorCode,
  message: string,
  diagnostics: readonly EditDiagnostic[] = [],
  path?: ReadonlyArray<string | number>,
  objectIds?: readonly string[],
): RejectedTransaction {
  const finalDiagnostics =
    path === undefined && objectIds === undefined
      ? diagnostics
      : diagnostics.map((diagnostic) => {
          const next: EditDiagnostic = { ...diagnostic };
          if (path !== undefined) {
            next.path = diagnostic.path ? [...path, ...diagnostic.path] : path;
          }
          if (objectIds !== undefined && diagnostic.objectIds === undefined) {
            next.objectIds = objectIds;
          }
          return next;
        });
  const synthesized =
    finalDiagnostics.length > 0
      ? finalDiagnostics
      : [
          {
            code,
            severity: "error" as const,
            message,
            ...(path === undefined ? {} : { path }),
            ...(objectIds === undefined ? {} : { objectIds }),
          },
        ];
  return {
    ok: false,
    applied: false,
    revision: document.revision,
    document,
    error: { code, message },
    diagnostics: synthesized,
  };
}
