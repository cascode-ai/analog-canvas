import type { ReactNode } from "react";

/** Independent workspace siblings. Hiding Code preserves drafts and run ownership. */
export function EditorRightDock(props: {
  simulationOpen: boolean;
  simulationOpened: boolean;
  maximized: boolean;
  onRestoreSimulation(): void;
  code: ReactNode;
  properties: ReactNode;
}) {
  return (
    <>
      <aside className="editor-right-dock" hidden={props.maximized}>
        {props.properties}
      </aside>
      <aside
        className={`editor-simulation-dock${props.simulationOpen ? " open" : ""}`}
        hidden={!props.simulationOpened}
        aria-label="Sim Code"
      >
        {!props.simulationOpen ? (
          <button
            className="simulation-restore-rail"
            onClick={props.onRestoreSimulation}
            title="Restore Sim Code"
          >
            Sim Code
          </button>
        ) : null}
        <div
          className="editor-simulation-content"
          hidden={!props.simulationOpen}
        >
          {props.code}
        </div>
      </aside>
    </>
  );
}
