import { operationDefinitions } from "./operations.js";
import type { ContractTool } from "./tool-contracts.js";
import { FOCUSED_TOOLS } from "./focused-tools.js";
import { declarationSchema } from "./declaration-schema.js";
import { inlineSchema } from "./inline-schema.js";
import { compactSchema } from "./compact-schema.js";

export function listToolDefinitions(): ContractTool[] {
  return operationDefinitions().map((definition) => {
    let schema = definition.inputSchema;
    if (FOCUSED_TOOLS.some((tool) => tool.name === definition.name))
      return {
        ...definition,
        inputSchema: declarationSchema(schema, definition.name),
      };
    if (
      [
        "simulation",
        "simulation_files",
        "simulation_folder",
        "connect",
      ].includes(definition.name)
    )
      return { ...definition, inputSchema: inlineSchema(schema) };
    if (definition.name === "simulation_output") {
      // The legacy depth-bounded expression tree is large even with refs.
      // Keep its full contract discoverable without loading it for native runs.
      schema = structuredClone(schema);
      for (const branch of (schema.oneOf ?? []) as Record<string, unknown>[]) {
        const properties = branch.properties as
          Record<string, unknown> | undefined;
        if (properties?.expression) {
          properties.expression = {
            type: "object",
            description:
              "Legacy output expression. Exact schema: analog-canvas://contract/tools/simulation_output. Runtime validates the complete expression.",
          };
        }
      }
    }
    const compact = compactSchema(schema);
    const advertised =
      JSON.stringify(compact).length < JSON.stringify(schema).length
        ? compact
        : schema;
    if (definition.name === "advanced_transact") {
      const properties = advertised.properties as Record<string, unknown>;
      properties.dryRun = (
        inlineSchema(schema).properties as Record<string, unknown>
      ).dryRun;
    }
    return {
      ...definition,
      inputSchema: advertised,
    };
  });
}
