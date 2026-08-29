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

    const prepared = await prepareDocumentFormulaArtifacts(document);
    expect(prepared.preparedNewArtifact).toBe(false);
    prepared.release();
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

    const first = await prepareDocumentFormulaArtifacts(document);
    expect(first.preparedNewArtifact).toBe(true);
    expect(request && cachedFormulaResult(request)).toMatchObject({ ok: true });
    first.release();
    const second = await prepareDocumentFormulaArtifacts(document);
    expect(second.preparedNewArtifact).toBe(false);
    second.release();
  });

  it("retains every formula in an active Document beyond the LRU count", async () => {
    const document = createEmptyDocument("formula-set", "Formula Set");
    document.drafting!.objects = Array.from({ length: 130 }, (_, index) => ({
      id: `formula-${index}`,
      kind: "text" as const,
      locked: false,
      zIndex: index,
      anchor: {
        kind: "free" as const,
        position: { x: 100, y: 100 + index * 10 },
      },
      content: {
        runs: [
          {
            kind: "math" as const,
            latex: `x_{${index}}`,
            display: "inline" as const,
          },
        ],
      },
      alignment: "start" as const,
      rotation: 0 as const,
    }));
    const requests = formulaRequestsForDocument(document);

    const prepared = await prepareDocumentFormulaArtifacts(document);
    expect(requests).toHaveLength(130);
    expect(cachedFormulaResult(requests[0]!)).toMatchObject({ ok: true });
    expect(cachedFormulaResult(requests.at(-1)!)).toMatchObject({ ok: true });

    prepared.release();
    expect(cachedFormulaResult(requests[1]!)).toBeUndefined();
    expect(cachedFormulaResult(requests[0]!)).toMatchObject({ ok: true });
    expect(cachedFormulaResult(requests.at(-1)!)).toMatchObject({ ok: true });
  });
});
