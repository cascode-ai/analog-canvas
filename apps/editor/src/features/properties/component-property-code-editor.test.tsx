import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComponentPropertyCodeEditor } from "./component-property-code-editor";

describe("ComponentPropertyCodeEditor", () => {
  it("keeps a readable loading fallback for the lazily loaded code surface", () => {
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
    expect(markup).toContain('aria-label="Loading Canvas property code"');
    expect(markup).toContain("&quot;at&quot;");
    expect(markup).not.toContain("Apply code");
    expect(markup).not.toContain("Component properties");
    expect(markup).toContain('aria-label="Defaults"');
    expect(markup).not.toContain("Need help?");
    expect(markup).toContain("<legend>Line</legend>");
    expect(markup).toContain('aria-label="Line presets"');
    expect(markup).toContain('aria-label="Line custom RGB"');
    expect(markup).not.toContain("Background");
    expect(markup).toContain("Live");
    expect(markup).toContain('aria-label="Copy JSON"');
    expect(markup).toContain('title="Copy JSON"');
    expect(markup.indexOf('aria-label="Copy JSON"')).toBeLessThan(
      markup.indexOf('aria-label="Loading Canvas property code"'),
    );
    expect(markup).not.toContain('inputMode="decimal"');
    expect(markup).not.toContain("mirror-horizontal");
  });
});
