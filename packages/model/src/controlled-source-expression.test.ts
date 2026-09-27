import { describe, expect, it } from "vitest";
import {
  controlledSourceExpressionDocument,
  controlledSourceExpressionSource,
  defaultControlledSourceExpression,
} from "./controlled-source-expression.js";

describe("controlled-source presentation", () => {
  it.each(["vcvs", "vccs", "cccs", "ccvs"] as const)(
    "renders %s with the shared RichText subscript system without changing its spelling",
    (kind) => {
      const source = defaultControlledSourceExpression(kind);
      const document = controlledSourceExpressionDocument(source);
      expect(
        document.runs.some(
          (run) => run.kind === "span" && run.style === "subscript",
        ),
      ).toBe(true);
      expect(controlledSourceExpressionSource(document)).toBe(source);
    },
  );
});
