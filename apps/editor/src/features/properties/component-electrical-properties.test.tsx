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
      reference: "M1",
      netlist: { parameters: {} },
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
        referenceLabelRenderable
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

  it("says nothing at all for a Symbol that has neither parameters nor a drawable label", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "X2",
      symbolId: "adder",
      placement: null,
    };
    const markup = renderToStaticMarkup(
      <ComponentElectricalProperties
        instance={instance}
        parameters={[]}
        parameterValues={{}}
        firstInputRef={createRef<HTMLInputElement>()}
        referenceVisible={false}
        valueVisible={false}
        valueAvailable={false}
        referenceLabelRenderable={false}
        additionalParameters={[]}
        additionalParametersChanged={false}
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
    // A summing junction draws no reference and carries no value: the card
    // would hold two controls that cannot change anything.
    expect(markup).toBe("");
  });

  it("keeps the Value toggle alone when only the reference is undrawable", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "GND1",
      symbolId: "ground",
      placement: null,
      reference: "GND1",
      netlist: { parameters: {} },
    };
    const markup = renderToStaticMarkup(
      <ComponentElectricalProperties
        instance={instance}
        parameters={[]}
        parameterValues={{}}
        firstInputRef={createRef<HTMLInputElement>()}
        referenceVisible={false}
        valueVisible={false}
        valueAvailable
        referenceLabelRenderable={false}
        additionalParameters={[]}
        additionalParametersChanged={false}
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
    expect(markup).toContain("Value");
    expect(markup).not.toContain(">Reference<");
  });
});
