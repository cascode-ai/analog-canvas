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

  it("renders editable controls without an Identity card and ends with raw component code", () => {
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
        formalTerminalSelected={false}
        portNet={{ id: "net", logicalName: "VDD", supply: true }}
        targetDescription={null}
        capacitorPlateRows={null}
        modelTarget={{
          defaultValue: "sky130_fd_pr__nfet_01v8",
          suggestions: ["sky130_fd_pr__nfet_01v8"],
          externalSubcircuit: false,
        }}
        sourceCode={{
          code: "M1 drain gate source bulk sky130_fd_pr__nfet_01v8 W=1u L=150n",
          exact: true,
          note: null,
        }}
        onMarkerNameChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onEditAnnotation={vi.fn()}
        onModelTargetChange={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Supply name"');
    expect(markup).not.toContain("Identity");
    expect(markup).not.toContain("<details");
    expect(markup).not.toContain("Cell");
    expect(markup).toContain('<option value="">None</option>');
    expect(markup).toContain("sky130_fd_pr__nfet_01v8");
    expect(markup).toContain("Custom…");
    expect(markup).not.toContain("datalist");
    expect(markup).toMatch(
      /<div class="component-source-code"[^>]*><code>M1 drain gate source bulk sky130_fd_pr__nfet_01v8 W=1u L=150n<\/code><\/div>$/u,
    );
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
        formalTerminalSelected={false}
        portNet={null}
        targetDescription={null}
        capacitorPlateRows={null}
        modelTarget={null}
        sourceCode={{
          code: "X2 <in> <out> <subcircuit-model>",
          exact: false,
          note: "Subcircuit template — choose a concrete model before export.",
        }}
        onMarkerNameChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onEditAnnotation={vi.fn()}
        onModelTargetChange={vi.fn()}
      />,
    );
    expect(markup).toContain(
      "<code>X2 &lt;in&gt; &lt;out&gt; &lt;subcircuit-model&gt;</code>",
    );
    expect(markup).not.toContain("Identity");
    expect(markup).not.toContain("Cell");
    expect(markup).not.toContain('aria-label="Netlist Reference"');
    // A retained Instance has nowhere to stand a label yet.
    expect(markup).not.toContain('aria-label="Component label"');
  });

  it("offers one rich-editor action beside the Netlist Reference", () => {
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
        formalTerminalSelected={false}
        portNet={null}
        targetDescription={null}
        capacitorPlateRows={null}
        modelTarget={null}
        sourceCode={{ code: "R1 net1 net2 10k", exact: true, note: null }}
        onMarkerNameChange={vi.fn()}
        onReferenceChange={vi.fn()}
        onEditAnnotation={vi.fn()}
        onModelTargetChange={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Netlist Reference"');
    expect(markup).toContain("Edit annotation");
    expect(markup).not.toContain('aria-label="Component label"');
    expect(markup).toContain('value="R1"');
  });
});
