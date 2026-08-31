import {
  flattenRichText,
  rewriteRichTextPlainText,
  RichTextDocumentSchema,
} from "@icm/model";

export interface Schema35To36MigrationReport {
  readonly repairedReferenceAnnotations: number;
  readonly retainedAttachedLabels: number;
  readonly changed: boolean;
}

export interface Schema35To36MigrationResult {
  readonly project: Record<string, unknown>;
  readonly report: Schema35To36MigrationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function referencePrefix(value: string): string | null {
  return /^([a-z]+)\d+(?:[_-]\d+)*$/iu.exec(value)?.[1]?.toLowerCase() ?? null;
}

/**
 * Schema 35 accidentally materialized some former styled Instance References
 * as literal attached labels. A literal identifier is repaired only when both
 * it and the owning Instance's current Reference have the same conventional
 * alphabetic prefix and numeric designator shape. Descriptive labels such as
 * `ISS`, `RD`, and prose remain independent attached RichText.
 */
function isRecoverableReferenceLabel(
  literal: string,
  reference: string,
): boolean {
  if (literal === reference) return true;
  const literalPrefix = referencePrefix(literal);
  return literalPrefix !== null && literalPrefix === referencePrefix(reference);
}

export function upgradeSchema35To36WithReport(
  raw: Record<string, unknown>,
): Schema35To36MigrationResult {
  const project = structuredClone(raw);
  let repairedReferenceAnnotations = 0;
  let retainedAttachedLabels = 0;
  const documents = Array.isArray(project.documents) ? project.documents : [];

  for (const document of documents) {
    if (!isRecord(document)) continue;
    const instances = Array.isArray(document.instances)
      ? document.instances.filter(isRecord)
      : [];
    const referenceByInstanceId = new Map(
      instances.flatMap((instance) => {
        const id = stringValue(instance.id);
        const reference = stringValue(instance.reference);
        return id && reference ? [[id, reference] as const] : [];
      }),
    );
    const annotations = Array.isArray(document.annotations)
      ? document.annotations.filter(isRecord)
      : [];

    for (const annotation of annotations) {
      if (
        annotation.kind !== "instance-label" ||
        annotation.binding !== undefined ||
        !isRecord(annotation.content) ||
        !isRecord(annotation.anchor) ||
        annotation.anchor.kind !== "object"
      ) {
        continue;
      }
      const instanceId = stringValue(annotation.anchor.objectId);
      const reference = instanceId
        ? referenceByInstanceId.get(instanceId)
        : undefined;
      const parsedContent = RichTextDocumentSchema.safeParse(
        annotation.content,
      );
      if (!instanceId || !reference || !parsedContent.success) continue;
      const literal = flattenRichText(parsedContent.data);
      if (!isRecoverableReferenceLabel(literal, reference)) {
        retainedAttachedLabels += 1;
        continue;
      }
      delete annotation.content;
      annotation.binding = { kind: "instance-reference", instanceId };
      annotation.formatOverride = rewriteRichTextPlainText(
        parsedContent.data,
        reference,
      );
      repairedReferenceAnnotations += 1;
    }
  }

  project.schemaVersion = 36;
  return {
    project,
    report: {
      repairedReferenceAnnotations,
      retainedAttachedLabels,
      changed: repairedReferenceAnnotations > 0,
    },
  };
}

export function upgradeSchema35To36(
  raw: Record<string, unknown>,
): Record<string, unknown> {
  return upgradeSchema35To36WithReport(raw).project;
}
