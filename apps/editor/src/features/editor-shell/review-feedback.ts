import type { CircuitProject, ObjectLocator } from "@icm/model";

/**
 * A review comment on one drawn object, as plain text for the Agent chat: the
 * Cell, the object's name and ID, its line in the imported netlist when the
 * object came from one, and the comment.
 */
export async function reviewFeedbackText(
  project: CircuitProject,
  locator: ObjectLocator,
  label: string,
  comment: string,
): Promise<string> {
  const cell = project.documents.find(({ id }) => id === locator.documentId);
  const { sourceRef } = locator;
  const file =
    sourceRef && project.source.files.find(({ id }) => id === sourceRef.fileId);
  let line: number | undefined;
  if (file && sourceRef && file.hash.startsWith("sha256:")) {
    line = sourceRef.start.line;
    // A converted file (Spectre) names the line of the file as delivered.
    if (file.originalContent) {
      const { originalSourceLine } =
        await import("../netlist-export/convert-import-sources");
      line = originalSourceLine(file, line);
    }
  }
  return [
    "Canvas review feedback",
    `Cell: ${cell?.name ?? locator.documentId}`,
    `Object: ${label} (${locator.kind} ${locator.objectId})`,
    ...(file && line ? [`Source: ${file.path}:${line}`] : []),
    "",
    comment.trim(),
  ].join("\n");
}
