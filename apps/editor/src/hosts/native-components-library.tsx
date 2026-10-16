import { ComponentDraftList } from "../features/user-components/component-draft-list";
import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import { SymbolArtwork } from "../features/component-insert/symbol-artwork";
import { InlineConfirm } from "../components/inline-confirm";
import {
  parseSharedComponentPayload,
  componentCapability,
  type SharedComponent,
} from "../features/user-components/component-library-contract";
import { useEditorServices } from "../services/editor-services";
import {
  listNativeComponents,
  readNativeComponent,
  saveNativeComponent,
  manageNativeComponent,
} from "./native-component-library";
import "./native-dialog.css";

type Props = ComponentProps<
  typeof import("../features/user-components/user-components-library").default
>;

/** Reuses the definition editor and Project capture model with a private library. */
export default function NativeComponentsLibrary({
  open,
  onClose,
  onCreate,
  onEdit,
  onInsert,
  refresh,
  drafts,
  onDeleteDrafts,
  previewDraftDeletion,
  onOpenDraft,
}: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const importFile = useRef<HTMLInputElement>(null);
  const { exportDelivery } = useEditorServices();
  const [entries, setEntries] = useState<SharedComponent[]>([]);
  const [query, setQuery] = useState("");
  const [deleted, setDeleted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const openedDialog = dialog.current;
    openedDialog?.showModal();
    const controller = new AbortController();
    void listNativeComponents(controller.signal)
      .then(setEntries)
      .catch((error) => {
        if (!controller.signal.aborted) setError(String(error));
      });
    return () => {
      controller.abort();
      openedDialog?.close();
    };
  }, [open, refresh]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await work();
      setEntries(await listNativeComponents());
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  async function choose(
    entry: SharedComponent,
    intent: "place" | "new" | "update",
  ) {
    await run(async () => {
      const current = await readNativeComponent(entry.id);
      if (current.revision !== entry.revision || current.status === "deleted")
        throw Error(
          "This component changed. Reopen the library before selecting it.",
        );
      onClose();
      if (intent === "place") await onInsert(current);
      else await onEdit(current, intent);
    });
  }
  const visible = entries.filter(
    (entry) =>
      (entry.status === "deleted") === deleted &&
      entry.definition.symbol.name
        .toLocaleLowerCase()
        .includes(query.toLocaleLowerCase()),
  );
  if (!open || typeof document === "undefined") return null;
  return createPortal(
    <dialog
      ref={dialog}
      className="native-dialog native-components-dialog"
      aria-label="User Components"
      onKeyDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onClose();
      }}
    >
      <header>
        <div>
          <h2>User Components</h2>
          <p>Saved on this computer · no account required</p>
        </div>
        <button disabled={busy} onClick={onClose}>
          Close
        </button>
      </header>
      <div className="native-library-toolbar">
        <input
          autoFocus
          aria-label="Search local components"
          placeholder="Search components"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <select
          aria-label="Component list filter"
          value={deleted ? "deleted" : "active"}
          onChange={(event) => setDeleted(event.target.value === "deleted")}
        >
          <option value="active">Components</option>
          <option value="deleted">Removed components</option>
        </select>
        <button
          disabled={busy}
          className="primary"
          onClick={() => {
            onClose();
            onCreate();
          }}
        >
          Create Component…
        </button>
        <button disabled={busy} onClick={() => importFile.current?.click()}>
          Import definition…
        </button>
        <input
          ref={importFile}
          hidden
          type="file"
          accept=".json"
          aria-label="Import local component"
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = "";
            if (!file) return;
            void run(async () => {
              if (file.size > 1024 * 1024)
                throw Error("Component definition is too large");
              const value = JSON.parse(await file.text());
              const payload = parseSharedComponentPayload(
                value?.symbol
                  ? { definition: value }
                  : {
                      definition: value?.definition,
                      ...(value?.circuit === undefined
                        ? {}
                        : { circuit: value.circuit }),
                    },
              );
              await saveNativeComponent(
                crypto.randomUUID(),
                0,
                payload.definition,
                payload.circuit,
                { idempotencyKey: crypto.randomUUID() },
              );
              setDeleted(false);
            });
          }}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <ul className="native-component-list">
        {visible.map((entry) => (
          <li key={entry.id}>
            <span className="native-component-preview">
              <SymbolArtwork
                symbol={entry.definition.symbol}
                fitContent
                className="user-component-art"
              />
            </span>
            <div className="native-library-entry">
              <strong>{entry.definition.symbol.name}</strong>
              <small>
                {componentCapability(entry)} ·{" "}
                {entry.definition.symbol.pins.length} pins · Revision{" "}
                {entry.revision}
              </small>
            </div>
            {deleted ? (
              <button
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    await manageNativeComponent(entry, "shared");
                  })
                }
              >
                Restore
              </button>
            ) : (
              <>
                <button
                  disabled={busy}
                  onClick={() => void choose(entry, "place")}
                >
                  Place
                </button>
                <button
                  disabled={busy}
                  onClick={() => void choose(entry, "update")}
                >
                  Edit definition…
                </button>
              </>
            )}
            <details className="native-more-actions">
              <summary
                aria-label={`More actions for ${entry.definition.symbol.name}`}
              >
                More
              </summary>
              <div className="native-action-menu">
                {!deleted ? (
                  <button
                    disabled={busy}
                    onClick={() => void choose(entry, "new")}
                  >
                    Create independent copy…
                  </button>
                ) : null}
                <button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const current = await readNativeComponent(entry.id);
                      await exportDelivery.deliverFile({
                        suggestedName: `${current.definition.symbol.name.replace(/[<>:"/\\|?*]/gu, "-")}.component.json`,
                        mediaType: "application/json",
                        bytes: new TextEncoder().encode(
                          JSON.stringify(current, null, 2),
                        ),
                      });
                    })
                  }
                >
                  Export definition…
                </button>
                {!deleted ? (
                  <InlineConfirm
                    disabled={busy}
                    onConfirm={() =>
                      run(async () => {
                        await manageNativeComponent(entry, "deleted");
                      })
                    }
                  >
                    Remove component
                  </InlineConfirm>
                ) : null}
              </div>
            </details>
          </li>
        ))}
      </ul>
      {!visible.length ? (
        <p>
          {query
            ? "No matching components."
            : deleted
              ? "No removed components."
              : "Create or import a definition to reuse it across projects."}
        </p>
      ) : null}
      {drafts ? (
        <ComponentDraftList
          catalog={drafts}
          onOpen={(target) => {
            onClose();
            onOpenDraft?.(target);
          }}
          onDelete={onDeleteDrafts}
          previewDeletion={previewDraftDeletion}
        />
      ) : null}
      <footer className="native-library-note">
        Placed components are captured in the project file. Editing the library
        keeps existing projects unchanged.
      </footer>
    </dialog>,
    document.body,
  );
}
