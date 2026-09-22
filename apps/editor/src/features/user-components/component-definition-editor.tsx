import { planComponentDefinitionEdit } from "./component-definition-plan";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { InlineConfirm } from "../../components/inline-confirm";
import type { ComponentDefinition } from "@icm/model";
import {
  AccountMenu,
  fetchSessionUser,
  type SessionUser,
} from "../../components/account";
import { SymbolArtwork } from "../component-insert/symbol-artwork";
import {
  parseSharedDefinition,
  type SharedComponent,
} from "./component-library-contract";
import {
  manageSharedComponent,
  saveSharedComponent,
} from "./component-library-client";

const ProjectTextEditor = lazy(
  () => import("../project-code/project-text-editor"),
);

export interface ComponentDefinitionEditorProps {
  definition: ComponentDefinition;
  entry?: SharedComponent;
  mode: "new" | "instance" | "library";
  validateApply?(
    definition: ComponentDefinition,
    planner: typeof planComponentDefinitionEdit,
  ): string | null;
  onSaved(
    entry: SharedComponent,
    planner: typeof planComponentDefinitionEdit,
  ): string | null;
  onManaged(): void;
  onClose(): void;
}

function definitionError(error: unknown): string {
  if (error && typeof error === "object" && "issues" in error) {
    const first = (
      error.issues as Array<{ path: unknown[]; message: string }>
    )[0];
    if (first) return `${first.path.join(".")}: ${first.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}

export default function ComponentDefinitionEditor(
  props: ComponentDefinitionEditorProps,
) {
  const latest = useRef(props);
  latest.current = props;
  const [source, setSource] = useState(() =>
    JSON.stringify(props.definition, null, 2),
  );
  const [baseline, setBaseline] = useState(source);
  const [record, setRecord] = useState(props.entry);
  const [newId] = useState(() => crypto.randomUUID());
  const [user, setUser] = useState<SessionUser | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [pinNames, setPinNames] = useState(true);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    dialog.current?.showModal();
    let active = true;
    void fetchSessionUser().then((next) => {
      if (active) {
        setUser(next);
        setAuthReady(true);
      }
    });
    return () => {
      active = false;
      dialog.current?.close();
    };
  }, []);
  const parsed = useMemo(() => {
    try {
      return {
        definition: parseSharedDefinition(JSON.parse(source)),
        error: null,
      };
    } catch (error) {
      return { definition: null, error: definitionError(error) };
    }
  }, [source]);
  const canUpdate =
    !!record &&
    (user?.isAdmin ||
      (record.authorId === user?.id && record.status === "shared"));
  const id = canUpdate ? record!.id : newId;
  const revision = canUpdate ? record!.revision : 0;
  const [discarding, setDiscarding] = useState(false);
  function close() {
    if (busy) return;
    if (source !== baseline) {
      setDiscarding(!discarding);
      return;
    }
    props.onClose();
  }
  async function save() {
    if (!parsed.definition || busy || !user || record?.status === "deleted")
      return;
    const conflict = latest.current.validateApply?.(
      parsed.definition,
      planComponentDefinitionEdit,
    );
    if (conflict) {
      setNotice(conflict);
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      const saved = await saveSharedComponent(id, revision, parsed.definition);
      setRecord(saved);
      setBaseline(source);
      const error = latest.current.onSaved(saved, planComponentDefinitionEdit);
      setNotice(
        error ? `Saved publicly. ${error}` : "Saved to the public library.",
      );
    } catch (error) {
      setNotice(definitionError(error));
    } finally {
      setBusy(false);
    }
  }
  async function manage(status: "official" | "deleted" | "shared") {
    if (!record || busy) return;
    setBusy(true);
    setNotice(null);
    try {
      setRecord(await manageSharedComponent(record, status));
      props.onManaged();
      setNotice(
        status === "deleted"
          ? "Removed from the library."
          : status === "official"
            ? "Promoted to an official component."
            : "Restored to User Defined.",
      );
    } catch (error) {
      setNotice(definitionError(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="component-definition-dialog"
      aria-label="Edit Component Definition"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onKeyDown={(event) => {
        if (
          (event.metaKey || event.ctrlKey) &&
          event.key.toLowerCase() === "s"
        ) {
          event.preventDefault();
          void save();
        }
      }}
    >
      <header>
        <strong>Edit Component Definition</strong>
        <div className="component-definition-actions">
          {!user && authReady ? <AccountMenu showGalleryLinks={false} /> : null}
          <button
            type="button"
            className="primary"
            disabled={
              !authReady ||
              !user ||
              !parsed.definition ||
              busy ||
              record?.status === "deleted"
            }
            onClick={() => void save()}
          >
            {busy
              ? "Saving…"
              : props.mode === "instance"
                ? "Save & apply"
                : props.mode === "new"
                  ? "Save & place"
                  : canUpdate
                    ? "Save"
                    : "Save as new component"}
          </button>
          {source !== baseline ? (
            <InlineConfirm
              aria-label="Close component editor"
              disabled={busy}
              open={discarding}
              onOpenChange={setDiscarding}
              confirmLabel="Discard changes"
              cancelLabel="Keep editing"
              onConfirm={props.onClose}
            >
              ×
            </InlineConfirm>
          ) : (
            <button
              type="button"
              aria-label="Close component editor"
              disabled={busy}
              onClick={close}
            >
              ×
            </button>
          )}
        </div>
      </header>
      <p className="component-definition-note">
        Saved components are public in User Defined.
        {props.mode === "instance"
          ? " Only the selected instance changes."
          : " Everyone can insert a copy."}
        {authReady && !user ? " Sign in to save." : ""}
      </p>
      <div className="component-definition-workspace">
        <section
          className="component-definition-preview"
          aria-label="Component preview"
        >
          {parsed.definition ? (
            <>
              <div className="component-definition-art">
                <SymbolArtwork
                  symbol={parsed.definition.symbol}
                  className="component-definition-artwork"
                  paddingRatio={0.25}
                />
              </div>
              <label>
                <input
                  type="checkbox"
                  checked={pinNames}
                  onChange={(event) => setPinNames(event.target.checked)}
                />{" "}
                Pin coordinates
              </label>
              {pinNames ? (
                <ul>
                  {parsed.definition.symbol.pins.map((pin) => (
                    <li key={pin.name}>
                      <code>{pin.name}</code> ({pin.at.x}, {pin.at.y}) ·{" "}
                      {pin.direction}
                    </li>
                  ))}
                </ul>
              ) : null}
              <small>
                {parsed.definition.symbol.primitives.length} drawing primitives
                · {parsed.definition.symbol.pins.length} pins
              </small>
            </>
          ) : (
            <p>Fix the code to update the preview.</p>
          )}
        </section>
        <section className="component-definition-code">
          <Suspense fallback={<p>Loading code editor…</p>}>
            <ProjectTextEditor
              ariaLabel="Component definition code"
              language="json"
              value={source}
              invalid={!!parsed.error}
              onChange={setSource}
              onModEnter={() => void save()}
            />
          </Suspense>
        </section>
      </div>
      {parsed.error ? <p role="alert">{parsed.error}</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {user?.isAdmin && record ? (
        <footer className="component-definition-actions">
          <span>
            {record.author} · Revision {record.revision} · {record.status}
          </span>
          {record.status !== "official" && record.status !== "deleted" ? (
            <button
              type="button"
              disabled={busy || source !== baseline}
              onClick={() => void manage("official")}
            >
              Promote to official
            </button>
          ) : null}
          {record.status !== "shared" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void manage("shared")}
            >
              {record.status === "deleted"
                ? "Restore"
                : "Return to User Defined"}
            </button>
          ) : null}
          {record.status !== "deleted" ? (
            <InlineConfirm disabled={busy} onConfirm={() => manage("deleted")}>
              Delete component
            </InlineConfirm>
          ) : null}
        </footer>
      ) : null}
    </dialog>
  );
}
