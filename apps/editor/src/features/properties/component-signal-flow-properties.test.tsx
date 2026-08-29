import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SchematicDocument } from "@icm/model";

import { ComponentSignalFlowProperties } from "./component-signal-flow-properties";

type Instance = SchematicDocument["instances"][number];

const presentation = {
  defaultFormula: "z^-1/(1-z^-1)",
  supportsCoefficient: true as const,
  center: { x: 0, y: 0 },
  fontSize: 12,
  fractionBarWidth: 50,
  adaptiveFrame: {
    minBodyWidth: 40,
    minBodyHeight: 30,
    horizontalPadding: 8,
    verticalPadding: 1.5,
    leadLength: 20,
  },
};

describe("Signal Flow properties", () => {
  it("renders formula, coefficient, and adaptive frame controls from capability metadata", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "B1",
      symbolId: "custom-formula-block",
      placement: null,
      signalFlowParameters: {
        formula: "1/s",
        coefficient: "K",
        bodyWidth: 120,
        bodyHeight: 60,
      },
    };
    const markup = renderToStaticMarkup(
      <ComponentSignalFlowProperties
        instance={instance}
        presentation={presentation}
        revision={3}
        onChange={vi.fn()}
      />,
    );

    expect(markup).toContain("Transfer function");
    expect(markup).toContain('aria-label="Signal flow formula"');
    expect(markup).toContain('aria-label="Signal flow coefficient"');
    expect(markup).toContain('aria-label="Signal flow minimum width"');
    expect(markup).toContain('aria-label="Signal flow minimum height"');
    expect(markup).toContain('placeholder="z^-1/(1-z^-1)"');
    expect(markup).toContain('value="1/s"');
    expect(markup).toContain('value="K"');
    expect(markup).toContain('value="120"');
    expect(markup).toContain('value="60"');
    expect(markup).toContain("Reset defaults");
    expect(markup).toContain("does not change SPICE");
  });

  it("pre-fills the Symbol's own formula so it can be edited in place", () => {
    const instance: Instance = {
      id: "B2",
      symbolId: "custom-formula-block",
      placement: null,
    };
    const markup = renderToStaticMarkup(
      <ComponentSignalFlowProperties
        instance={instance}
        presentation={presentation}
        revision={1}
        onChange={vi.fn()}
      />,
    );

    // Without an override the field carries the default as a real value,
    // not only as placeholder text: the default is the starting point for
    // editing rather than something the author has to retype.
    const formulaInput =
      /<input[^>]*aria-label="Signal flow formula"[^>]*>/u.exec(markup)?.[0];
    expect(formulaInput).toBeDefined();
    expect(formulaInput).toContain('value="z^-1/(1-z^-1)"');
  });
});
