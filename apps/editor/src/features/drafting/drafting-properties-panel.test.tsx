import { createEmptyDocument } from "@icm/model";
import type { DraftingObject } from "@icm/model";
import { InMemorySymbolResolver, builtInSymbols } from "@icm/symbols";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { DraftingPropertiesPanel } from "./drafting-properties-panel";
import { ArrowStylePicker } from "./arrow-style-picker";
import { DEFAULT_ARROW_PRESET } from "./arrow-presets";

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
      inspectorSegment={null}
      tangentInput={null}
      bearingInput={null}
      onInspectorSegmentChange={noop}
      onTangentInputChange={noop}
      onBearingInputChange={noop}
      onStyleChange={noop}
      onGeometryChange={noop}
      onTangentAngleChange={noop}
      onBearingChange={noop}
      onArrowPresetChange={noop}
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
      expect(markup).toContain("Mark color");
      expect(markup).not.toContain(">Text<");
      expect(markup).not.toContain("Text color");
    },
  );
});

describe("unified arrow styles", () => {
  it("offers one gallery and no redundant head/rotate/reverse controls", () => {
    const markup = render(arrow());
    expect(markup).toContain('aria-label="Arrow style"');
    expect(markup).toContain('aria-label="Filled double arrow"');
    expect(markup).toContain('aria-label="Outline end arrow"');
    expect(markup).not.toContain('aria-label="Arrow head');
    expect(markup).not.toContain(">Reverse<");
    expect(markup).not.toContain(">Rotate<");
    expect(markup).toContain('aria-label="Drawing bearing"');
  });
  it.each(["Arrow style", "New arrow style"])(
    "%s omits reversed line arrows and the headless line",
    (label) => {
      const markup = renderToStaticMarkup(
        <ArrowStylePicker
          value={DEFAULT_ARROW_PRESET}
          onChange={noop}
          label={label}
        />,
      );
      for (const name of [
        "Filled start arrow",
        "Open start arrow",
        "No head",
      ]) {
        expect(markup).not.toContain(`aria-label="${name}"`);
      }
      for (const name of [
        "Filled end arrow",
        "Open end arrow",
        "Filled double arrow",
        "Open double arrow",
        "Outline end arrow",
        "Outline start arrow",
        "Outline double arrow",
      ]) {
        expect(markup).toContain(`aria-label="${name}"`);
      }
    },
  );
  it("recognizes legacy trailing, reversed, both and no-head styles", () => {
    expect(render(arrow())).toContain('title="Arrow style: Filled end arrow"');
    expect(render(arrow({ arrowHeadAt: "both" }))).toContain(
      'title="Arrow style: Filled double arrow"',
    );
    expect(render(arrow({ arrowHead: "none" }))).toContain(
      'title="Arrow style: No head"',
    );
    expect(render(arrow({ arrowHeadAt: "start" }))).toContain(
      'title="Arrow style: Filled start arrow"',
    );
    expect(
      render(arrow({ arrowHead: "open", arrowHeadAt: "start" })),
    ).toContain('title="Arrow style: Open start arrow"');
  });
  it("shows geometric width instead of curve controls for an outline", () => {
    const object = { ...arrow(), outline: { width: 30 } } as DraftingObject;
    const markup = render(object);
    expect(markup).toContain('aria-label="Arrow width"');
    expect(markup).not.toContain('aria-label="Tangent angle"');
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
    expect(markup).toContain("<legend>Border</legend>");
    expect(markup).toContain("<legend>Fill</legend>");
    expect(markup).toContain(">Bring to front</button>");
    expect(markup).toContain(">Send to back</button>");
    expect(markup.match(/component-color-swatch/gu)).toHaveLength(8);
    expect(markup).not.toContain('type="color"');
  });
});
