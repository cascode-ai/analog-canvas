// @vitest-environment jsdom
import { act, createRef, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
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
  it("presents one Cloud Save protocol and explicit local interchange", () => {
    const markup = renderToStaticMarkup(
      <FileCommandMenu
        canRevert
        hasRecoverySessions
        checkAndSave={{ enabled: true, execute: vi.fn() }}
        projectInputRef={createRef<HTMLInputElement>()}
        onNewProject={vi.fn()}
        onSave={vi.fn()}
        onImportProject={vi.fn()}
        onImportSpice={vi.fn()}
        onExportProject={vi.fn()}
        onExportSvg={vi.fn()}
        onExportRaster={vi.fn()}
        onExportNetlist={vi.fn()}
        onRevert={vi.fn()}
        onOpenRecovery={vi.fn()}
        onOpenInfo={vi.fn()}
      />,
    );

    expect(markup.split(">New Project<")).toHaveLength(2);
    // Project Info comes first; Cloud Projects are listed elsewhere.
    expect(markup.indexOf(">Project Info<")).toBeGreaterThan(0);
    expect(markup.indexOf(">Project Info<")).toBeLessThan(
      markup.indexOf(">New Project<"),
    );
    expect(markup).not.toContain("Save as Cloud Copy");
    expect(markup).not.toContain("Cloud Projects (");
    expect(markup).not.toContain("file-cloud-project-list");
    expect(markup).toContain(">Import<");
    expect(markup).toContain("Project File…");
    expect(markup).toContain("SPICE / SCS…");
    expect(markup).toContain("Cadence SPICE (`!` globals)…");
    expect(markup).toContain('data-testid="cadence-spice-files"');
    expect(markup).toContain(">Export<");
    expect(markup).toContain("Drawing as SVG");
    // The Export group saves the netlist the Netlist panel shows, named by
    // its format.
    expect(markup).toContain('aria-label="Export Netlist"');
    expect(markup).toContain(">Netlist…<");
    expect(markup).toContain("Recover Unsaved Work…");
    expect(markup).not.toContain("Refresh app");
    expect(markup).not.toContain("Copy SPICE netlist");
    expect(markup).not.toContain("Copy Spectre netlist");
    expect(markup).not.toContain("Download Backup");
    expect(markup).not.toContain("Previous Project");
    expect(markup).not.toContain("cloud snapshot");
  });

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
