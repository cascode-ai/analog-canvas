import { createEmptyDocument } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { describe, expect, it } from "vitest";

import { renderDocumentSvg } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function documentWithAmplifiers(
  symbolId: string,
  letters: readonly (string | undefined)[],
) {
  const document = createEmptyDocument("main", "Main");
  letters.forEach((letter, index) => {
    document.instances.push({
      id: `A${index + 1}`,
      symbolId,
      placement: {
        position: { x: 100 + index * 200, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      ...(letter === undefined
        ? {}
        : { signalFlowParameters: { formula: letter } }),
    });
  });
  return document;
}

function letters(svg: string): string[] {
  return [...svg.matchAll(/data-role="formula-text"[^>]*>(.*?)<\/text>/gu)].map(
    (match) => match[1]!.replace(/<[^>]*>/gu, ""),
  );
}

describe("lettered amplifier body text", () => {
  it("draws the default A and lets each Instance own its own letter", () => {
    // The point of the feature: one sheet with a gain stage, a buffer and an
    // unlabelled stage, all the same part.
    const document = documentWithAmplifiers("opamp-lettered", [
      undefined,
      "G",
      "B",
    ]);
    expect(letters(renderDocumentSvg(document, resolver))).toEqual([
      "A",
      "G",
      "B",
    ]);
  });

  it("centres the letter on the triangle, clear of the polarity marks", () => {
    const svg = renderDocumentSvg(
      documentWithAmplifiers("opamp-lettered", [undefined]),
      resolver,
    );
    const text = /<text data-role="formula-text" x="([-\d.]+)"/u.exec(svg);
    expect(text).not.toBeNull();
    // Symbol-local -10.13: the triangle's centroid, right of the marks at -18.
    expect(Number(text![1])).toBeCloseTo(-10.13, 2);
  });

  it("gives the voltage amplifier the same editable body letter", () => {
    const svg = renderDocumentSvg(
      documentWithAmplifiers("voltage-amplifier-lettered", [undefined, "K"]),
      resolver,
    );
    expect(letters(svg)).toEqual(["A", "K"]);
  });

  it("leaves the plain amplifiers unlettered", () => {
    for (const symbolId of ["opamp", "voltage-amplifier"]) {
      const svg = renderDocumentSvg(
        documentWithAmplifiers(symbolId, [undefined]),
        resolver,
      );
      expect(letters(svg)).toEqual([]);
    }
  });
});

describe("editable body text as a general Symbol capability", () => {
  /**
   * The amplifiers are the first user, not the only one: a Symbol declares
   * where its body text sits and what it says by default, and the Instance
   * owns the text. This proves the contract on a Symbol that is not an
   * amplifier and whose default is a word rather than a letter — the shape
   * a converter block (ADC, DAC) needs.
   */
  const blockWithBodyText = (id: string, defaultText: string) => ({
    schemaVersion: 1 as const,
    id,
    name: `${defaultText} block`,
    viewBox: { x: -30, y: -20, width: 60, height: 40 },
    pins: [
      {
        name: "IN",
        role: "input",
        at: { x: -30, y: 0 },
        direction: "west" as const,
        presentation: { visibility: "visible" as const, leadLength: 10 },
      },
      {
        name: "OUT",
        role: "output",
        at: { x: 30, y: 0 },
        direction: "east" as const,
        presentation: { visibility: "visible" as const, leadLength: 10 },
      },
    ],
    primitives: [
      {
        kind: "polygon" as const,
        points: [
          { x: -20, y: -15 },
          { x: 10, y: -15 },
          { x: 20, y: 0 },
          { x: 10, y: 15 },
          { x: -20, y: 15 },
        ],
        fill: "none" as const,
      },
    ],
    variants: [],
    formulaPresentation: {
      defaultFormula: defaultText,
      supportsCoefficient: false,
      center: { x: -2, y: 0 },
      fontSize: 12,
    },
  });

  it("carries a multi-character default and a per-Instance override", () => {
    const adc = blockWithBodyText("probe-adc", "ADC");
    const dac = blockWithBodyText("probe-dac", "DAC");
    const blockResolver = new InMemorySymbolResolver([
      ...builtInSymbols,
      adc,
      dac,
    ]);
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "U1",
        symbolId: "probe-adc",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "U2",
        symbolId: "probe-adc",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        signalFlowParameters: { formula: "SAR ADC" },
      },
      {
        id: "U3",
        symbolId: "probe-dac",
        placement: {
          position: { x: 500, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
    );

    expect(letters(renderDocumentSvg(document, blockResolver))).toEqual([
      "ADC",
      "SAR ADC",
      "DAC",
    ]);
  });
});

describe("converter blocks carry the same editable body text", () => {
  it("renders ADC and DAC defaults and honours a per-Instance override", () => {
    const document = createEmptyDocument("main", "Main");
    document.instances.push(
      {
        id: "U1",
        symbolId: "adc",
        placement: {
          position: { x: 100, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "U2",
        symbolId: "dac",
        placement: {
          position: { x: 300, y: 100 },
          rotation: 0,
          mirror: "none",
        },
      },
      {
        id: "U3",
        symbolId: "adc",
        placement: {
          position: { x: 500, y: 100 },
          rotation: 0,
          mirror: "none",
        },
        signalFlowParameters: { formula: "12b ADC" },
      },
    );
    expect(letters(renderDocumentSvg(document, resolver))).toEqual([
      "ADC",
      "DAC",
      "12b ADC",
    ]);
  });
});
