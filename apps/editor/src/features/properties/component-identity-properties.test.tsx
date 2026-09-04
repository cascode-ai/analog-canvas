import { createEmptyDocument } from "@icm/model";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  ComponentIdentityProperties,
  componentTargetDescription,
} from "./component-identity-properties";

describe("component identity properties", () => {
  it("omits the internal target description for a built-in primitive", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "R1",
      symbolId: "resistor",
      placement: null,
      reference: "R1",
      netlist: {
        parameters: {},
        binding: { kind: "primitive", deviceClass: "resistor" },
      },
    };
    expect(componentTargetDescription(instance)).toBeNull();
    delete instance.netlist!.binding;
    expect(componentTargetDescription(instance)).toBeNull();
  });

  it("renders identity, editable marker name, and model suggestions", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "M1",
      symbolId: "nmos",
      placement: null,
      reference: "M1",
      netlist: { parameters: {} },
    };
    const markup = renderToStaticMarkup(
      <ComponentIdentityProperties
        instance={instance}
        revision={0}
        cellName="Cell"
        formalTerminalSelected={false}
        portNet={{ id: "net", logicalName: "VDD", supply: true }}
        targetDescription={null}
        capacitorPlateRows={null}
        modelTarget={{
          defaultValue: "sky130_fd_pr__nfet_01v8",
          suggestions: ["sky130_fd_pr__nfet_01v8"],
          externalSubcircuit: false,
        }}
        label={null}
        onMarkerNameChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onLabelChange={vi.fn()}
        onModelTargetChange={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Supply name"');
    expect(markup).toContain('<option value="">None</option>');
    expect(markup).toContain("sky130_fd_pr__nfet_01v8");
    expect(markup).toContain("Custom…");
    expect(markup).not.toContain("datalist");
  });

  it("offers no Reference field when the object has no authored Reference", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "X2",
      symbolId: "adder",
      placement: null,
    };
    const markup = renderToStaticMarkup(
      <ComponentIdentityProperties
        instance={instance}
        revision={1}
        cellName="Main"
        formalTerminalSelected={false}
        portNet={null}
        targetDescription={null}
        capacitorPlateRows={null}
        modelTarget={null}
        label={null}
        onMarkerNameChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onLabelChange={vi.fn()}
        onModelTargetChange={vi.fn()}
      />,
    );
    expect(markup).toContain("Symbol");
    expect(markup).not.toContain('aria-label="Component reference"');
    // A retained Instance has nowhere to stand a label yet.
    expect(markup).not.toContain('aria-label="Component label"');
  });

  it("offers a free Label beside the Reference, showing the attached text", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance: (typeof document.instances)[number] = {
      id: "R1",
      symbolId: "resistor",
      placement: {
        position: { x: 100, y: 100 },
        rotation: 0,
        mirror: "none",
      },
      reference: "R1",
      netlist: {
        parameters: {},
        binding: { kind: "primitive", deviceClass: "resistor" },
      },
    };
    const markup = renderToStaticMarkup(
      <ComponentIdentityProperties
        instance={instance}
        revision={2}
        cellName="Cell"
        formalTerminalSelected={false}
        portNet={null}
        targetDescription={null}
        capacitorPlateRows={null}
        modelTarget={null}
        label="gm"
        onMarkerNameChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onLabelChange={vi.fn()}
        onModelTargetChange={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Component reference"');
    expect(markup).toContain('aria-label="Component label"');
    expect(markup).toContain('value="gm"');
    expect(markup).toContain('value="R1"');
  });
});
