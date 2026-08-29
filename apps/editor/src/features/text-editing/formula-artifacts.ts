import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  cachedFormulaResult,
  formulaSourceHash,
  prepareFormula,
  retainFormulaArtifacts,
} from "@icm/math-typesetting/cache";
import { soleRichTextMathRun } from "@icm/model";
import type { RichTextDocument, SchematicDocument } from "@icm/model";

function formulaDocuments(document: SchematicDocument): RichTextDocument[] {
  const documents: RichTextDocument[] = [];
  for (const instance of document.instances) {
    if (instance.schematicName) documents.push(instance.schematicName);
  }
  for (const annotation of document.annotations) {
    if (annotation.content) documents.push(annotation.content);
    if (annotation.formatOverride) documents.push(annotation.formatOverride);
  }
  for (const object of document.drafting?.objects ?? []) {
    if (object.kind === "text" || object.kind === "callout") {
      documents.push(object.content);
    }
  }
  return documents;
}

export function formulaRequestsForDocument(document: SchematicDocument) {
  const requests = formulaDocuments(document).flatMap((content) => {
    const formula = soleRichTextMathRun(content);
    return formula
      ? [
          {
            latex: formula.latex,
            display: formula.display,
            profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
          } as const,
        ]
      : [];
  });
  return [
    ...new Map(
      requests.map((request) => [formulaSourceHash(request), request]),
    ).values(),
  ];
}

export async function prepareDocumentFormulaArtifacts(
  document: SchematicDocument,
): Promise<{ preparedNewArtifact: boolean; release: () => void }> {
  const requests = formulaRequestsForDocument(document);
  const preparedNewArtifact = requests.some(
    (request) => cachedFormulaResult(request) === undefined,
  );
  const release = retainFormulaArtifacts(requests);
  try {
    const results = await Promise.all(requests.map(prepareFormula));
    const failure = results.find((result) => !result.ok);
    if (failure && !failure.ok) {
      throw new Error(
        `Formula preparation failed: ${failure.diagnostic.message}`,
      );
    }
    return { preparedNewArtifact, release };
  } catch (error) {
    release();
    throw error;
  }
}
