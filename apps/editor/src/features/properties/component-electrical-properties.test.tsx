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
        valueSupported
        referenceAvailable
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
        valueSupported={false}
        referenceAvailable={false}
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
        valueSupported
        referenceAvailable
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

describe("the Display row only offers what the drawing can show", () => {
  const render = (
    instance: Parameters<typeof ComponentElectricalProperties>[0]["instance"],
    flags: {
      referenceAvailable?: boolean;
      valueSupported?: boolean;
      valueAvailable?: boolean;
      referenceLabelRenderable?: boolean;
    },
  ) =>
    renderToStaticMarkup(
      <ComponentElectricalProperties
        instance={instance}
        parameters={[]}
        parameterValues={{}}
        firstInputRef={createRef<HTMLInputElement>()}
        referenceVisible
        valueVisible
        valueAvailable={flags.valueAvailable ?? false}
        valueSupported={flags.valueSupported ?? false}
        referenceAvailable={flags.referenceAvailable ?? false}
        referenceLabelRenderable={flags.referenceLabelRenderable ?? true}
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

  it("drops the whole row for a part that has neither a reference nor a value", () => {
    // A voltage amplifier has no device descriptor, so it has no designator
    // to show. The toggle switched something that does not exist.
    const markup = render(
      { id: "X3", symbolId: "voltage-amplifier", placement: null },
      {},
    );
    expect(markup).not.toContain("Component display toggles");
    expect(markup).not.toContain("Reference");
    expect(markup).not.toContain(">Value<");
  });

  it("keeps both toggles for a part that has both", () => {
    // The brake: a resistor designates R1 and carries a value, so nothing
    // about it changes.
    const markup = render(
      { id: "R1", symbolId: "resistor", placement: null, reference: "R1" },
      { referenceAvailable: true, valueSupported: true, valueAvailable: true },
    );
    expect(markup).toContain("Component display toggles");
    expect(markup).toContain("Reference");
    expect(markup).toContain("Value");
  });

  it("keeps a value toggle that is merely unset, and says why", () => {
    // "No value yet" is not "no value ever": the row must stay so the person
    // can see the remedy.
    const markup = render(
      { id: "R1", symbolId: "resistor", placement: null, reference: "R1" },
      { referenceAvailable: true, valueSupported: true, valueAvailable: false },
    );
    expect(markup).toContain("Value");
    expect(markup).toContain("Set the device parameters first");
  });

  it("offers only the reference for a part that can never show a value", () => {
    // A switch designates S1 but has no value annotation at all.
    const markup = render(
      { id: "S1", symbolId: "ideal-switch", placement: null, reference: "S1" },
      { referenceAvailable: true, valueSupported: false },
    );
    expect(markup).toContain("Reference");
    expect(markup).not.toContain(">Value<");
  });

  it("still hides the reference for a Symbol that draws no label", () => {
    // Ground and the signal-flow blocks: the artwork shows no label, so the
    // toggle would edit something invisible even where a reference exists.
    const markup = render(
      { id: "G1", symbolId: "ground", placement: null, reference: "G1" },
      { referenceAvailable: true, referenceLabelRenderable: false },
    );
    expect(markup).not.toContain("Reference");
  });
});
