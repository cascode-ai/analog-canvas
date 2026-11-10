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
      uriTemplate: "analog-canvas://reference/{name}{?section}",
      name: "One documentation section",
      description:
        "Select an exact heading title (URL encoded), including its subsections. Omit section for the whole document.",
      mimeType: "text/markdown",
    },
    {
      uriTemplate: "analog-canvas://catalog/builtins{?symbols}",
      name: "Selected built-in symbols",
      description:
        "Comma-separated exact symbol IDs; same canonical catalog, without unrelated symbols. Omit symbols for the complete catalog.",
      mimeType: "application/json",
    },
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
  if (uri.startsWith("analog-canvas://reference/") && uri.includes("?")) {
    const parsed = new URL(uri);
    const section = parsed.searchParams.get("section");
    if (
      !section ||
      parsed.hash ||
      [...parsed.searchParams.keys()].some((key) => key !== "section") ||
      parsed.searchParams.getAll("section").length !== 1
    )
      throw new RpcMethodError(-32602, "Provide one exact section heading");
    const source = readResourceContent(uri.slice(0, uri.indexOf("?")));
    const lines = source.text.split("\n");
    let fence: string | undefined;
    const headings: { index: number; level: number; title: string }[] = [];
    lines.forEach((line, index) => {
      const marker = /^\s{0,3}(`{3,}|~{3,})/u.exec(line)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length)
          fence = undefined;
        return;
      }
      const match = !fence && /^(#{1,6}) (.+?)\s*$/u.exec(line);
      if (match && match[1] && match[2])
        headings.push({ index, level: match[1].length, title: match[2] });
    });
    const matches = headings.filter((heading) => heading.title === section);
    const start = matches[0];
    if (matches.length !== 1 || !start)
      throw new RpcMethodError(-32602, "Unknown or ambiguous section heading");
    const end =
      headings.find(
        (heading) =>
          heading.index > start.index && heading.level <= start.level,
      )?.index ?? lines.length;
    return {
      uri,
      mimeType: "text/markdown",
      text: lines.slice(start.index, end).join("\n").trimEnd() + "\n",
    };
  }
  if (uri.startsWith("analog-canvas://catalog/builtins?")) {
    const parsed = new URL(uri);
    if (
      [...parsed.searchParams.keys()].some((key) => key !== "symbols") ||
      parsed.searchParams.getAll("symbols").length !== 1
    )
      throw new RpcMethodError(-32602, "Provide one symbols selector");
    const ids = [...new Set(parsed.searchParams.get("symbols")!.split(","))];
    const catalog = JSON.parse(
      readResourceContent("analog-canvas://catalog/builtins").text,
    );
    if (ids.length > 64)
      throw new RpcMethodError(-32602, "Select at most 64 symbol IDs");
    const unknown = ids.filter(
      (id) =>
        !catalog.symbols.some(
          (symbol: { symbolId: string }) => symbol.symbolId === id,
        ),
    );
    if (unknown.length > 0)
      throw new RpcMethodError(
        -32602,
        // The caller's own selector, named back so it can be corrected.
        `Unknown symbol ID ${unknown
          .slice(0, 8)
          .map((id) => JSON.stringify(id.slice(0, 64)))
          .join(", ")}; inspect the full catalog to discover symbols`,
      );
    return {
      uri,
      mimeType: "application/json",
      text: JSON.stringify({
        ...catalog,
        symbols: catalog.symbols.filter((symbol: { symbolId: string }) =>
          ids.includes(symbol.symbolId),
        ),
      }),
    };
  }
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
