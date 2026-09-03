import {
  mcpResources,
  type McpResourceDocument,
} from "./resources.generated.js";
import { RpcMethodError } from "./protocol.js";
import { AgentSchematicEditSchema } from "@icm/agent-adapter";
import { z } from "zod";
import type { McpResourceContent, McpResourceEntry } from "./protocol.js";

export const ADVANCED_EDITS_RESOURCE_URI =
  "analog-canvas://contract/advanced-edits";

export function listResourceTemplates() {
  return [
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
  const prefix = "analog-canvas://contract/edits/";
  if (uri.startsWith(prefix)) {
    const kind = uri.slice(prefix.length);
    const option = AgentSchematicEditSchema.options.find(
      (entry) => entry.shape.kind.value === kind,
    );
    if (!option) throw new RpcMethodError(-32602, `Unknown edit kind: ${kind}`);
    return {
      uri,
      mimeType: "application/schema+json",
      text: JSON.stringify(
        z.toJSONSchema(option, { target: "draft-2020-12", reused: "ref" }),
      ),
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
