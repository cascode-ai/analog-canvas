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
      onReverse={noop}
      onRotate={noop}
      onToggleLock={noop}
    />,
  );
}

describe("arrow head placement control", () => {
  it("offers both ends as a choice, not as a separate kind of arrow", () => {
    // Placement is its own question beside style, rather than multiplied into
    // one combined list: two short lists say what a seven-entry list would.
    const markup = render(arrow());

    expect(markup).toContain('aria-label="Arrow head at"');
    expect(markup).toContain("Both ends");
    expect(markup).toContain('aria-label="Arrow head"');
  });

  /** The value a rendered select shows, read from its selected option. */
  function selectedValue(markup: string, label: string): string | null {
    const control = new RegExp(
      `aria-label="${label}"[\\s\\S]*?</select>`,
      "u",
    ).exec(markup)?.[0];
    if (!control) return null;
    for (const option of control.match(/<option[^>]*>/gu) ?? []) {
      if (!option.includes("selected")) continue;
      return /value="([^"]*)"/u.exec(option)?.[1] ?? null;
    }
    return null;
  }

  it("starts on the trailing end, matching every arrow drawn so far", () => {
    expect(selectedValue(render(arrow()), "Arrow head at")).toBe("end");
  });

  it("shows the author's own choice when there is one", () => {
    expect(
      selectedValue(render(arrow({ arrowHeadAt: "both" })), "Arrow head at"),
    ).toBe("both");
  });

  it("hides placement when there is no head to place", () => {
    // Offering a choice that cannot change anything is worse than offering
    // nothing: it invites the author to try, and then does nothing.
    const markup = render(arrow({ arrowHead: "none" }));

    expect(markup).not.toContain('aria-label="Arrow head at"');
    expect(markup).toContain('aria-label="Arrow head"');
  });
});
