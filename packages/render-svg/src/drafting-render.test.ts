import { createEmptyDocument } from "@icm/model";
import type { RichTextRun } from "@icm/model";
import {
  resolveDraftingObjectGeometry,
  resolveSchematicStyleProfile,
} from "@icm/derived";
import {
  ANALOG_CANVAS_MATH_PROFILE_ID,
  prepareFormula,
} from "@icm/math-typesetting/cache";
import { describe, expect, it } from "vitest";

import { renderDocumentSvg } from "./render.js";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";

const resolver = new InMemorySymbolResolver(builtInSymbols);

describe("drafting layer rendering", () => {
  it("renders a DraftText object in a data-layer=drafting group", () => {
    const document = createEmptyDocument("doc", "Drafting");
    document.drafting = {
      objects: [
        {
          id: "note-1",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 100 } },
          content: { runs: [{ kind: "text", value: "V_{in}" }] },
          alignment: "start",
          rotation: 0,
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-layer="drafting"');
    expect(svg).toContain('data-object-id="note-1"');
    expect(svg).toContain('data-kind="draft-text"');
    // The flat text projection preserves the literal value; full tspan
    // rendering is covered by the rich-text rendering contract.
    expect(svg).toContain("V_{in}");
  });

  it("escapes XML-significant characters in draft text", () => {
    const document = createEmptyDocument("doc", "Drafting");
    document.drafting = {
      objects: [
        {
          id: "note-2",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          content: { runs: [{ kind: "text", value: "a<b>&c" }] },
          alignment: "start",
          rotation: 0,
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain("a&lt;b&gt;&amp;c");
    expect(svg).not.toContain("a<b>&c");
  });

  it("renders an atomic formula as aligned vector paths", async () => {
    const document = createEmptyDocument("doc", "Formula");
    document.drafting = {
      objects: [
        {
          id: "formula-1",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 100 } },
          content: {
            runs: [
              {
                kind: "math",
                latex: String.raw`A_v=\frac{g_m}{1+s/\omega_p}`,
                display: "inline",
              },
            ],
          },
          alignment: "middle",
          rotation: 0,
        },
      ],
    };

    await prepareFormula({
      latex: String.raw`A_v=\frac{g_m}{1+s/\omega_p}`,
      display: "inline",
      profileId: ANALOG_CANVAS_MATH_PROFILE_ID,
    });
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-object-id="formula-1"');
    expect(svg).toContain('data-role="formula"');
    expect(svg).toContain("data-icm-formula=");
    expect(svg).toContain("<path");
    expect(svg).not.toContain("<foreignObject");
  });

  it.each([
    ["both", 3],
    ["positive", 2],
    ["negative", 1],
  ] as const)(
    "renders the %s polarity label with fixed vector marks",
    (polarity, lineCount) => {
      const document = createEmptyDocument("doc", "Polarity label");
      document.drafting = {
        objects: [
          {
            id: `polarity-${polarity}`,
            kind: "text",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 100, y: 100 } },
            content: { runs: [{ kind: "text", value: "V_x" }] },
            alignment: "middle",
            rotation: 90,
            typographyToken: "label",
            polarity,
          },
        ],
      };

      const svg = renderDocumentSvg(document, resolver);
      const group = svg.match(
        new RegExp(
          `<g data-object-id="polarity-${polarity}" data-kind="draft-text"[\\s\\S]*?</g>`,
          "u",
        ),
      )?.[0];
      expect(group).toBeDefined();
      expect(group?.match(/data-role="polarity-/gu)).toHaveLength(lineCount);
      expect(group).toContain('transform="rotate(90 100 100)"');
      expect(group).toContain("V_x");
    },
  );

  it("renders a squared subscript under one explicit overbar", () => {
    const document = createEmptyDocument("doc", "Squared noise current");
    document.drafting = {
      objects: [
        {
          id: "noise-current",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 100 } },
          content: {
            runs: [
              {
                kind: "span",
                style: "overbar",
                children: [
                  { kind: "text", value: "I" },
                  {
                    kind: "span",
                    style: "subscript",
                    children: [{ kind: "text", value: "n2" }],
                  },
                  {
                    kind: "span",
                    style: "superscript",
                    children: [{ kind: "text", value: "2" }],
                  },
                ],
              },
            ],
          },
          alignment: "start",
          rotation: 0,
        },
      ],
    };

    const svg = renderDocumentSvg(document, resolver);
    const subscript = svg.match(
      /<tspan data-text-run="subscript" x="([^"]+)" y="([^"]+)"/u,
    );
    const superscript = svg.match(
      /<tspan data-text-run="superscript" x="([^"]+)" y="([^"]+)"/u,
    );

    expect(subscript).not.toBeNull();
    expect(superscript).not.toBeNull();
    expect(subscript?.[1]).toBe(superscript?.[1]);
    expect(Number(superscript?.[2])).toBeLessThan(Number(subscript?.[2]));
    expect(svg.match(/data-text-decoration="overbar"/gu)).toHaveLength(1);
    expect(svg).not.toContain("&#160;");
  });

  it("omits the drafting group when there are no drafting objects", () => {
    const document = createEmptyDocument("doc", "Empty");
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).not.toContain('data-layer="drafting"');
  });

  it("renders a construction-line with dashed style", () => {
    const document = createEmptyDocument("doc", "Drafting");
    document.drafting = {
      objects: [
        {
          id: "cl-1",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          points: [
            { x: 0, y: 0 },
            { x: 100, y: 0 },
          ],
          lineStyle: "dashed",
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-kind="construction-line"');
    expect(svg).toContain("stroke-dasharray");
  });

  it("renders a rotated outline rectangle with drafting stroke style", () => {
    const document = createEmptyDocument("doc", "Rectangle");
    document.drafting = {
      objects: [
        {
          id: "rect-1",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          width: 80,
          height: 40,
          rotation: 0,
          lineStyle: "dotted",
          styleOverride: { strokeScale: 1.5 },
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-kind="draft-rectangle"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-dasharray="2 3"');
    expect(svg).toContain('points="10,30 90,30 90,70 10,70"');
  });

  it("renders an orientation-free outline circle with the shared drafting style", () => {
    const document = createEmptyDocument("doc", "Circle");
    document.drafting = {
      objects: [
        {
          id: "circle-1",
          kind: "circle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          radius: 30,
          lineStyle: "dashed",
          styleOverride: { strokeScale: 1.5 },
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-kind="draft-circle"');
    expect(svg).toContain('cx="50" cy="50" r="30"');
    expect(svg).toContain('fill="none"');
    expect(svg).toContain('stroke-dasharray="6 4"');
  });

  it("honors an explicit color and a precise stroke multiplier", () => {
    const document = createEmptyDocument("doc", "Styled");
    document.drafting = {
      objects: [
        {
          id: "circle-red",
          kind: "circle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          center: { x: 50, y: 50 },
          radius: 20,
          lineStyle: "solid",
          styleOverride: { strokeScale: 1.35, color: "#cc2200" },
        },
        {
          id: "rect-blue",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 150, y: 50 } },
          center: { x: 150, y: 50 },
          width: 40,
          height: 20,
          rotation: 0,
          lineStyle: "solid",
          styleOverride: { color: "#0044cc" },
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('stroke="#cc2200"');
    expect(svg).toContain('stroke="#0044cc"');
    const circle = svg.match(
      /<circle[^>]*data-kind="draft-circle"[^>]*\/>/u,
    )![0];
    const width = Number(circle.match(/stroke-width="([\d.]+)"/u)![1]);
    const rect = svg.match(
      /<polygon[^>]*data-kind="draft-rectangle"[^>]*\/>/u,
    )![0];
    const base = Number(rect.match(/stroke-width="([\d.]+)"/u)![1]);
    expect(width).toBeCloseTo(base * 1.35, 5);
  });

  it("composes object stroke over the document scale multiplicatively", () => {
    const document = createEmptyDocument("doc", "Composed");
    document.presentation.styleOverrides = { annotationStrokeScale: 1.5 };
    document.drafting = {
      objects: [
        {
          id: "circle-base",
          kind: "circle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 40, y: 40 } },
          center: { x: 40, y: 40 },
          radius: 10,
          lineStyle: "solid",
        },
        {
          id: "circle-scaled",
          kind: "circle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 90, y: 40 } },
          center: { x: 90, y: 40 },
          radius: 10,
          lineStyle: "solid",
          styleOverride: { strokeScale: 1.5 },
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    const widths = [
      ...svg.matchAll(/data-kind="draft-circle"[^>]*stroke-width="([\d.]+)"/gu),
    ].map((match) => Number(match[1]));
    // Document 1.5x lifts both; the per-object 1.5x stacks to 2.25x overall.
    expect(widths).toHaveLength(2);
    expect(widths[1]! / widths[0]!).toBeCloseTo(1.5, 5);
  });

  it("renders a draft arrow with a head", () => {
    const document = createEmptyDocument("doc", "Drafting");
    document.drafting = {
      objects: [
        {
          id: "ar-1",
          kind: "arrow",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          from: { kind: "free", position: { x: 0, y: 0 } },
          to: { kind: "free", position: { x: 100, y: 0 } },
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-kind="draft-arrow"');
    expect(svg).toContain("<polygon");
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );
    expect(svg).toContain(
      `${100 - profile.annotations.arrowHeadLength},${
        -profile.annotations.arrowHeadWidth / 2
      }`,
    );
    expect(svg).toContain(
      `points="0,0 ${100 - profile.annotations.arrowHeadLength},0"`,
    );
  });

  it("keeps the head in proportion when the shaft thickens", () => {
    // A head held at profile size while the shaft thickened stopped being a
    // head: at the widest stroke its base corners barely cleared the shaft,
    // so the point read as a stub with the shaft showing through beside it.
    const headWidthAt = (strokeScale: 0.75 | 1 | 1.5 | 2) => {
      const document = createEmptyDocument("doc", "Drafting");
      document.drafting = {
        objects: [
          {
            id: "ar-1",
            kind: "arrow",
            locked: false,
            zIndex: 0,
            anchor: { kind: "free", position: { x: 0, y: 300 } },
            from: { kind: "free", position: { x: 0, y: 300 } },
            to: { kind: "free", position: { x: 0, y: 0 } },
            styleOverride: { strokeScale },
          },
        ],
      };
      const svg = renderDocumentSvg(document, resolver);
      const points = /<polygon points="([^"]+)"/u.exec(svg)![1]!.split(" ");
      const xs = points.map((point) => Number(point.split(",")[0]));
      const stroke = Number(/stroke-width="([\d.]+)"/u.exec(svg)![1]);
      return { width: Math.max(...xs) - Math.min(...xs), stroke };
    };

    const thin = headWidthAt(1);
    const thick = headWidthAt(2);
    // Twice the shaft is twice the head, so the shape is unchanged.
    expect(thick.stroke / thin.stroke).toBeCloseTo(2, 5);
    expect(thick.width / thin.width).toBeCloseTo(2, 5);
    // And the head stays comfortably wider than the shaft it caps.
    for (const measured of [thin, thick, headWidthAt(0.75), headWidthAt(1.5)]) {
      expect(measured.width / measured.stroke).toBeGreaterThan(3);
    }
  });

  it("honors the constrained arrow-head override", () => {
    const document = createEmptyDocument("doc", "Drafting");
    document.drafting = {
      objects: [
        {
          id: "shaft-only",
          kind: "arrow",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          from: { kind: "free", position: { x: 0, y: 0 } },
          to: { kind: "free", position: { x: 100, y: 0 } },
          styleOverride: { arrowHead: "none" },
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-kind="draft-arrow"');
    expect(svg).not.toContain("<polygon");
  });

  it("renders a curved arrow as a path and aims its head along the final tangent", () => {
    const document = createEmptyDocument("doc", "Bent arrow");
    document.drafting = {
      objects: [
        {
          id: "bent-arrow",
          kind: "arrow",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          from: { kind: "free", position: { x: 0, y: 0 } },
          to: { kind: "free", position: { x: 100, y: 0 } },
          curveControls: [{ x: 50, y: 50 }],
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('<path d="M 0 0 Q 50 50');
    // The curve's endpoint tangent is (100,0) - (50,50), not the overall
    // straight chord. The polygon base must therefore leave both x and y;
    // a horizontal head would have both base vertices symmetric about y = 0.
    const polygon = svg.match(/<polygon points="([^"]+)"/)?.[1];
    expect(polygon).toBeDefined();
    const vertices = polygon!
      .split(" ")
      .map((vertex) => vertex.split(",").map(Number));
    expect(vertices[0]).toEqual([100, 0]);
    const baseCenter = {
      x: (vertices[1]![0]! + vertices[2]![0]!) / 2,
      y: (vertices[1]![1]! + vertices[2]![1]!) / 2,
    };
    // Tip − base centre is parallel to the final quadratic tangent (50,-50).
    const headDirection = { x: 100 - baseCenter.x, y: -baseCenter.y };
    expect(headDirection.x).toBeGreaterThan(0);
    expect(headDirection.y).toBeLessThan(0);
    expect(Math.abs(headDirection.x)).toBeCloseTo(Math.abs(headDirection.y), 6);
  });

  it("renders a floating symbol with its primitives", () => {
    const document = createEmptyDocument("doc", "Drafting");
    document.drafting = {
      objects: [
        {
          id: "fs-1",
          kind: "floating-symbol",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 50, y: 50 } },
          symbolId: "resistor",
          transform: { rotation: 0, mirror: "none" },
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-kind="draft-floating-symbol"');
    expect(svg).toContain('data-symbol-id="resistor"');
  });

  it("includes drafting bounds in the export viewBox", () => {
    const document = createEmptyDocument("doc", "Bounds");
    document.drafting = {
      objects: [
        {
          id: "cl-1",
          kind: "construction-line",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 0, y: 0 } },
          points: [
            { x: 50, y: 50 },
            { x: 500, y: 300 },
          ],
          lineStyle: "dashed",
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    // viewBox must cover the line's padded bounds.
    const viewBox = svg.match(
      /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/,
    );
    expect(viewBox).toBeTruthy();
    const numbers = viewBox!.slice(1).map(Number);
    const [x, y, width, height] = numbers as [number, number, number, number];
    expect(x).toBeLessThanOrEqual(44);
    expect(y).toBeLessThanOrEqual(44);
    expect(x + width).toBeGreaterThanOrEqual(512);
    expect(y + height).toBeGreaterThanOrEqual(312);
  });

  it("exports a fallback-anchored object with data-anchor-resolved=false", () => {
    const document = createEmptyDocument("doc", "Fallback");
    document.drafting = {
      objects: [
        {
          id: "t1",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor: {
            kind: "object",
            objectId: "missing",
            localOffset: { x: 0, y: 0 },
            fallbackPosition: { x: 40, y: 40 },
          },
          content: { runs: [{ kind: "text", value: "lost" }] },
          alignment: "start",
          rotation: 0,
        },
      ],
    };
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-anchor-resolved="false"');
    expect(svg).toContain(">lost</text>");
  });
});

describe("instance value fraction rendering", () => {
  it("renders a whole-annotation fraction with a real fraction bar", () => {
    const document = createEmptyDocument("doc", "Value fraction");
    document.instances.push({
      id: "M1",
      symbolId: "nmos",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
    });
    document.annotations.push({
      id: "instance-value-M1",
      kind: "instance-value",
      content: {
        runs: [
          {
            kind: "fraction",
            numerator: {
              runs: [
                {
                  kind: "span",
                  style: "bold",
                  children: [{ kind: "text", value: "10um" }],
                },
              ],
            },
            denominator: {
              runs: [
                {
                  kind: "span",
                  style: "bold",
                  children: [{ kind: "text", value: "150nm" }],
                },
              ],
            },
          },
        ],
      },
      anchor: {
        kind: "object",
        objectId: "M1",
        localOffset: { x: 40, y: 30 },
        fallbackPosition: { x: 140, y: 130 },
      },
      alignment: "start",
      rotation: 0,
      locked: false,
    });
    const svg = renderDocumentSvg(document, resolver);
    expect(svg).toContain('data-kind="instance-value"');
    expect(svg).toContain('data-role="fraction-numerator"');
    expect(svg).toContain('data-role="fraction-denominator"');
    expect(svg).toContain('data-role="fraction-bar"');
    expect(svg).toContain(">10um<");
    expect(svg).toContain(">150nm<");
    // Fraction parts render three A+ levels (30%) above the subscript scale:
    // 15.116 × (0.76 × 1.3) ≈ 14.93px, roughly level with the reference label.
    expect(svg).toContain('font-size="14.93"');
  });
});

describe("object-anchored drafting text centering", () => {
  const CENTERED_CAP_BASELINE_RATIO = 0.35;

  function labelDocument(runs: RichTextRun[], anchorKind: "object" | "free") {
    const document = createEmptyDocument("doc", "Centered");
    document.drafting = {
      objects: [
        {
          id: "box-1",
          kind: "rectangle",
          locked: false,
          zIndex: 0,
          anchor: { kind: "free", position: { x: 100, y: 60 } },
          center: { x: 100, y: 60 },
          width: 80,
          height: 40,
          rotation: 0,
          lineStyle: "solid",
        },
        {
          id: "label-1",
          kind: "text",
          locked: false,
          zIndex: 0,
          anchor:
            anchorKind === "object"
              ? {
                  kind: "object",
                  objectId: "box-1",
                  localOffset: { x: 0, y: 0 },
                  fallbackPosition: { x: 100, y: 60 },
                }
              : { kind: "free", position: { x: 100, y: 60 } },
          content: { runs },
          alignment: "middle",
          rotation: 0,
          typographyToken: "label",
        },
      ],
    };
    return document;
  }

  function textBaselineY(svg: string, objectId: string): number {
    const match = svg.match(
      new RegExp(`data-object-id="${objectId}"[^>]*\\by="([-0-9.]+)"`),
    );
    if (!match) throw new Error(`no <text> y for ${objectId}`);
    return Number(match[1]);
  }

  it("centers a single-line label on the rectangle center", () => {
    const document = labelDocument([{ kind: "text", value: "PFD" }], "object");
    const svg = renderDocumentSvg(document, resolver);
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );
    const fontSize = profile.typography.annotationFontSize;
    expect(textBaselineY(svg, "label-1")).toBeCloseTo(
      60 + CENTERED_CAP_BASELINE_RATIO * fontSize,
    );
    expect(svg).toContain('text-anchor="middle"');
  });

  it("shifts a multi-line label up by half the extra line steps", () => {
    const document = labelDocument(
      [
        { kind: "text", value: "Clock Recovery" },
        { kind: "line-break" },
        { kind: "text", value: "Circuit" },
      ],
      "object",
    );
    const svg = renderDocumentSvg(document, resolver);
    const profile = resolveSchematicStyleProfile(
      document.presentation.styleProfileId,
    );
    const fontSize = profile.typography.annotationFontSize;
    const lineStep = fontSize * profile.typography.lineHeight;
    // Count the lines actually drawn rather than the ones authored: a label
    // inside a box also wraps to it, and the centering rule is about however
    // many lines end up there.
    const lines = (svg.match(/data-text-run="line-break"/gu) ?? []).length + 1;
    expect(lines).toBeGreaterThan(1);
    expect(textBaselineY(svg, "label-1")).toBeCloseTo(
      60 -
        ((lines - 1) * lineStep) / 2 +
        CENTERED_CAP_BASELINE_RATIO * fontSize,
    );
  });

  it("wraps a boxed label and draws exactly the lines it measured", () => {
    const document = labelDocument(
      [{ kind: "text", value: "A very long bias network label indeed" }],
      "object",
    );
    const svg = renderDocumentSvg(document, resolver);
    const lines = (svg.match(/data-text-run="line-break"/gu) ?? []).length + 1;
    expect(lines).toBeGreaterThan(1);

    // The drawn lines are the ones the geometry measured its bounds from, so
    // a selection box cannot come away from the text it frames.
    const label = document.drafting!.objects[1]!;
    const geometry = resolveDraftingObjectGeometry(document, resolver, label);
    if (geometry.kind !== "text") throw new Error("expected text geometry");
    expect(geometry.bounds.width).toBeLessThanOrEqual(80);
  });

  it("keeps free text on its first-line baseline unchanged", () => {
    const document = labelDocument([{ kind: "text", value: "PFD" }], "free");
    const svg = renderDocumentSvg(document, resolver);
    expect(textBaselineY(svg, "label-1")).toBe(60);
  });
});
