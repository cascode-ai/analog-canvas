import {
  mcpResources,
  type McpResourceDocument,
} from "./resources.generated.js";
import { RpcMethodError } from "./protocol.js";
import type { McpResourceContent, McpResourceEntry } from "./protocol.js";
import { describeToolContract, toolInputSchema } from "./operations.js";
import { editContract } from "./edit-contracts.js";

export const ADVANCED_EDITS_RESOURCE_URI =
  "analog-canvas://contract/advanced-edits";

export function listResourceTemplates() {
  return [
    {
      uriTemplate: "analog-canvas://contract/tools/{name}{?operations,field}",
      name: "Selected tool operation or field contract",
      description:
        "Comma-separated operations select canonical branches; field is an argument JSON Pointer. Same registry as describe_tool; no Project connection needed.",
      mimeType: "application/json",
    },
    {
      uriTemplate: "analog-canvas://contract/tools/{name}",
      name: "Complete tool input contract",
      description:
        "Full canonical input schema for one tool, including legacy expression trees. Reading is optional; runtime validation is unchanged.",
      mimeType: "application/schema+json",
    },
    {
      uriTemplate: "analog-canvas://contract/edits/{kind}",
      name: "One typed edit contract",
      description:
        "A single canonical edit schema with only its referenced definitions. Use an edit kind from capabilities; no full-contract download needed.",
      mimeType: "application/schema+json",
    },
  ];
}

export function listResourceEntries(): McpResourceEntry[] {
  return mcpResources.map((resource: McpResourceDocument) => ({
    uri: resource.uri,
    name: resource.name,
    description: resource.description,
    mimeType: resource.mimeType,
  }));
}

export function readResourceContent(uri: string): McpResourceContent {
  const toolPrefix = "analog-canvas://contract/tools/";
  if (uri.startsWith(toolPrefix)) {
    const parsed = new URL(uri);
    if (parsed.search) {
      for (const key of parsed.searchParams.keys())
        if (
          !["operations", "field"].includes(key) ||
          parsed.searchParams.getAll(key).length !== 1
        )
          throw new RpcMethodError(
            -32602,
            "Unknown or repeated contract selector",
          );
      try {
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify(
            describeToolContract({
              tool: decodeURIComponent(parsed.pathname.slice("/tools/".length)),
              ...(parsed.searchParams.has("operations")
                ? {
                    operations: parsed.searchParams
                      .get("operations")!
                      .split(","),
                  }
                : {}),
              ...(parsed.searchParams.has("field")
                ? { field: parsed.searchParams.get("field")! }
                : {}),
            }),
          ),
        };
      } catch {
        throw new RpcMethodError(-32602, "Invalid tool contract selector");
      }
    }
    const schema = toolInputSchema(uri.slice(toolPrefix.length));
    if (!schema) throw new RpcMethodError(-32602, "Unknown tool contract");
    return {
      uri,
      mimeType: "application/schema+json",
      text: JSON.stringify(schema),
    };
  }
  const prefix = "analog-canvas://contract/edits/";
  if (uri.startsWith(prefix)) {
    const kind = uri.slice(prefix.length);
    let schema;
    try {
      schema = editContract(kind);
    } catch {
      throw new RpcMethodError(-32602, `Unknown edit kind: ${kind}`);
    }
    return {
      uri,
      mimeType: "application/schema+json",
      text: JSON.stringify(schema),
    };
  }
  const resource = mcpResources.find(
    (candidate: McpResourceDocument) => candidate.uri === uri,
  );
  if (!resource) {
    throw new RpcMethodError(-32602, `Unknown resource: ${uri}`);
  }
  return {
    uri: resource.uri,
    mimeType: resource.mimeType,
    text: resource.text,
  };
}
