import type { ReactNode } from "react";

export type EditorProjectPanelMode =
  "netlist" | "netlist-configuration" | "instances" | "project-code";

/**
 * Project-wide tools occupy the right side without becoming Properties.
 *
 * A panel is closed by the control that opened it — the toolbar button or the
 * menu entry, both of which toggle — so the dock carries no close button of
 * its own. One floating in the corner only sat over the panel's own controls
 * and took the room the panel needed at half width.
 */
export function EditorProjectDock({ children }: { children: ReactNode }) {
  return (
    <aside
      className="selection-dock open project-tool-dock"
      data-canvas-overlay="true"
      aria-label="Project tools"
      role="complementary"
    >
      <section className="selection-shelf" aria-label="Project tools">
        <div className="selection-panel">{children}</div>
      </section>
    </aside>
  );
}
