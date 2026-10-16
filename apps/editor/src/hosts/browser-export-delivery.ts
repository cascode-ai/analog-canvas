import { writeClipboardText } from "./clipboard-text";
import { downloadBlob } from "./download-link";
import type { EditorExportDelivery } from "./export-delivery";

/** Current Web delivery. No native filesystem or Project-save authority. */
export const browserExportDelivery: EditorExportDelivery = {
  async deliverFile(file) {
    downloadBlob(
      new Blob([file.bytes], { type: file.mediaType }),
      file.suggestedName,
    );
    return { status: "download-requested" };
  },
  copyText: writeClipboardText,
};
