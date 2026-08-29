import {
  clearFormulaArtifactCacheForTests,
  cachedFormulaResult,
} from "@icm/math-typesetting/cache";
import { createEmptyDocument } from "@icm/model";
import { afterEach, describe, expect, it } from "vitest";

import {
  formulaRequestsForDocument,
  prepareDocumentFormulaArtifacts,
} from "./formula-artifacts";

afterEach(() => clearFormulaArtifactCacheForTests());

describe("document formula artifact preparation", () => {
  it("does not report a scene-affecting cache change without formulas", async () => {
    const document = createEmptyDocument("empty", "Empty");

    await expect(prepareDocumentFormulaArtifacts(document)).resolves.toBe(
      false,
    );
  });

  it("reports only the first preparation of one canonical formula", async () => {
    const document = createEmptyDocument("formula", "Formula");
    document.drafting!.objects.push({
      id: "formula-text",
      kind: "text",
      locked: false,
      zIndex: 0,
      anchor: { kind: "free", position: { x: 100, y: 100 } },
      content: {
        runs: [
          {
            kind: "math",
            latex: String.raw`A_v=\frac{g_m}{1+s/\omega_p}`,
            display: "inline",
          },
        ],
      },
      alignment: "middle",
      rotation: 0,
    });
    const [request] = formulaRequestsForDocument(document);

    await expect(prepareDocumentFormulaArtifacts(document)).resolves.toBe(true);
    expect(request && cachedFormulaResult(request)).toMatchObject({ ok: true });
    await expect(prepareDocumentFormulaArtifacts(document)).resolves.toBe(
      false,
    );
  });
});
