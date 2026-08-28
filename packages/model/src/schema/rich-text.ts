import { z } from "zod";
import {
  FORMULA_MAX_LATEX_LENGTH,
  validateFormulaSource,
} from "@icm/math-typesetting/profile";

export type RichTextStyle =
  "italic" | "bold" | "subscript" | "superscript" | "overbar";

export type RichTextRun =
  | { kind: "text"; value: string }
  | { kind: "line-break" }
  | {
      kind: "math";
      latex: string;
      display: "inline" | "block";
    }
  | { kind: "span"; style: RichTextStyle; children: RichTextRun[] }
  | {
      kind: "fraction";
      numerator: RichTextDocument;
      denominator: RichTextDocument;
    };

export interface RichTextDocument {
  runs: RichTextRun[];
}

const RICH_TEXT_MAX_DEPTH = 4;
const RICH_TEXT_MAX_RUNS = 64;
const RICH_TEXT_MAX_TEXT_LENGTH = 256;

function richTextRunSchema(depth: number, allowMath: boolean): z.ZodTypeAny {
  const text = z.strictObject({
    kind: z.literal("text"),
    value: z.string().min(1).max(RICH_TEXT_MAX_TEXT_LENGTH),
  });
  const lineBreak = z.strictObject({ kind: z.literal("line-break") });
  const math = z.strictObject({
    kind: z.literal("math"),
    latex: z
      .string()
      .trim()
      .min(1)
      .max(FORMULA_MAX_LATEX_LENGTH)
      .superRefine((latex, context) => {
        const diagnostic = validateFormulaSource(latex);
        if (diagnostic) {
          context.addIssue({ code: "custom", message: diagnostic.message });
        }
      }),
    display: z.enum(["inline", "block"]),
  });
  const leafSchemas = allowMath ? [text, lineBreak, math] : [text, lineBreak];
  if (depth >= RICH_TEXT_MAX_DEPTH) return z.union(leafSchemas);
  return z.union([
    ...leafSchemas,
    z.strictObject({
      kind: z.literal("span"),
      style: z.enum(["italic", "bold", "subscript", "superscript", "overbar"]),
      children: z
        .array(richTextRunSchema(depth + 1, false))
        .min(1)
        .max(RICH_TEXT_MAX_RUNS),
    }),
    z.strictObject({
      kind: z.literal("fraction"),
      numerator: richTextDocumentSchema(depth + 1),
      denominator: richTextDocumentSchema(depth + 1),
    }),
  ]);
}

function richTextDocumentSchema(depth: number): z.ZodTypeAny {
  return z
    .strictObject({
      runs: z
        .array(richTextRunSchema(depth, true))
        .min(1)
        .max(RICH_TEXT_MAX_RUNS),
    })
    .superRefine((document, context) => {
      if (
        document.runs.some(
          (run) => (run as { kind?: string }).kind === "math",
        ) &&
        document.runs.length !== 1
      ) {
        context.addIssue({
          code: "custom",
          message: "A formula is one atomic RichText document.",
          path: ["runs"],
        });
      }
    });
}

export const RichTextDocumentSchema = richTextDocumentSchema(
  0,
) as z.ZodType<RichTextDocument>;
export const RichTextRunSchema = richTextRunSchema(
  0,
  true,
) as z.ZodType<RichTextRun>;
