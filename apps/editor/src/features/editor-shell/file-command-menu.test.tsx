// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { FileCommandMenu } from "./file-command-menu";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

function menuProps(): ComponentProps<typeof FileCommandMenu> {
  return {
    canRevert: true,
    hasRecoverySessions: true,
    checkAndSave: { enabled: true, execute: vi.fn() },
    projectInputRef: createRef<HTMLInputElement>(),
    onNewProject: vi.fn(),
    onSave: vi.fn(),
    onImportProject: vi.fn(),
    onImportSpice: vi.fn(),
    onImportRnl: vi.fn(),
    onExportProject: vi.fn(),
    onExportSvg: vi.fn(),
    onExportRaster: vi.fn(),
    onExportNetlist: vi.fn(),
    onRevert: vi.fn(),
    onOpenRecovery: vi.fn(),
  };
}

describe("FileCommandMenu", () => {
  it.each([
    ["project-file", "onImportProject"],
    ["spice-files", "onImportSpice"],
    ["cadence-spice-files", "onImportSpice"],
    ["rnl-files", "onImportRnl"],
  ] as const)(
    "takes the same file chosen twice in %s twice (#2154)",
    async (testId, handler) => {
      const props = menuProps();
      const host = document.createElement("div");
      const root = createRoot(host);
      await act(async () => root.render(<FileCommandMenu {...props} />));
      const input = host.querySelector<HTMLInputElement>(
        `[data-testid="${testId}"]`,
      )!;
      const file = new File(["* RC\n.end\n"], "qa-rc.cir");
      // The browser's own list empties once the input is cleared, as
      // Chromium's does; what the import receives must survive that.
      const chosen = [file];
      Object.defineProperty(input, "files", {
        configurable: true,
        get: () => chosen,
      });
      let value = "C:\\fakepath\\qa-rc.cir";
      Object.defineProperty(input, "value", {
        configurable: true,
        get: () => value,
        set: (next: string) => {
          value = next;
          if (next === "") chosen.length = 0;
        },
      });
      for (let pick = 0; pick < 2; pick++) {
        chosen.splice(0, chosen.length, file);
        value = "C:\\fakepath\\qa-rc.cir";
        await act(async () => {
          input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        // Cleared, so choosing the same path again is a change.
        expect(value).toBe("");
      }
      const calls = vi.mocked(props[handler]!).mock.calls;
      expect(calls).toHaveLength(2);
      for (const [received] of calls)
        expect(received).toEqual(handler === "onImportProject" ? file : [file]);
      await act(async () => root.unmount());
    },
  );
});
