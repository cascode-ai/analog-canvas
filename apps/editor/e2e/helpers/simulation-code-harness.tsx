// Isolated component browser contract; not a Project persistence or simulation acceptance fixture.
import { useState } from "react";
import { createRoot } from "react-dom/client";
import SimulationCodeEditor from "../../src/features/simulation/code-editor";
import { SimulationCodeWorkspace } from "../../src/features/simulation/code-workspace";
import "../../src/styles/editor-entry.css";

const initial =
  "* 🧪\r\nV1 in 0 1\r\nR1 in out 1k\nR2 out 0 1k\r\n.control\r\nop\r\nwrite out.raw\r\n.endc\r\n.end\r\n";
function Harness() {
  const [files, setFiles] = useState<Record<string, string>>({
    "run.cir": initial,
    "circuit.spice": "R1 in out 1k\n",
    "experiment.json": '{"version":1}',
  });
  const [path, setPath] = useState("run.cir");
  const [revision, setRevision] = useState(0);
  const [saved, setSaved] = useState(initial);
  const [cursor, setCursor] = useState(0);
  const [pane, setPane] = useState<"console" | "results">("console");
  const [maximized, setMaximized] = useState(false);
  const save = () => {
    setSaved(files[path]!);
    setRevision((value) => value + 1);
  };
  return (
    <>
      <div
        style={{ width: "740px", height: "660px", border: "1px solid #ddd" }}
      >
        <SimulationCodeWorkspace
          workspaceKey="component-test"
          files={Object.keys(files).map((path) => ({
            path,
            kind: path === "circuit.spice" ? "generated" : "authored",
          }))}
          entryPath="run.cir"
          configPath="experiment.json"
          activePath={path}
          onSelectFile={setPath}
          actions={<button onClick={save}>Save source</button>}
          outputPane={pane}
          onSelectOutputPane={setPane}
          console={<div>Component console — no simulator attached</div>}
          results={<div>Component results</div>}
          status={`Revision ${revision}`}
          maximized={maximized}
          onToggleMaximize={() => setMaximized((value) => !value)}
        >
          <SimulationCodeEditor
            path={path}
            text={files[path]!}
            historyKey={String(revision)}
            entry={path === "run.cir"}
            mode={path.endsWith(".json") ? "json" : "spice"}
            readOnly={path === "circuit.spice"}
            onChange={(text) =>
              setFiles((current) => ({ ...current, [path]: text }))
            }
            onSave={save}
            onCursor={setCursor}
          />
        </SimulationCodeWorkspace>
      </div>
      <output data-testid="saved-source" hidden>
        {JSON.stringify(saved)}
      </output>
      <output data-testid="draft-source" hidden>
        {JSON.stringify(files[path])}
      </output>
      <output data-testid="source-cursor" hidden>
        {cursor}
      </output>
    </>
  );
}

export function mountSimulationCodeHarness() {
  const root = document.createElement("div");
  document.body.replaceChildren(root);
  document.documentElement.style.setProperty("--icm-surface", "#fff");
  document.documentElement.style.setProperty("--icm-surface-muted", "#f8fafc");
  document.documentElement.style.setProperty("--icm-text", "#28303b");
  document.documentElement.style.setProperty("--icm-text-muted", "#79818a");
  document.documentElement.style.setProperty("--icm-border", "#e1e5e9");
  createRoot(root).render(<Harness />);
}
