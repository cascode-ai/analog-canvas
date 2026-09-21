import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  cachedFormulaResult,
  formulaSourceHash,
  prepareFormula,
  retainFormulaArtifacts,
  type FormulaRequest,
} from "@icm/math-typesetting/cache";
import { soleRichTextMathRun } from "@icm/model";
import type { RichTextDocument, SchematicDocument } from "@icm/model";

export function formulaRequestsForDocument(document: SchematicDocument) {
  const requests: FormulaRequest[] = [];
  const add = (
    content: RichTextDocument | undefined,
    bold = true,
    italic = false,
  ) => {
    const formula = content && soleRichTextMathRun(content);
    if (formula)
      requests.push({
        latex: formula.latex,
        display: formula.display,
        profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
        bold,
        italic,
      });
  };
  for (const annotation of document.annotations) {
    add(annotation.content);
    add(annotation.formatOverride);
  }
  for (const object of document.drafting?.objects ?? []) {
    if (object.kind === "text" || object.kind === "callout") {
      add(
        object.content,
        object.styleOverride?.weight !== "normal",
        object.styleOverride?.italic === true,
      );
    }
  }
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
