import type { EditorServices } from "./editor-services";

/** No Cloud adapter or identity provider is constructed for the preview. */
export function createPreviewEditorServices(): EditorServices {
  return {
    identity: null,
    projectStore: null,
    capabilities: {
      community: false,
      agent: false,
      simulation: false,
      externalLinks: false,
    },
    exportDelivery: {
      async deliverFile(file) {
        const response = await fetch("/desktop/export", {
          method: "POST",
          headers: {
            "content-type": file.mediaType,
            "x-export-name": encodeURIComponent(file.suggestedName),
          },
          body: new Blob([file.bytes], { type: file.mediaType }),
        });
        if (!response.ok)
          throw new Error(`File export failed (${response.status})`);
        const result = (await response.json()) as {
          status?: string;
          message?: string;
        };
        if (result.status === "saved" || result.status === "cancelled")
          return { status: result.status };
        throw new Error(result.message ?? "File export failed");
      },
      copyText: (text) => navigator.clipboard.writeText(text),
    },
  };
}
