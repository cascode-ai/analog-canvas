// @vitest-environment jsdom
import { describe, expect, it } from "vitest";

import { OVERBAR_THICKNESS_EM, overbarLine } from "@icm/derived";

import { normalizeFormalSvgForSvg2Pdf } from "./svg2pdf-compat.js";

describe("a CSS overline left for the PDF (#2619)", () => {
  it("becomes a line in the shared overbar geometry", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="40" fill="#111111" style="font-size:20px"><tspan data-text-run="overbar" style="font-size:20px;text-decoration:overline">Q</tspan></text></svg>`;
    const svg = host.querySelector("svg") as SVGSVGElement;
    const span = svg.querySelector("tspan") as SVGTSpanElement;
    // jsdom lays out no text: the glyph box a browser would report.
    const box = { x: 10, y: 22, width: 14, height: 24 };
    Object.assign(span, { getBBox: () => box });

    normalizeFormalSvgForSvg2Pdf(svg);

    const line = svg.querySelector('line[data-text-decoration="overbar"]');
    expect(line).not.toBeNull();
    const expected = overbarLine({
      left: box.x,
      right: box.x + box.width,
      top: box.y,
      fontSize: 20,
    });
    expect(Number(line!.getAttribute("x1"))).toBe(expected.x1);
    expect(Number(line!.getAttribute("x2"))).toBe(expected.x2);
    expect(Number(line!.getAttribute("y1"))).toBeCloseTo(expected.y, 9);
    expect(Number(line!.getAttribute("stroke-width"))).toBeCloseTo(
      20 * OVERBAR_THICKNESS_EM,
      9,
    );
    expect(span.style.textDecoration).toBe("none");
  });

  it("leaves a bar already drawn as a line as it is", () => {
    const host = document.createElement("div");
    host.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg"><text x="10" y="40"><tspan data-text-run="overbar">Q</tspan></text><line data-text-decoration="overbar" x1="10" y1="25" x2="20" y2="25" stroke="#111111" stroke-width="1.6"/></svg>`;
    const svg = host.querySelector("svg") as SVGSVGElement;
    normalizeFormalSvgForSvg2Pdf(svg);
    expect(svg.querySelectorAll("line")).toHaveLength(1);
  });
});
