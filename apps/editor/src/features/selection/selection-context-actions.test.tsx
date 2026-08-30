import { createRef } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import {
  EndpointActionsSection,
  RouteActionsSection,
  RoutingGuidanceSection,
} from "./selection-context-actions";

describe("selection context actions", () => {
  it("renders route label and highlight actions", () => {
    const markup = renderToStaticMarkup(
      <RouteActionsSection
        active
        netLabelInputRef={createRef<HTMLInputElement>()}
        netLabel="OUT"
        color={undefined}
        defaultColor="#000"
        highlightActive
        onNetLabelChange={vi.fn()}
        onColorChange={vi.fn()}
        onDeleteNetLabel={vi.fn()}
        onAddCurrentArrow={vi.fn()}
        onToggleHighlight={vi.fn()}
        onDeleteWire={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Electrical Net label"');
    expect(markup).toContain('value="OUT"');
    expect(markup).toContain('aria-label="Wire color"');
    expect(markup).toContain('value="#000000"');
    expect(markup).toContain("Use the document wire color");
    expect(markup).toContain("Clear Net highlight (H)");
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
