import { describe, expect, it } from "vitest";

import { createEmptyDocument } from "@icm/model";

import { executeTransaction } from "./transaction.js";

describe("formula edit validation", () => {
  it("accepts a valid atomic formula through the ordinary drafting edit", () => {
    const document = createEmptyDocument("doc", "Formula");
    const result = executeTransaction(document, {
      transactionId: "formula-valid",
      documentId: document.id,
      expectedRevision: document.revision,
      actor: { kind: "human", id: "editor" },
      edits: [
        {
          kind: "upsert_drafting_object",
          object: {
            id: "formula",
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
          },
        },
      ],
    });

    expect(result.ok).toBe(true);
  });

  it("rejects malformed formula source at its typed-edit path", () => {
    const document = createEmptyDocument("doc", "Formula");
    const result = executeTransaction(document, {
      transactionId: "formula-invalid",
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
            content: {
              runs: [
                {
                  kind: "math",
                  latex: String.raw`\frac{V_{OUT}`,
                  display: "inline",
                },
              ],
            },
            alignment: "middle",
            rotation: 0,
          },
        },
      ],
    });

    expect(result).toMatchObject({
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
