import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { NetNameProperties } from "./net-name-properties";

describe("NetNameProperties", () => {
  it("separates authored scope from the derived export projection", () => {
    const markup = renderToStaticMarkup(
      <NetNameProperties
        annotationId="label-vdd"
        authoredScope="local"
        editableScope
        effectiveScope="global"
        preferredSpelling="VDD"
        spellings={["VDD", "vdd"]}
        onScopeChange={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Net identity"');
    expect(markup).toContain('aria-label="Net Label scope"');
    expect(markup).toContain('value="local" selected=""');
    expect(markup).toContain('data-scope="global"');
    expect(markup).toContain("Preferred export spelling");
    expect(markup).toContain("VDD, vdd");
    expect(markup).toContain(
      "Wire membership and source provenance are unchanged",
    );
  });

  it("keeps marker-owned global scope read-only", () => {
    const markup = renderToStaticMarkup(
      <NetNameProperties
        annotationId="power-vdd"
        authoredScope="global"
        editableScope={false}
        effectiveScope="global"
        preferredSpelling="VDD"
        spellings={["VDD"]}
        onScopeChange={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="Net Label scope"');
    expect(markup).toContain("disabled");
  });
});
