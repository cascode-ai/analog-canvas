import { describe, expect, it } from "vitest";
import { createEmptyDocument, type SchematicDocument } from "@icm/model";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

import { buildSvgScene, renderDocumentSvg } from "./render.js";

const resolver = new InMemorySymbolResolver(builtInSymbols);

function coupledDocument(
  arrow?: false,
  mirror: "none" | "horizontal" = "none",
): SchematicDocument {
  const document = createEmptyDocument("doc", "Coupled");
  document.instances.push(
    {
      id: "L1",
      symbolId: "inductor",
      reference: "L1",
      placement: { position: { x: 100, y: 100 }, rotation: 0, mirror },
    },
    {
      id: "L2",
      symbolId: "variable-inductor",
      reference: "L2",
      placement: { position: { x: 400, y: 100 }, rotation: 0, mirror: "none" },
    },
  );
  document.inductorCouplings = [
    {
      id: "K1",
      name: "TF1",
      members: [
        { instanceId: "L1", dotPin: "1" },
        { instanceId: "L2", dotPin: "P2" },
      ],
      k: "0.9",
      ...(arrow === false ? { arrow } : {}),
    },
  ];
  return document;
}

const dots = (svg: string) =>
  [
    ...svg.matchAll(/data-role="coupling-dot"[^>]*cx="([^"]+)" cy="([^"]+)"/gu),
  ].map((match) => ({ x: Number(match[1]), y: Number(match[2]) }));

describe("inductor coupling layer", () => {
  it("draws a dot at each dotted end and an arrow named by the coupling", () => {
    const svg = renderDocumentSvg(coupledDocument(), resolver);
    expect(svg).toContain('<g data-layer="inductor-couplings">');
    // Beside each winding's dotted end, off the lead on the side away from
    // its bumps: pin 1 is at the top of L1, P2 at the bottom of L2.
    expect(dots(svg)).toEqual([
      { x: 94, y: 80 },
      { x: 394, y: 110 },
    ]);
    expect(svg).toContain('data-role="coupling-arrow"');
    expect(svg).toMatch(
      /<text data-role="coupling-name"[^>]*font-style="italic" font-weight="bold">TF<tspan[^>]*>1<\/tspan><\/text>/u,
    );
    // Two arrowheads, one at each end.
    const group = /data-kind="inductor-coupling"[^>]*>(.*?)<\/g>/u.exec(
      svg,
    )![1]!;
    expect(group.match(/<polygon /gu)).toHaveLength(2);
  });

  it("follows a mirrored inductor and leaves the arrow out when hidden", () => {
    const svg = renderDocumentSvg(
      coupledDocument(false, "horizontal"),
      resolver,
    );
    expect(dots(svg)[0]).toEqual({ x: 106, y: 80 });
    expect(svg).not.toContain("coupling-arrow");
    expect(svg).not.toContain("coupling-name");
  });

  it("keeps the arrow's bow inside the scene bounds", () => {
    const document = coupledDocument();
    const withArrow = buildSvgScene(document, resolver, { margin: 0 });
    const without = buildSvgScene(
      { ...document, inductorCouplings: undefined },
      resolver,
      { margin: 0 },
    );
    // Both dots sit near the top; the arrow bows upward beyond the parts.
    expect(withArrow.viewBox.y).toBeLessThan(without.viewBox.y);
  });

  it("paints a coupling under a filter only with both inductors", () => {
    const document = coupledDocument();
    const one = buildSvgScene(document, resolver, {
      objectIds: new Set(["L1"]),
    });
    expect(one.formalBody).not.toContain("inductor-coupling");
    const both = buildSvgScene(document, resolver, {
      objectIds: new Set(["L1", "L2"]),
    });
    expect(both.formalBody).toContain('data-kind="inductor-coupling"');
  });

  it("draws nothing for a Document without couplings", () => {
    const document = coupledDocument();
    delete document.inductorCouplings;
    expect(renderDocumentSvg(document, resolver)).not.toContain(
      "inductor-couplings",
    );
  });
});
