import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComponentPropertyCodeEditor } from "./component-property-code-editor";

describe("ComponentPropertyCodeEditor", () => {
  it("renders one editable code surface without coordinate or style widgets", () => {
    const markup = renderToStaticMarkup(
      <ComponentPropertyCodeEditor
        instance={{
          id: "R1",
          symbolId: "resistor",
          reference: "R1",
          placement: {
            position: { x: 360, y: 240 },
            rotation: 0,
            mirror: "none",
          },
        }}
        revision={1}
        referenceVisible
        valueVisible={false}
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );
    expect(markup).toContain('aria-label="Editable Canvas property code"');
    expect(markup).toContain("&quot;at&quot;");
    expect(markup).toContain("Apply code");
    expect(markup).not.toContain('inputMode="decimal"');
    expect(markup).not.toContain("mirror-horizontal");
  });
});
