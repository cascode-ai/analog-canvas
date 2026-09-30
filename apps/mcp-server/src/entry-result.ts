import type { AgentSessionClient } from "@icm/agent-client";
import { ToolFailure } from "./operations.js";

/** Adapter presentation only. Keep the historical CLI JSON shape as well as MCP. */
export function entryResult(name: string, result: unknown) {
  if (result instanceof ToolFailure) return textResult(result.value, true);
  const failed =
    result !== null &&
    typeof result === "object" &&
    "ok" in result &&
    result.ok === false;
  if (name === "render" && !failed) {
    const response = result as Awaited<
      ReturnType<AgentSessionClient["render"]>
    >;
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              revision: response.revision,
              mode: response.artifact.mode,
              byteLength: response.artifact.byteLength,
              sha256: response.artifact.sha256,
              diagnostics: response.diagnostics.length,
            },
            null,
            2,
          ),
        },
        {
          type: "image" as const,
          data: response.artifact.data,
          mimeType: "image/svg+xml",
        },
      ],
    };
  }
  // A Gallery read with render: the figure as an image, the rest as text.
  if (
    name === "gallery_circuits" &&
    !failed &&
    result !== null &&
    typeof result === "object" &&
    "figure" in result &&
    result.figure
  ) {
    const { figure, ...rest } = result as {
      figure: {
        documentId: string;
        mediaType: string;
        data: string;
        byteLength: number;
        sha256: string;
      };
    };
    return {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(
            {
              ...rest,
              figure: {
                documentId: figure.documentId,
                mediaType: figure.mediaType,
                byteLength: figure.byteLength,
                sha256: figure.sha256,
              },
            },
            null,
            2,
          ),
        },
        {
          type: "image" as const,
          data: figure.data,
          mimeType: figure.mediaType,
        },
      ],
    };
  }
  return textResult(result, failed);
}

export function textResult(value: unknown, isError = false) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }],
    ...(isError ? { isError: true } : {}),
  };
}
