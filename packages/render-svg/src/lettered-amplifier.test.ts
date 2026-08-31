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
