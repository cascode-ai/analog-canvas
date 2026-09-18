import { createEmptyDocument } from "@icm/model";
import type { DraftingObject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DraftingPropertiesPanel } from "./drafting-properties-panel";

const resolver = new InMemorySymbolResolver(builtInSymbols);
const noop = () => undefined;

function arrow(styleOverride?: Record<string, unknown>): DraftingObject {
  return {
    id: "ar-1",
    kind: "arrow",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 0, y: 0 } },
    from: { kind: "free", position: { x: 0, y: 0 } },
    to: { kind: "free", position: { x: 100, y: 0 } },
    ...(styleOverride ? { styleOverride } : {}),
  } as DraftingObject;
}

function render(object: DraftingObject): string {
  const document = createEmptyDocument("doc", "Drafting");
  document.drafting = { objects: [object] };
  return renderToStaticMarkup(
    <DraftingPropertiesPanel
      document={document}
      resolver={resolver}
      object={object}
      defaultColor="#101828"
      grid={1}
      onApply={() => ({ ok: true })}
      onStackingChange={noop}
      onToggleLock={noop}
    />,
  );
}

function polarityMark(
  polarity: "positive" | "negative",
): Extract<DraftingObject, { kind: "text" }> {
  return {
    id: `polarity-${polarity}`,
    kind: "text",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 50, y: 50 } },
    content: { runs: [{ kind: "line-break" }] },
    alignment: "middle",
    rotation: 0,
    typographyToken: "label",
    polarity,
  };
}

describe("fixed polarity mark properties", () => {
  it.each(["positive", "negative"] as const)(
    "labels the %s sign as a mark rather than editable text",
    (polarity) => {
      const markup = render(polarityMark(polarity));

      expect(markup).toContain("Polarity mark");
      expect(markup).toContain("Annotation property code");
      expect(markup).not.toContain(">Text<");
      expect(markup).not.toContain("Text color");
    },
  );
});

describe("independent arrow endpoint styles", () => {
  it("exposes arrow appearance and geometry as editable code", () => {
    const markup = render(arrow());
    expect(markup).toContain("arrowShape");
    expect(markup).toContain("startStyle");
    expect(markup).toContain("endStyle");
    expect(markup).not.toContain("arrowStyle");
    expect(markup).toContain("rotation");
    expect(markup).not.toContain("bearing");
    expect(markup).toContain("tangentAngles");
    expect(markup).not.toContain('aria-label="Drawing bearing"');
  });
  it("projects legacy styles into independent start and end values", () => {
    for (const [style, start, end] of [
      [{}, "none", "medium-arrow"],
      [{ arrowHeadAt: "both" }, "medium-arrow", "medium-arrow"],
      [{ arrowHead: "none" }, "none", "none"],
      [{ arrowHeadAt: "start" }, "medium-arrow", "none"],
      [{ arrowHead: "open", arrowHeadAt: "start" }, "open-arrow", "none"],
    ] as const) {
      const markup = render(arrow(style));
      expect(markup).toContain(`&quot;startStyle&quot;: &quot;${start}&quot;`);
      expect(markup).toContain(`&quot;endStyle&quot;: &quot;${end}&quot;`);
    }
  });
  it("shows geometric width instead of curve controls for an outline", () => {
    const object = { ...arrow(), outline: { width: 30 } } as DraftingObject;
    const markup = render(object);
    expect(markup).toContain("width");
    expect(markup).not.toContain("tangentAngles");
  });
});

describe("closed-shape paint and layer", () => {
  const rectangle: DraftingObject = {
    id: "rect-1",
    kind: "rectangle",
    locked: false,
    zIndex: 0,
    anchor: { kind: "free", position: { x: 50, y: 50 } },
    center: { x: 50, y: 50 },
    width: 80,
    height: 40,
    rotation: 0,
    lineStyle: "solid",
  };

  it("offers independent border/fill paint and front/back actions", () => {
    const markup = render(rectangle);
    expect(markup).toContain("color");
    expect(markup).toContain("fillColor");
    expect(markup).toContain(">Bring to front</button>");
    expect(markup).toContain(">Send to back</button>");
    expect(markup).not.toContain("zIndex");
    expect(markup).toContain("Front is above the circuit");
    expect(markup).not.toContain('type="color"');
  });
});
