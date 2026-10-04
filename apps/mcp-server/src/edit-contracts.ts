import {
  AgentProjectStructureEditSchema,
  AgentSchematicEditSchema,
  CELL_STRUCTURE_EDIT_KINDS,
} from "@icm/agent-adapter";
import { inputContract } from "./input-contract.js";
import { compactSchema } from "./compact-schema.js";
import { ContractQueryError } from "./tool-contracts.js";

export function editContract(kind: string) {
  const option = AgentSchematicEditSchema.options.find(
    (entry) => entry.shape.kind.value === kind,
  );
  if (!option) {
    // A Project structure edit has a contract too, sent in structureEdits
    // rather than edits (#1231).
    const structure = AgentProjectStructureEditSchema.options.find(
      (entry) => entry.shape.kind.value === kind,
    );
    if (structure)
      return {
        ...compactSchema(inputContract(structure)),
        "x-transaction": {
          form: "structureEdits",
          note: "A Project structure edit: send it in advanced_transact's structureEdits, not edits. MCP supplies the structure revision.",
          example: { structureEdits: ["<edit matching this schema>"] },
        },
      };
    throw new ContractQueryError(
      "UNKNOWN_EDIT_CONTRACT",
      "Unknown canonical edit kind; use kinds from capabilities.",
    );
  }
  return {
    ...compactSchema(inputContract(option)),
    ...(CELL_STRUCTURE_EDIT_KINDS.some((value) => value === kind)
      ? {
          "x-transaction": {
            form: "structureEdits",
            note: "Wrap this edit in transact_document, not top-level edits. Use IDs/revisions from the current Snapshot; MCP supplies the outer structure revision.",
            example: {
              structureEdits: [
                {
                  kind: "transact_document",
                  documentId: "<snapshot document ID>",
                  expectedRevision: "<snapshot document revision>",
                  edits: ["<edit matching this schema>"],
                },
              ],
            },
          },
        }
      : {}),
  };
}
