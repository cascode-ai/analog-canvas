import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EndpointActionsSection,
  GroupPropertiesSection,
  MosBulkConnectionSection,
  RouteActionsSection,
  RoutingGuidanceSection,
} from "./selection-context-actions";

describe("selection context actions", () => {
  it("uses one code surface for a multi-component selection", () => {
    const markup = renderToStaticMarkup(
      <GroupPropertiesSection
        active
        count={4}
        revision={3}
        context={{
          reference: "mixed",
          value: false,
          foreground: "mixed",
        }}
        defaultForeground="#000000"
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );
    expect(markup).toContain('aria-label="Batch component properties"');
    expect(markup).toContain("4 selected");
    expect(markup).toContain('aria-label="Loading batch property code"');
    expect(markup).toContain("mixed");
    expect(markup).not.toContain("Canvas labels");
    expect(markup).not.toContain("Visual annotation");
  });

  it.each([
    ["unresolved", null, "Unconnected", "Choose a net"],
    ["no-connect", null, "No Connect", "Intentionally left unconnected"],
    ["cell-default", "VDD", "VDD", "Cell default"],
    ["supply-default", "0", "0", "Supply default"],
    ["instance-override", "VB", "VB", "Instance override"],
    ["explicit", "VSS", "VSS", "Explicit connection"],
  ] as const)(
    "explains %s bulk state without repeating unresolved text",
    (status, netName, label, origin) => {
      const markup = renderToStaticMarkup(
        <MosBulkConnectionSection
          connection={{ terminal: "M1.B", netName, status }}
          explicitRouteVisible={status === "explicit"}
          canDraw
          onDraw={vi.fn()}
        />,
      );
      expect(markup).toContain(`>${label}</span>`);
      expect(markup).toContain(origin);
      expect(markup).toContain('aria-label="Draw bulk connection"');
      expect(markup).not.toContain("→ unresolved");
      if (status === "explicit")
        expect(markup).toContain("Dashed bulk route shown");
    },
  );

  it("keeps unplaced bulk routing disabled and hides the bar for non-MOS selections", () => {
    const props = {
      explicitRouteVisible: false,
      canDraw: false,
      onDraw: vi.fn(),
    };
    expect(
      renderToStaticMarkup(
        <MosBulkConnectionSection connection={null} {...props} />,
      ),
    ).toBe("");
    const markup = renderToStaticMarkup(
      <MosBulkConnectionSection
        connection={{ terminal: "M1.B", netName: null, status: "unresolved" }}
        {...props}
      />,
    );
    expect(markup).toContain('disabled=""');
    expect(markup).toContain("Place the component on the canvas");
  });

  it("renders route label and highlight actions", () => {
    const markup = renderToStaticMarkup(
      <RouteActionsSection
        active
        netLabelInputRef={createRef<HTMLInputElement>()}
        netLabel="OUT"
        color={undefined}
        arrow="middle"
        defaultColor="#000"
        highlightActive
        onNetLabelChange={vi.fn()}
        onColorChange={vi.fn()}
        onArrowChange={vi.fn()}
        onDeleteNetLabel={vi.fn()}
        onAddCurrentArrow={vi.fn()}
        onToggleHighlight={vi.fn()}
        onDeleteWire={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Electrical Net label"');
    expect(markup).toContain('value="OUT"');
    expect(markup).not.toContain('type="color"');
    expect(markup).toContain('aria-label="Wire color custom RGB"');
    expect(markup).toContain("Light gray · #9ca3af");
    expect(markup.match(/component-color-swatch/gu)).toHaveLength(4);
    expect(markup).not.toContain("Orange");
    expect(markup).toContain("Use the document ink color");
    expect(markup).toContain('aria-label="Wire direction arrow"');
    expect(markup).toContain('<option value="middle" selected="">');
    expect(markup).toContain("Arrow at end");
    expect(markup).toContain("Add current arrow");
    expect(markup).toContain("Clear Net highlight (H)");
  });

  it("presents a MOS bulk route as instance-owned instead of a generic wire", () => {
    const markup = renderToStaticMarkup(
      <RouteActionsSection
        active
        bulkOwnerLabel="M1"
        netLabelInputRef={createRef<HTMLInputElement>()}
        netLabel=""
        color="#059669"
        arrow="middle"
        defaultColor="#000"
        highlightActive={false}
        onNetLabelChange={vi.fn()}
        onColorChange={vi.fn()}
        onArrowChange={vi.fn()}
        onDeleteNetLabel={vi.fn()}
        onAddCurrentArrow={vi.fn()}
        onToggleHighlight={vi.fn()}
        onDeleteWire={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="MOS bulk route actions"');
    expect(markup).toContain("Bulk connection");
    expect(markup).toContain("Follows <strong>M1</strong> line color");
    expect(markup).toContain("Delete bulk connection");
    expect(markup).not.toContain("Electrical route");
    expect(markup).not.toContain("Wire color");
    expect(markup).not.toContain("Direction arrow");
  });

  it("blocks No Connect while a terminal remains connected", () => {
    const markup = renderToStaticMarkup(
      <EndpointActionsSection
        kind="terminal"
        noConnect={false}
        endpointNetId="net-1"
        onDisconnect={vi.fn()}
        onDeleteConnection={vi.fn()}
        onToggleNoConnect={vi.fn()}
        onDeleteJunction={vi.fn()}
      />,
    );
    expect(markup).toContain("Mark No Connect");
    expect(markup).toContain("disabled");
    expect(markup).toContain("Disconnect this endpoint");
  });

  it("publishes focused imported guidance counts", () => {
    const markup = renderToStaticMarkup(
      <RoutingGuidanceSection
        total={7}
        displayed={2}
        view="focused"
        onViewChange={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain("2 shown / 7 derived");
  });
});
