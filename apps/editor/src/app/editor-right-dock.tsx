import type { ReactNode } from "react";

/** One dock, two independent presentations. Hidden Code keeps drafts and run ownership alive. */
export function EditorRightDock(props: {
  simulationOpen: boolean;
  propertiesOpen: boolean;
  maximized: boolean;
  onSelectProperties(open: boolean): void;
  code: ReactNode;
  properties: ReactNode;
}) {
  const showCode =
    props.simulationOpen && (!props.propertiesOpen || props.maximized);
  return (
    <aside
      className={`editor-right-dock${props.simulationOpen ? " with-code" : ""}${showCode ? " showing-code" : ""}`}
    >
      {props.simulationOpen && !props.maximized ? (
        <nav className="editor-right-dock-tabs" aria-label="Sidebar view">
          <button
            type="button"
            aria-pressed={showCode}
            onClick={() => props.onSelectProperties(false)}
          >
            Sim Code
          </button>
          <button
            type="button"
            aria-pressed={!showCode}
            onClick={() => props.onSelectProperties(true)}
          >
            Properties
          </button>
        </nav>
      ) : null}
      <div className="editor-right-dock-code" hidden={!showCode}>
        {props.code}
      </div>
      <div className="editor-right-dock-properties" hidden={showCode}>
        {props.properties}
      </div>
    </aside>
  );
}
