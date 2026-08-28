import { createEmptyDocument } from "@icm/model";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComponentElectricalProperties } from "./component-electrical-properties";

describe("component electrical properties", () => {
  it("renders known, derived, display, and additional parameters together", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "M1",
      symbolId: "nmos",
      placement: null,
      netlist: { reference: "M1", parameters: {} },
    };
    const markup = renderToStaticMarkup(
      <ComponentElectricalProperties
        instance={instance}
        parameters={[
          {
            key: "w",
            label: "Width",
            placeholder: "1u",
            help: "Total gate width",
          },
          {
            key: "compatibility",
            label: "Compatibility field",
            placeholder: "hidden",
            help: "Netlist compatibility only",
            compatibilityOnly: true,
          },
        ]}
        parameterValues={{ w: "2u", nf: "2" }}
        firstInputRef={createRef<HTMLInputElement>()}
        referenceVisible
        valueVisible
        valueAvailable
        additionalParameters={[
          { id: "extra", originalName: "ad", name: "ad", value: "1p" },
        ]}
        additionalParametersChanged
        onParameterChange={vi.fn()}
        onReferenceVisibilityChange={vi.fn()}
        onValueVisibilityChange={vi.fn()}
        onAdditionalParameterChange={vi.fn()}
        onAdditionalParameterRemove={vi.fn()}
        onAdditionalParameterAdd={vi.fn()}
        onAdditionalParametersApply={vi.fn()}
        onAdditionalParametersCancel={vi.fn()}
      />,
    );
    expect(markup).toContain("Finger width 1u");
    expect(markup).toContain('aria-label="Additional parameter name 1"');
    expect(markup).toContain("Apply parameters");
    expect(markup).not.toContain("Component compatibility field");
  });
});
