import type { ReactNode } from "react";

import { ToolIcon } from "../features/editor-shell/tool-icon";

export type EditorProjectPanelMode =
  "netlist" | "netlist-configuration" | "instances" | "project-code";

function netlistMode(mode: EditorProjectPanelMode): boolean {
  return mode !== "project-code";
}

/** Project-wide tools occupy the right side without becoming Properties. */
export function EditorProjectDock({
  mode,
  onSelect,
  onClose,
  children,
}: {
  mode: EditorProjectPanelMode;
  onSelect(mode: "netlist" | "project-code"): void;
  onClose(): void;
  children: ReactNode;
}) {
  return (
    <aside
      className="selection-dock open project-tool-dock"
      data-canvas-overlay="true"
      aria-label="Project tools"
      role="complementary"
    >
      <section className="selection-shelf" aria-label="Project tools">
        <header className="project-tool-header">
          <nav aria-label="Project tool" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={netlistMode(mode)}
              onClick={() => onSelect("netlist")}
            >
              <ToolIcon name="netlist" />
              Netlist
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === "project-code"}
              onClick={() => onSelect("project-code")}
            >
              <ToolIcon name="project-code" />
              Project Code
            </button>
          </nav>
          <button
            type="button"
            className="project-tool-close"
            aria-label="Close project tools"
            title="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <div className="selection-panel">{children}</div>
      </section>
    </aside>
  );
}
