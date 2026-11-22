import { describe, expect, it } from "vitest";

import agentDrawing from "./film/agent.svg?raw";
import { filmDocument, filmDrawing } from "./film-page";

describe("the film's drawings", () => {
  it("keeps a formal export's viewBox and layers, not its page", () => {
    const { viewBox, layers } = filmDrawing(
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 300 200" role="img">' +
        '<title id="title">ota</title><rect x="10" y="20" width="300" height="200" fill="#fff"/>' +
        "<style>svg{font-size:15px}</style>" +
        '<g data-layer="formal"><rect x="1" y="2" width="3" height="4"/></g></svg>',
    );
    expect(viewBox).toBe("10 20 300 200");
    expect(layers).toBe(
      '<g data-layer="formal"><rect x="1" y="2" width="3" height="4"/></g>',
    );
  });

  it("refuses text that is not an SVG export", () => {
    expect(() => filmDrawing("<p>not a drawing</p>")).toThrow(
      "formal SVG export",
    );
  });
});

describe("the film's document", () => {
  const html = filmDocument();

  it("fills every slot of the template", () => {
    expect(html).not.toMatch(/%%[A-Z_]+%%/u);
    expect(html.startsWith("<!doctype html>")).toBe(true);
  });

  it("carries the label faces, the wall image and each drawing's viewBox", () => {
    expect(html).toContain('@font-face{font-family:"Metropolis"');
    expect(html).toMatch(/src"?:\s*"[^"%]+\.webp"/u);
    for (const id of ["art-ota", "art-ldo", "art-ag"])
      expect(html).toMatch(
        new RegExp(`id="${id}"[^>]*data-vb="-?[\\d.]+( -?[\\d.]+){3}"`, "u"),
      );
  });
  it("draws the three circuits from their real parts", () => {
    for (const part of ['data-object-id="M1"', 'data-symbol-id="opamp"'])
      expect(html).toContain(part);
    // Every part of the Agent's drawing arrives, as the film counts them.
    expect(html).toContain(filmDrawing(agentDrawing).layers);
  });
});
