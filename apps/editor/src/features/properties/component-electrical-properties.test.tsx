import { createEmptyDocument } from "@icm/model";
import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { ComponentElectricalProperties } from "./component-electrical-properties";
import { componentParameters } from "../component-insert/component-parameters";

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

  it("keeps W, L, and NF labels compact while retaining their tooltips", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M1",
    };
    const markup = renderToStaticMarkup(
      <ComponentElectricalProperties
        instance={instance}
        parameters={[
          { key: "w", label: "W", placeholder: "1u", help: "Total width" },
          { key: "l", label: "L", placeholder: "150n", help: "Length" },
          { key: "nf", label: "NF", placeholder: "1", help: "Finger count" },
          { key: "m", label: "M", placeholder: "1", help: "Multiplier" },
        ]}
        parameterValues={{ w: "1u", l: "150n", nf: "1", m: "1" }}
        firstInputRef={createRef<HTMLInputElement>()}
        referenceVisible
        valueVisible
        valueAvailable
        valueSupported
        referenceAvailable
        referenceLabelRenderable
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

    expect(markup).not.toContain("(Total width)");
    expect(markup).not.toContain("(Length)");
    expect(markup).not.toContain("(Finger count)");
    expect(markup).toContain("(Multiplier)");
    expect(markup).toContain('title="Total width"');
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

  it("shows only the active ordinary-source waveform fields", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "V1",
      symbolId: "voltage-source",
      placement: null,
      reference: "V1",
      netlist: { parameters: {} },
    };
    const render = (waveform: "dc" | "pulse" | "sin") =>
      renderToStaticMarkup(
        <ComponentElectricalProperties
          instance={instance}
          parameters={componentParameters(instance.symbolId)}
          parameterValues={{ waveform }}
          firstInputRef={createRef<HTMLInputElement>()}
          referenceVisible
          valueVisible
          valueAvailable
          valueSupported
          referenceAvailable
          referenceLabelRenderable
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

    const dc = render("dc");
    expect(dc).toContain('aria-label="Component waveform"');
    expect(dc).not.toContain('aria-label="Component low"');
    expect(dc).not.toContain('aria-label="Component amplitude"');

    const pulse = render("pulse");
    expect(pulse).toContain('aria-label="Component low"');
    expect(pulse).toContain('aria-label="Component period"');
    expect(pulse).not.toContain('aria-label="Component amplitude"');

    const sin = render("sin");
    expect(sin).toContain('aria-label="Component amplitude"');
    expect(sin).toContain('aria-label="Component frequency"');
    expect(sin).not.toContain('aria-label="Component low"');
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
