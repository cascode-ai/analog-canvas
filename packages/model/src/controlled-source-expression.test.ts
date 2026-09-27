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
  it("numbers only the input/sensor subscript in an instance default", () => {
    expect(defaultControlledSourceExpression("vcvs", "2")).toBe("A_{v}v_{i2}");
    expect(defaultControlledSourceExpression("vccs", "3")).toBe("g_{m}v_{i3}");
    expect(defaultControlledSourceExpression("cccs", "4")).toBe("βi_{x4}");
    expect(defaultControlledSourceExpression("ccvs", "5")).toBe("R_{m}i_{x5}");
  });
});
