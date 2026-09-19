import { renderToReadableStream, renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createEmptyDocument, createRoutePath } from "@icm/model";

// The browser contracts exercise CodeMirror. Here retain its source and label
// while checking the real asynchronously loaded Properties section and actions.
vi.mock("../properties/component-property-json-editor", () => ({
  default: ({
    value,
    ariaLabel = "Editable Canvas property code",
  }: {
    value: string;
    ariaLabel?: string;
  }) => <textarea aria-label={ariaLabel} value={value} readOnly />,
}));

import {
  EndpointActionsSection,
  GroupPropertiesSection,
  MosBulkConnectionSection,
  RouteActionsSection,
  RoutingGuidanceSection,
} from "./selection-context-actions";

describe("selection context actions", () => {
  const routeFixture = () => {
    const document = createEmptyDocument("doc", "Route properties");
    document.nets.push({ id: "net-1", terminals: [] });
    document.junctions.push(
      {
        id: "j1",
        netId: "net-1",
        position: { x: 0, y: 0 },
        role: "route-anchor",
      },
      {
        id: "j2",
        netId: "net-1",
        position: { x: 100, y: 0 },
        role: "route-anchor",
      },
    );
    const route = createRoutePath({
      id: "route-1",
      netId: "net-1",
      start: { kind: "junction", junctionId: "j1" },
      end: { kind: "junction", junctionId: "j2" },
      bends: [],
      modes: ["manual"],
    });
    route.styleOverride = { arrow: "middle" };
    document.routes.push(route);
    const netLabel = {
      id: "net-label-route-1",
      kind: "net-label" as const,
      netId: "net-1",
      binding: { kind: "net-name" as const, netId: "net-1" },
      anchor: { kind: "free" as const, position: { x: 50, y: -8 } },
      alignment: "middle" as const,
      rotation: 0 as const,
      locked: false,
      content: { runs: [{ kind: "text" as const, value: "OUT" }] },
    };
    document.annotations.push(netLabel);
    document.connectivityEvidence.push({
      id: "claim-1",
      kind: "name-claim",
      netId: "net-1",
      name: "OUT",
      scope: "local",
      owner: { kind: "net-label", annotationId: netLabel.id },
    });
    return { document, route, netLabel };
  };

  it("uses one code surface for a multi-component selection", async () => {
    const stream = await renderToReadableStream(
      <GroupPropertiesSection
        active
        count={4}
        selectionKey="test-selection"
        revision={3}
        context={{
          symbol: "resistor",
          parameters: { value: "" },
          reference: "",
          value: false,
          foreground: "",
        }}
        defaultForeground="#000000"
        onApply={vi.fn(() => ({ ok: true as const }))}
      />,
    );
    await stream.allReady;
    const markup = (await new Response(stream).text()).replace(
      /<!--.*?-->/gu,
      "",
    );
    expect(markup).toContain('aria-label="Batch component properties"');
    expect(markup).toContain("4 selected");
    expect(markup).toContain('aria-label="Editable Canvas property code"');
    expect(markup).toContain("Empty values keep");
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

  it("renders route label and highlight actions", async () => {
    const { document, route, netLabel } = routeFixture();
    const stream = await renderToReadableStream(
      <RouteActionsSection
        active
        document={document}
        route={route}
        netLabel={netLabel}
        defaultColor="#000"
        highlightActive
        onApply={vi.fn(() => ({ ok: true }))}
        onToggleHighlight={vi.fn()}
        onDeleteWire={vi.fn()}
      />,
    );
    await stream.allReady;
    const markup = await new Response(stream).text();
    expect(markup).toContain('aria-label="Annotation property code"');
    expect(markup).toContain("Route");
    expect(markup).toContain("OUT");
    expect(markup).toContain("directionArrow");
    expect(markup).not.toContain('aria-label="Electrical Net label"');
    expect(markup).not.toContain('aria-label="Wire direction arrow"');
    expect(markup).not.toContain('aria-label="Wire line style"');
    expect(markup).not.toContain("current arrow");
    expect(markup).toContain("Clear Net highlight (H)");
  });

  it("presents a MOS bulk route as instance-owned instead of a generic wire", () => {
    const { document, route } = routeFixture();
    const markup = renderToStaticMarkup(
      <RouteActionsSection
        active
        document={document}
        route={route}
        netLabel={null}
        bulkOwnerLabel="M1"
        defaultColor="#000"
        highlightActive={false}
        onApply={vi.fn(() => ({ ok: true }))}
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
    expect(markup).not.toContain("Wire line style");
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
