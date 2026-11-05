import { useState } from "react";
import type { ChildPortDraft } from "./new-child-cell";

export function NewChildDialog({
  parentName,
  onCancel,
  onCreate,
}: {
  parentName: string;
  onCancel(): void;
  onCreate(name: string, ports: ChildPortDraft[]): string | undefined;
}) {
  const [name, setName] = useState("");
  const [ports, setPorts] = useState<ChildPortDraft[]>([]);
  const [error, setError] = useState("");
  return (
    <div
      className="insert-dialog-backdrop"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <section
        className="editor-action-dialog new-child-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-child-title"
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            setError(onCreate(name.trim(), ports) ?? "");
          }}
        >
          <header className="editor-action-dialog-header">
            <h2 id="new-child-title">New child Cell</h2>
          </header>
          <div className="editor-action-dialog-body">
            <p>
              Create a child in {parentName}, place its symbol, then enter it.
            </p>
            <label>
              Name{" "}
              <input
                autoFocus
                aria-label="Child Cell name"
                value={name}
                onChange={(event) => setName(event.currentTarget.value)}
              />
            </label>
            <fieldset>
              <legend>Initial Ports (optional)</legend>
              {ports.map((port, index) => (
                <div className="child-port-row" key={index}>
                  <input
                    aria-label={`Port ${index + 1} name`}
                    value={port.name}
                    onChange={(event) =>
                      setPorts(
                        ports.map((item, i) =>
                          i === index
                            ? { ...item, name: event.currentTarget.value }
                            : item,
                        ),
                      )
                    }
                  />
                  <select
                    aria-label={`Port ${index + 1} direction`}
                    value={port.direction}
                    onChange={(event) =>
                      setPorts(
                        ports.map((item, i) =>
                          i === index
                            ? {
                                ...item,
                                direction: event.currentTarget
                                  .value as ChildPortDraft["direction"],
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    <option value="input">Input</option>
                    <option value="output">Output</option>
                    <option value="inout">Inout</option>
                    <option value="passive">Passive</option>
                  </select>
                  <button
                    type="button"
                    aria-label={`Remove Port ${index + 1}`}
                    onClick={() =>
                      setPorts(ports.filter((_, i) => i !== index))
                    }
                  >
                    ×
                  </button>
                </div>
              ))}
              <button
                type="button"
                onClick={() =>
                  setPorts([...ports, { name: "", direction: "input" }])
                }
              >
                Add Port
              </button>
            </fieldset>
            <p>Esc cancels before placement without adding a Cell.</p>
            {error ? <p role="alert">{error}</p> : null}
          </div>
          <footer className="editor-action-dialog-actions">
            <button type="button" onClick={onCancel}>
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || ports.some((port) => !port.name.trim())}
            >
              Place and enter
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}
