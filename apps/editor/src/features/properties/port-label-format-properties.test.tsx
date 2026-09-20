import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { PortLabelFormatProperties } from "./port-label-format-properties";

describe("PortLabelFormatProperties", () => {
  it("offers case and placement choices in Properties", () => {
    const markup = renderToStaticMarkup(
      <PortLabelFormatProperties
        documentId="main"
        labelCount={3}
        onFormat={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Port label formatting"');
    expect(markup).toContain('aria-label="Port label suffix case"');
    expect(markup).toContain("Keep typed case");
    expect(markup).toContain("UPPERCASE");
    expect(markup).toContain("lowercase");
    expect(markup).toContain('aria-label="Port label suffix position"');
    expect(markup).toContain("Subscript");
    expect(markup).toContain("Baseline");
    expect(markup).toContain("Format all Port labels");
    expect(markup).toContain("Applies to 3 labels in this Cell");
  });

  it("disables formatting when the current Cell has no Port labels", () => {
    const markup = renderToStaticMarkup(
      <PortLabelFormatProperties
        documentId="empty"
        labelCount={0}
        onFormat={vi.fn()}
      />,
    );

    expect(markup).toContain(
      '<button type="button" disabled="">Format all Port labels</button>',
    );
  });
});
