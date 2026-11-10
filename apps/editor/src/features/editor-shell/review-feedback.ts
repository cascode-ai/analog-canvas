import type { CircuitProject, ObjectLocator } from "@icm/model";

/**
 * A review comment on one drawn object, as plain text for the Agent chat: the
 * Cell, the object's name and ID, its line in the imported netlist when the
 * object came from an unconverted file, and the comment.
 */
export function reviewFeedbackText(
  project: CircuitProject,
  locator: ObjectLocator,
  label: string,
  comment: string,
): string {
  const cell = project.documents.find(({ id }) => id === locator.documentId);
  const { sourceRef } = locator;
  const file =
    sourceRef && project.source.files.find(({ id }) => id === sourceRef.fileId);
  const source =
    file &&
    sourceRef &&
    file.hash.startsWith("sha256:") &&
    !file.originalContent
      ? `${file.path}:${sourceRef.start.line}`
      : undefined;
  return [
    "Canvas review feedback",
    `Cell: ${cell?.name ?? locator.documentId}`,
    `Object: ${label} (${locator.kind} ${locator.objectId})`,
    ...(source ? [`Source: ${source}`] : []),
    "",
    comment.trim(),
  ].join("\n");
}
