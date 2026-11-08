import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  CircuitProject,
  ProjectSimulationFolder,
  SourceSpan,
} from "@icm/model";
import {
  simulationSpecAnnotations,
  type SimulationSpecAnnotation,
} from "@icm/simulation-service/contract";
import { NetlistCodeSelect } from "../netlist-export/netlist-code-controls";
import {
  codeViewportHeight,
  StaticCodeView,
} from "../project-code/static-code-view";
import {
  applyTestbenchImport,
  guessTestbenchEntry,
  newTestbench,
  pickedPath,
  planTestbenchImport,
  type ImportRowStatus,
  type PickedFile,
} from "./testbench-import";
import { isVisibleSimulationSource } from "../simulation/simulation-source-visibility";
import { formatSpecValues } from "../simulation/simulation-spec-format";
import "./testbench-panel.css";

const ProjectTextEditor = lazy(
  () => import("../project-code/project-text-editor"),
);

type LocatedSpec = SimulationSpecAnnotation & {
  sourceRef: SourceSpan;
  path: string;
};

/** The Cell a folder runs: the one its circuit binding names, if any. */
function testbenchCell(folder: ProjectSimulationFolder): string | null {
  return folder.input.circuitBindings[0]?.documentId ?? null;
}

/** The author's files, entry first; valid machine metadata stays hidden. */
export function testbenchFiles(folder: ProjectSimulationFolder): string[] {
  const paths = folder.input.files
    .map((file) => file.path)
    .filter((path) => isVisibleSimulationSource(folder, path));
  return [
    ...paths.filter((path) => path === folder.input.entry),
    ...paths.filter((path) => path !== folder.input.entry).sort(),
  ];
}

/** `<Cell> testbench`, numbered when the Project already has one. */
function freshName(project: CircuitProject, cellName: string): string {
  const taken = new Set(
    project.simulationFolders.map((folder) => folder.name.toLowerCase()),
  );
  const base = `${cellName} testbench`;
  for (let n = 1; ; n += 1) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function specCondition(spec: SimulationSpecAnnotation): string {
  const { condition, unit } = formatSpecValues(null, spec.expected, spec.unit);
  return unit ? `${condition} ${unit}` : condition;
}

/**
 * A Cell's Testbench beside its netlist (#2110): the author's own source and
 * the Specs it declares, saved in the Project. Nothing here prepares, runs or
 * asks a hosted service; the author runs it with their own simulator. A
 * draft applies as one Project edit when the editor loses focus or on
 * Mod+Enter, so Undo, Cloud Save and an Agent all see the same text.
 */
export function TestbenchPanel({
  project,
  rootDocumentId,
  onRootChange,
  onCommit,
  onDirtyChange,
  viewSwitch,
}: {
  project: CircuitProject;
  rootDocumentId?: string | undefined;
  onRootChange(documentId: string): void;
  /** One Project edit adding or replacing the folder; false when refused. */
  onCommit(folder: ProjectSimulationFolder, transactionId: string): boolean;
  onDirtyChange?(dirty: boolean): void;
  /** The dock's Netlist │ Testbench switch, at the start of the controls. */
  viewSwitch?: ReactNode;
}) {
  const cellId =
    rootDocumentId ?? project.topDocumentId ?? project.documents[0]?.id ?? "";
  const cell = project.documents.find((document) => document.id === cellId);
  const forCell = project.simulationFolders.filter(
    (folder) => testbenchCell(folder) === cellId,
  );
  const elsewhere = project.simulationFolders.filter(
    (folder) => testbenchCell(folder) !== cellId,
  );
  const [chosenFolder, setChosenFolder] = useState<string | null>(null);
  const folder =
    forCell.find((item) => item.id === chosenFolder) ?? forCell[0] ?? null;
  const files = folder ? testbenchFiles(folder) : [];
  const [chosenPath, setChosenPath] = useState<string | null>(null);
  const path =
    chosenPath && files.includes(chosenPath) ? chosenPath : (files[0] ?? null);
  const saved =
    folder && path
      ? (folder.input.files.find((file) => file.path === path)?.text ?? "")
      : "";

  // The unapplied text of one file, and what it was written over.
  const [draft, setDraft] = useState<{
    key: string;
    base: string;
    text: string;
  } | null>(null);
  const key = folder && path ? `${folder.id}\u0000${path}` : "";
  const ownDraft = draft?.key === key ? draft : null;
  const dirty = !!ownDraft && ownDraft.text !== ownDraft.base;
  // Another edit (an Agent, Undo, another tab) changed the saved text under
  // the draft: applying would overwrite it, so the draft waits for Reload.
  const conflict = dirty && saved !== ownDraft!.base;
  const shown = dirty ? ownDraft!.text : saved;
  const [error, setError] = useState<string | null>(null);
  const [reveal, setReveal] = useState<{
    path: string;
    from: number;
    to: number;
    id: number;
  } | null>(null);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  const latest = useRef({ ownDraft, dirty, conflict, folder, path });
  latest.current = { ownDraft, dirty, conflict, folder, path };
  const apply = () => {
    const { ownDraft, dirty, conflict, folder, path } = latest.current;
    if (!dirty || conflict || !ownDraft || !folder || !path) return;
    const next: ProjectSimulationFolder = {
      ...folder,
      input: {
        ...folder.input,
        files: folder.input.files.map((file) =>
          file.path === path ? { ...file, text: ownDraft.text } : file,
        ),
      },
    };
    if (onCommit(next, "edit-testbench-source")) {
      setDraft(null);
      setError(null);
    } else
      setError(
        "The edit was not applied to the Project. Your draft is kept here.",
      );
  };

  const specs = useMemo<LocatedSpec[]>(
    () =>
      folder
        ? testbenchFiles(folder).flatMap((file) =>
            simulationSpecAnnotations(
              file,
              file === path
                ? shown
                : (folder.input.files.find((item) => item.path === file)
                    ?.text ?? ""),
            ).map((spec) => ({ ...spec, path: file })),
          )
        : [],
    [folder, path, shown],
  );

  // Import: what the picked files would do, reviewed before one Project edit.
  // The rows are re-planned against the current folder on every render, so
  // an Agent or Undo meanwhile shows in the review, not as a silent overwrite.
  const filePicker = useRef<HTMLInputElement>(null);
  const folderPicker = useRef<HTMLInputElement>(null);
  const [picked, setPicked] = useState<{
    files: PickedFile[];
    folderId: string | null;
    excluded: ReadonlySet<string>;
    entry: string | null;
  } | null>(null);
  const importFolder = picked
    ? (project.simulationFolders.find((item) => item.id === picked.folderId) ??
      null)
    : null;
  const importLost = !!picked?.folderId && !importFolder;
  const importRows = picked
    ? planTestbenchImport(importFolder, picked.files)
    : [];
  const importEntry =
    picked?.entry && importRows.some((row) => row.path === picked.entry)
      ? picked.entry
      : guessTestbenchEntry(importRows);
  const readPicked = async (list: FileList | null) => {
    const chosen = [...(list ?? [])];
    if (!chosen.length) return;
    const files = await Promise.all(
      chosen.map(async (file) => ({
        path: pickedPath(file),
        text: await file.text(),
      })),
    );
    setPicked({
      files,
      folderId: folder?.id ?? null,
      excluded: new Set(),
      entry: null,
    });
    setError(null);
  };
  const confirmImport = () => {
    if (!picked || !cell || importLost) return;
    const chosen = new Set(
      importRows
        .filter((row) => !picked.excluded.has(row.path))
        .map((row) => row.path),
    );
    const result = applyTestbenchImport(
      project,
      { cellId, folder: importFolder },
      importRows,
      chosen,
      importFolder ? null : importEntry,
      freshName(project, cell.name),
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (onCommit(result.folder, "import-testbench-files")) {
      setPicked(null);
      setChosenFolder(result.folder.id);
      setChosenPath(null);
      setError(null);
    } else setError("Could not import the files. Nothing was changed.");
  };

  const createTestbench = () => {
    if (!cell) return;
    const result = newTestbench(
      project,
      cell.id,
      freshName(project, cell.name),
    );
    if (!result.ok) {
      setError(result.message);
      return;
    }
    if (onCommit(result.folder, "create-testbench")) {
      setChosenFolder(result.folder.id);
      setChosenPath(null);
      setError(null);
    } else setError("Could not add the Testbench.");
  };

  const cellSelect =
    project.documents.length > 1 ? (
      <NetlistCodeSelect
        label="Cell"
        ariaLabel="Testbench Cell"
        value={cellId}
        disabled={dirty}
        options={project.documents.map((document) => ({
          value: document.id,
          label: document.name,
        }))}
        onChange={(id) => {
          onRootChange(id);
          setChosenFolder(null);
          setChosenPath(null);
        }}
      />
    ) : null;
  const highlighted = reveal && reveal.path === path ? [reveal] : [];
  const specProblems = specs.filter(
    (spec) => spec.path === path && spec.problems.length,
  );
  const lineCount = shown.split(/\r\n?|\n/u).length;

  return (
    <section
      className="netlist-profile-code netlist-live-code testbench-panel"
      aria-label="Testbench"
      onDragOver={(event) => {
        if (!dirty && event.dataTransfer.types.includes("Files"))
          event.preventDefault();
      }}
      onDrop={(event) => {
        if (dirty || !event.dataTransfer.files.length) return;
        event.preventDefault();
        void readPicked(event.dataTransfer.files);
      }}
    >
      <input
        ref={filePicker}
        type="file"
        multiple
        hidden
        data-testid="testbench-import-files"
        onChange={(event) => {
          void readPicked(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <input
        ref={folderPicker}
        type="file"
        hidden
        data-testid="testbench-import-folder"
        {...{ webkitdirectory: "" }}
        onChange={(event) => {
          void readPicked(event.currentTarget.files);
          event.currentTarget.value = "";
        }}
      />
      <div className="netlist-code-controls">
        <div className="netlist-code-selects">
          {viewSwitch}
          {cellSelect}
          {forCell.length > 1 ? (
            <NetlistCodeSelect
              label="Testbench"
              ariaLabel="Testbench"
              value={folder?.id ?? ""}
              disabled={dirty}
              options={forCell.map((item) => ({
                value: item.id,
                label: item.name,
              }))}
              onChange={(id) => {
                setChosenFolder(id);
                setChosenPath(null);
              }}
            />
          ) : null}
        </div>
        <div className="netlist-code-actions">
          {folder ? (
            <>
              <button
                type="button"
                aria-label="Import files into this Testbench…"
                title="Import files into this Testbench…"
                disabled={dirty || !!picked}
                onClick={() => filePicker.current?.click()}
              >
                <ImportIcon />
              </button>
              <button
                type="button"
                aria-label="New Testbench for this Cell"
                title="New Testbench for this Cell"
                disabled={dirty}
                onClick={createTestbench}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path
                    d="M10 4v12M4 10h12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            </>
          ) : null}
        </div>
      </div>

      {picked ? (
        <div
          className="testbench-import"
          role="group"
          aria-label="Review import"
        >
          <p>
            {importFolder ? (
              <>
                Into <strong>{importFolder.name}</strong> for {cell?.name}
              </>
            ) : importLost ? (
              <>The Testbench this import was for no longer exists.</>
            ) : (
              <>
                A new Testbench for <strong>{cell?.name}</strong>
              </>
            )}
          </p>
          <ul>
            {importRows.map((row) => {
              const writable = row.status === "new" || row.status === "replace";
              return (
                <li key={row.path} data-status={row.status}>
                  <label>
                    <input
                      type="checkbox"
                      disabled={!writable}
                      checked={writable && !picked.excluded.has(row.path)}
                      onChange={(event) => {
                        const excluded = new Set(picked.excluded);
                        if (event.currentTarget.checked)
                          excluded.delete(row.path);
                        else excluded.add(row.path);
                        setPicked({ ...picked, excluded });
                      }}
                    />
                    <code>{row.path}</code>
                  </label>
                  <span className="testbench-import-status">
                    {IMPORT_STATUS[row.status]}
                  </span>
                </li>
              );
            })}
          </ul>
          {!importFolder && !importLost && importEntry ? (
            <NetlistCodeSelect
              label="Entry"
              ariaLabel="Testbench entry file"
              value={importEntry}
              options={importRows
                .filter(
                  (row) => row.status === "new" || row.status === "replace",
                )
                .map((row) => ({ value: row.path, label: row.path }))}
              onChange={(entry) => setPicked({ ...picked, entry })}
            />
          ) : null}
          <div className="testbench-actions">
            <button
              type="button"
              className="primary"
              disabled={importLost}
              onClick={confirmImport}
            >
              Import
            </button>
            <button
              type="button"
              onClick={() => {
                setPicked(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
          {error ? <p role="alert">{error}</p> : null}
        </div>
      ) : !folder ? (
        <div className="testbench-empty">
          <p>
            No Testbench for <strong>{cell?.name ?? "this Cell"}</strong> yet.
            Write one here or bring your own; it is saved with the Project and
            you run it with your own simulator.
          </p>
          <div className="testbench-actions">
            <button type="button" className="primary" onClick={createTestbench}>
              New Testbench
            </button>
            <button type="button" onClick={() => filePicker.current?.click()}>
              Import files…
            </button>
            <button type="button" onClick={() => folderPicker.current?.click()}>
              Import folder…
            </button>
          </div>
          {elsewhere.length ? (
            <div className="testbench-elsewhere">
              <span>Testbenches of other Cells</span>
              {elsewhere.map((item) => {
                const owner = testbenchCell(item);
                const ownerName = project.documents.find(
                  (document) => document.id === owner,
                )?.name;
                return owner && ownerName ? (
                  <button
                    key={item.id}
                    type="button"
                    className="testbench-elsewhere-item"
                    onClick={() => {
                      onRootChange(owner);
                      setChosenFolder(item.id);
                      setChosenPath(null);
                    }}
                  >
                    {item.name} <span>{ownerName}</span>
                  </button>
                ) : null;
              })}
            </div>
          ) : null}
        </div>
      ) : (
        <>
          {specs.length ? (
            <ul className="testbench-specs" aria-label="Specs">
              {specs.map((spec) => (
                <li key={`${spec.path}:${spec.sourceRef.start.offset}`}>
                  <button
                    type="button"
                    className="testbench-spec"
                    data-invalid={spec.problems.length > 0 || undefined}
                    onClick={() => {
                      setChosenPath(spec.path);
                      setReveal({
                        path: spec.path,
                        from: spec.sourceRef.start.offset,
                        to: spec.sourceRef.end.offset,
                        id: (reveal?.id ?? 0) + 1,
                      });
                    }}
                  >
                    {/* The name, as the source writes it: the rich label
                        needs the formula typesetter, a run report's concern. */}
                    <span className="testbench-spec-name">
                      {spec.name || "?"}
                    </span>
                    <span className="testbench-spec-condition">
                      {spec.problems.length ? "invalid" : specCondition(spec)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="testbench-hint">
              Declare requirements in the source, one per line:{" "}
              <code>* @spec gain &gt;= 60 unit=dB</code>
            </p>
          )}
          {files.length > 1 ? (
            <div className="testbench-files" role="tablist" aria-label="Files">
              {files.map((file) => (
                <button
                  key={file}
                  type="button"
                  role="tab"
                  aria-selected={file === path}
                  disabled={dirty && file !== path}
                  onClick={() => setChosenPath(file)}
                >
                  {file}
                </button>
              ))}
            </div>
          ) : null}
          <div
            className="netlist-code-viewport"
            data-line-count={lineCount}
            style={codeViewportHeight(lineCount)}
          >
            <Suspense
              fallback={
                <StaticCodeView
                  ariaLabel="Loading Testbench editor"
                  value={shown}
                />
              }
            >
              <ProjectTextEditor
                key={key}
                ariaLabel={`Testbench source ${path ?? ""}`}
                language="netlist"
                value={shown}
                onChange={(text) => {
                  setDraft((current) => ({
                    key,
                    base: current?.key === key ? current.base : saved,
                    text,
                  }));
                  setError(null);
                }}
                onModEnter={apply}
                onBlur={apply}
                highlightedRanges={[
                  ...specProblems.map((spec) => ({
                    from: spec.sourceRef.start.offset,
                    to: spec.sourceRef.end.offset,
                    tone: "warning" as const,
                  })),
                  ...highlighted,
                ]}
                {...(reveal ? { revealHighlight: String(reveal.id) } : {})}
              />
            </Suspense>
          </div>
          {specProblems.length ? (
            <ul className="testbench-problems" aria-label="Spec problems">
              {specProblems.map((spec) => (
                <li key={spec.sourceRef.start.offset}>
                  Line {spec.sourceRef.start.line}: {spec.problems.join(" ")}
                </li>
              ))}
            </ul>
          ) : null}
          {conflict ? (
            <div className="project-code-actions" role="alert">
              <span>Changed elsewhere — your draft is kept.</span>
              <button type="button" onClick={() => setDraft(null)}>
                Reload
              </button>
            </div>
          ) : null}
          {error ? <p role="alert">{error}</p> : null}
        </>
      )}
    </section>
  );
}

const IMPORT_STATUS: Record<ImportRowStatus, string> = {
  new: "New",
  replace: "Replaces",
  unchanged: "Unchanged",
  generated: "Skipped: Canvas writes it",
  unsafe: "Skipped: unsafe path",
  binary: "Skipped: not text",
};

function ImportIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path
        d="M10 3v9m-4-4 4 4 4-4M4 14v3h12v-3"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
