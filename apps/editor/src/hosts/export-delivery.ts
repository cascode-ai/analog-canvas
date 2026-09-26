/** Prepared output only: the host does not generate or modify circuit content. */
export interface ExportFile {
  bytes: BlobPart;
  mediaType: string;
  suggestedName: string;
}

export type ExportFileDeliveryResult =
  // A browser cannot confirm that a requested download reached the filesystem.
  | { status: "download-requested" }
  | { status: "saved" }
  | { status: "cancelled" };

/**
 * Export I/O supplied by the composition root. Reject on failure; resolve a
 * native write only after it completes. Export never marks a Project saved.
 */
export interface EditorExportDelivery {
  deliverFile(file: ExportFile): Promise<ExportFileDeliveryResult>;
  copyText(text: string): Promise<void>;
}
