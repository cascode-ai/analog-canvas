import { describe, expect, it } from "vitest";

import type { RichTextDocument } from "@icm/model";

import {
  measureRichTextDocument,
  richTextMetrics,
  wrapRichTextDocument,
} from "./rich-text-layout.js";
import { resolveSchematicStyleProfile } from "./style-profile.js";

const metrics = richTextMetrics(
  resolveSchematicStyleProfile("razavi-textbook-v1"),
  "label",
);

const text = (value: string): RichTextDocument => ({
  runs: [{ kind: "text", value }],
});

/** The rebuilt lines, so a test reads what a person would see. */
function lines(document: RichTextDocument): string[] {
  const out: string[] = [""];
  for (const run of document.runs) {
    if (run.kind === "line-break") out.push("");
    else if (run.kind === "text") out[out.length - 1] += run.value;
  }
  return out;
}

describe("wrapRichTextDocument", () => {
  it("breaks a long label into lines that fit the box", () => {
    const wrapped = wrapRichTextDocument(
      text("A very long bias network label indeed"),
      metrics,
      110,
    );
    expect(lines(wrapped).length).toBeGreaterThan(1);
    expect(measureRichTextDocument(wrapped, metrics).width).toBeLessThanOrEqual(
      110,
    );
    // Every word survives, in order: wrapping is a layout act, not an edit.
    expect(lines(wrapped).join(" ")).toBe(
      "A very long bias network label indeed",
    );
  });

  it("leaves a label that already fits exactly as it was", () => {
    const document = text("Bias");
    expect(wrapRichTextDocument(document, metrics, 400)).toEqual(document);
  });

  it("keeps a word wider than the box whole rather than cutting it", () => {
    // A broken identifier reads as a different identifier.
    const wrapped = wrapRichTextDocument(
      text("supercalifragilistic"),
      metrics,
      20,
    );
    expect(lines(wrapped)).toEqual(["supercalifragilistic"]);
  });

  it("never separates a subscript from what it belongs to", () => {
    const document: RichTextDocument = {
      runs: [
        { kind: "text", value: "bias current " },
        {
          kind: "span",
          style: "italic",
          children: [{ kind: "text", value: "V" }],
        },
        {
          kind: "span",
          style: "subscript",
          children: [{ kind: "text", value: "out" }],
        },
      ],
    };
    const wrapped = wrapRichTextDocument(document, metrics, 60);
    const breakAt = wrapped.runs.findIndex((run) => run.kind === "line-break");
    const stackAt = wrapped.runs.findIndex(
      (run) => run.kind === "span" && run.style === "subscript",
    );
    expect(breakAt).toBeGreaterThanOrEqual(0);
    // The break lands before the pair, never between its two halves.
    expect(wrapped.runs[stackAt - 1]).toMatchObject({ style: "italic" });
  });

  it("keeps authored breaks and does not indent a wrapped line", () => {
    const document: RichTextDocument = {
      runs: [
        { kind: "text", value: "first" },
        { kind: "line-break" },
        { kind: "text", value: "second line that must wrap somewhere" },
      ],
    };
    const wrapped = wrapRichTextDocument(document, metrics, 90);
    const rebuilt = lines(wrapped);
    expect(rebuilt[0]).toBe("first");
    expect(rebuilt.length).toBeGreaterThan(2);
    expect(rebuilt.every((line) => !/^\s/u.test(line))).toBe(true);
  });
});
