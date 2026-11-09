import type { SourceSpan } from "@icm/model";

import type { SpiceDiagnostic } from "./diagnostics.js";
import type { SpiceSyntaxFile } from "./syntax.js";

export interface SpiceSourceInput {
  path: string;
  bytes: Uint8Array;
}

export interface SpiceSourceFile {
  id: string;
  path: string;
  hash: string;
  encoding: "utf-8" | "utf-8-bom" | "utf-16-le" | "utf-16-be";
  text: string;
}

export interface SpiceDependency {
  sourceFileId: string;
  requestedPath: string;
  resolvedPath: string | null;
  targetFileId: string | null;
  status:
    "resolved" | "duplicate" | "missing" | "cycle" | "denied" | "external";
  section?: string;
  sourceRef: SourceSpan;
}

export interface SourceBundle {
  entryPath: string;
  entryFileId: string | null;
  files: SpiceSourceFile[];
  syntaxFiles: SpiceSyntaxFile[];
  dependencies: SpiceDependency[];
  diagnostics: SpiceDiagnostic[];
}
