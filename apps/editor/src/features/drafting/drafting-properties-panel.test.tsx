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
      onToggleLock={noop}
    />,
  );
}

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
  it("recognizes legacy trailing, both and no-head styles", () => {
    expect(render(arrow())).toContain('title="Arrow style: Filled end arrow"');
    expect(render(arrow({ arrowHeadAt: "both" }))).toContain(
      'title="Arrow style: Filled double arrow"',
    );
    expect(render(arrow({ arrowHead: "none" }))).toContain(
      'title="Arrow style: No head"',
    );
  });
  it("shows geometric width instead of curve controls for an outline", () => {
    const object = { ...arrow(), outline: { width: 30 } } as DraftingObject;
    const markup = render(object);
    expect(markup).toContain('aria-label="Arrow width"');
    expect(markup).not.toContain('aria-label="Tangent angle"');
  });
});
