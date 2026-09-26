import type { EditorExportDelivery } from "./export-delivery";

/** Current Web delivery. No native filesystem or Project-save authority. */
export const browserExportDelivery: EditorExportDelivery = {
  async deliverFile(file) {
    const url = URL.createObjectURL(
      new Blob([file.bytes], { type: file.mediaType }),
    );
    try {
      const anchor = window.document.createElement("a");
      anchor.href = url;
      anchor.download = file.suggestedName;
      anchor.click();
      return { status: "download-requested" };
    } finally {
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
    }
  },
  async copyText(text) {
    await navigator.clipboard.writeText(text);
  },
};
