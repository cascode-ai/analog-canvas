import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { buildSvgScene } from "./render.js";
import {
  normalizeSignalFlowFormula,
  parseSignalFlowFraction,
  renderSignalFlowFormula,
  signalFlowFormulaLocalBounds,
} from "./signal-flow-formula.js";

const formulaDefinition = {
  schemaVersion: 1 as const,
  id: "formula-block",
  name: "Formula block",
  viewBox: { x: -40, y: -20, width: 80, height: 40 },
  pins: [
    {
      name: "A",
      role: "input",
      at: { x: -40, y: 0 },
      direction: "west" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
    {
      name: "Y",
      role: "output",
      at: { x: 40, y: 0 },
      direction: "east" as const,
      presentation: { visibility: "visible" as const, showName: true },
    },
  ],
  primitives: [],
  variants: [],
  formulaPresentation: {
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
  },
};

const profile = {
  typography: { fontFamily: "serif", mathWeight: 600 },
  strokes: { annotation: 1 },
};

describe("Signal Flow formula renderer", () => {
  it("normalizes ASCII and Unicode superscripts before parsing textbook fractions", () => {
    expect(normalizeSignalFlowFormula("z⁻¹/(1−z⁻¹)")).toBe("z^-1/(1-z^-1)");
    expect(normalizeSignalFlowFormula("+gₘ₁")).toBe("+g_m1");
    expect(normalizeSignalFlowFormula("−gₘL")).toBe("-g_mL");
    expect(parseSignalFlowFraction("1/s")).toEqual({
      numerator: "1",
      denominator: "s",
    });
    expect(parseSignalFlowFraction("z^-1/(1-z^-1)")).toEqual({
      numerator: "z^-1",
      denominator: "1-z^-1",
    });
  });

  it("emits a 12pt stacked fraction, superscript, coefficient, and safe fallback text", () => {
    const fraction = renderSignalFlowFormula(
      formulaDefinition.formulaPresentation,
      { formula: "z⁻¹/(1−z⁻¹)", coefficient: "K" },
      { foreground: "#aabbcc", profile },
    );
    expect(fraction).toContain('data-role="signal-flow-formula"');
    expect(fraction).toContain('data-role="formula-fraction-bar"');
    expect(fraction).toContain('data-role="formula-superscript"');
    expect(fraction).toContain('data-role="formula-coefficient"');
    expect(fraction).toContain('font-size="12"');
    expect(fraction).toContain("K·");
    expect(fraction).toContain('stroke="#aabbcc"');

    const transconductance = renderSignalFlowFormula(
      { ...formulaDefinition.formulaPresentation, defaultFormula: "+g_m" },
      { formula: "−gₘL" },
      { foreground: "#000000", profile },
    );
    expect(transconductance).toContain(
      'data-role="formula-subscript" baseline-shift="sub"',
    );
    expect(transconductance).toContain(">mL</tspan>");

    const mixedScripts = renderSignalFlowFormula(
      { ...formulaDefinition.formulaPresentation, defaultFormula: "z^-1+g_m" },
      undefined,
      { foreground: "#000000", profile },
    );
    expect(mixedScripts).toContain(">-1</tspan>+g");
    expect(mixedScripts).toContain(">m</tspan>");
    expect(mixedScripts).not.toContain(">-1+g</tspan>");

    const fallback = renderSignalFlowFormula(
      formulaDefinition.formulaPresentation,
      { formula: '<script>alert("x")</script>' },
      { foreground: "#000000", profile },
    );
    expect(fallback).toContain("&lt;script&gt;");
    expect(fallback).not.toContain("<script>");
  });

  it("uses instance presentation parameters in the formal scene without changing pin identity", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "B1",
      symbolId: "formula-block",
      placement: { position: { x: 100, y: 100 }, rotation: 90, mirror: "x" },
      styleOverride: { foreground: "#123456" },
      signalFlowParameters: {
        formula: "1/s",
        coefficient: "A",
        bodyWidth: 100,
        bodyHeight: 60,
      },
    });
    const scene = buildSvgScene(
      document,
      new InMemorySymbolResolver([formulaDefinition]),
    );

    expect(scene.formalBody).toContain('data-role="signal-flow-formula"');
    expect(scene.formalBody).toContain('data-role="signal-flow-frame"');
    expect(scene.formalBody).toContain('data-role="formula-fraction-bar"');
    expect(scene.formalBody).toContain('data-role="formula-coefficient"');
    expect(scene.formalBody).toContain('stroke="#123456"');
    expect(scene.formalBody).toContain(
      'transform="translate(100 100) rotate(90) scale(-1 1)"',
    );
    expect(scene.formalBody).toContain('data-pin-name="A"');
    expect(scene.formalBody).toContain('data-pin-name="Y"');
  });

  it("expands formula and formal scene bounds for long content", () => {
    const parameters = {
      formula: "very_long_custom_transfer_function",
    };
    const formulaBounds = signalFlowFormulaLocalBounds(
      formulaDefinition.formulaPresentation,
      parameters,
    );
    expect(formulaBounds!.width).toBeGreaterThan(80);

    const document = createEmptyDocument("main", "Main");
    document.instances.push({
      id: "B1",
      symbolId: "formula-block",
      placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
      signalFlowParameters: parameters,
    });
    const scene = buildSvgScene(
      document,
      new InMemorySymbolResolver([formulaDefinition]),
      { margin: 0 },
    );

    expect(scene.viewBox.width).toBeGreaterThan(
      formulaDefinition.viewBox.width,
    );
    expect(scene.formalBody).toContain("very_long_custom_transfer_function");
    expect(scene.formalBody).toContain('data-part="input-a-lead"');
    expect(scene.formalBody).toContain('data-part="output-y-lead"');
  });
});
