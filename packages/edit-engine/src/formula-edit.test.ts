import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";

import { executeTransaction } from "./transaction.js";

describe("formula edit validation", () => {
  function upsertFormula(latex: string) {
    const document = createEmptyDocument("doc", "Formula");
    return executeTransaction(document, {
      transactionId: "formula",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "agent", id: "agent" },
      edits: [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "formula",
            kind: "text",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 100, y: 100 } },
            content: { runs: [{ kind: "math", latex, display: "inline" }] },
            alignment: "middle",
            rotation: 0,
          },
        },
      ],
    });
  }

  it("accepts a valid atomic formula through the ordinary drafting edit", () => {
    expect(upsertFormula(String.raw`A_v=\frac{g_m}{1+s/\omega_p}`).ok).toBe(
      true,
    );
  });

  it("rejects malformed formula source at its typed-edit path", () => {
    expect(upsertFormula(String.raw`\frac{V_{OUT}`)).toMatchObject({
      ok: false,
      error: { code: "INVALID_TRANSACTION" },
      diagnostics: [
        expect.objectContaining({
          path: ["edits", 0, "object", "content", "runs", 0, "latex"],
        }),
      ],
    });
  });
});
