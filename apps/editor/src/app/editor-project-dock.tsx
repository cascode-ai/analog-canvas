import type { ReactNode } from "react";

export type EditorProjectPanelMode =
  "netlist" | "netlist-configuration" | "instances" | "project-code";

/** Project-wide tools occupy the right side without becoming Properties. */
export function EditorProjectDock({
  onClose,
  children,
}: {
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
        <button
          type="button"
          className="project-tool-close"
          aria-label="Close project tools"
          title="Close"
          onClick={onClose}
        >
          ×
        </button>
        <div className="selection-panel">{children}</div>
      </section>
    </aside>
  );
}
