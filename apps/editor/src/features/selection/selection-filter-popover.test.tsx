// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { SelectionFilterPopover } from "./selection-filter-popover";
import { DEFAULT_SELECTION_FILTER } from "./selection-filter";

describe("SelectionFilterPopover", () => {
  it("exposes grouped current selection classes and presets", () => {
    const markup = renderToStaticMarkup(
      <SelectionFilterPopover
        open
        filter={DEFAULT_SELECTION_FILTER}
        onChange={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(markup).toContain('data-testid="selection-filter-popover"');
    expect(markup).toContain("Choose Selectable Objects");
    expect(markup).toContain("Instances");
    expect(markup).toContain("Wires");
    expect(markup).toContain("Net / power names");
    expect(markup).toContain("Note text / callouts");
    expect(markup).toContain(">All<");
    expect(markup).toContain(">None<");
    expect(markup).toContain(">Default<");
  });

  it("renders nothing while closed", () => {
    expect(
      renderToStaticMarkup(
        <SelectionFilterPopover
          open={false}
          filter={DEFAULT_SELECTION_FILTER}
          onChange={vi.fn()}
          onClose={vi.fn()}
        />,
      ),
    ).toBe("");
  });

  it("stands under the chrome as it is, wrapped tabs included (#2194)", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    // jsdom lays nothing out: a phone's wrapped chrome ends at y = 140,
    // below the fixed top the popover used to take.
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        disconnect() {}
      },
    );
    const chrome = window.document.createElement("header");
    chrome.className = "app-chrome";
    chrome.getBoundingClientRect = () => ({ bottom: 140 }) as DOMRect;
    const host = window.document.createElement("div");
    window.document.body.append(chrome, host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <SelectionFilterPopover
            open
            filter={DEFAULT_SELECTION_FILTER}
            onChange={vi.fn()}
            onClose={vi.fn()}
          />,
        ),
      );
      const popover = host.querySelector<HTMLElement>(
        '[data-testid="selection-filter-popover"]',
      )!;
      expect(popover.style.getPropertyValue("--selection-filter-top")).toBe(
        "148px",
      );
    } finally {
      await act(async () => root.unmount());
      window.document.body.replaceChildren();
      vi.unstubAllGlobals();
    }
  });
});
