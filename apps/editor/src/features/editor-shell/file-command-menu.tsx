import {
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type ComponentType,
  type RefObject,
} from "react";

import type { RecentProjectFile } from "../../hosts/native-project-store";

export interface FileCommandMenuProps {
  NativeFileCommands?: ComponentType<
    NonNullable<FileCommandMenuProps["nativeFiles"]>
  >;
  nativeFiles?: {
    projectName: string;
    path: string | null;
    recent: RecentProjectFile[];
    busy: boolean;
    refresh(): void;
    open(id?: string): void;
    saveAs(options?: { name: string; intoLibrary: boolean }): void;
    forget(id: string): void;
    newProject?(): void;
  };
  cloudEnabled?: boolean;
  canRevert: boolean;
  hasRecoverySessions: boolean;
  checkAndSave: { enabled: boolean; execute: () => void };
  projectInputRef: RefObject<HTMLInputElement | null>;
  onNewProject: () => void;
  onSave: () => void;
  onImportProject: (file: File | null) => void;
  onImportSpice: (
    files: FileList | null,
    namingProfile?: "native" | "cadence-bang",
  ) => void;
  onExportProject: () => void;
  onExportSvg: () => void;
  onExportRaster: (format: "png" | "pdf") => void;
  onRevert: () => void;
  onOpenRecovery: () => void;
  /** Opens Project Info, where the circuit and its Cell are named. */
  onOpenInfo?: () => void;
  /**
   * Drawn as the File group inside another menu (the header's File menu),
   * which refreshes the native file list when it opens, not as a menu of its
   * own.
   */
  embedded?: boolean;
}

function CommandSubmenu({
  id,
  title,
  open,
  onToggle,
  onClose,
  children,
}: {
  id: string;
  title: string;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
  children: ReactNode;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const menu = options.current?.closest<HTMLElement>(
      ".file-command-popover, .project-menu-popover",
    );
    if (!open || !menu || getComputedStyle(menu).overflowY !== "auto") return;
    const bottom = options.current!.getBoundingClientRect().bottom;
    menu.scrollTop += Math.max(0, bottom - menu.getBoundingClientRect().bottom);
  }, [open]);
  return (
    <div
      className="export-submenu"
      onKeyDown={(event) => {
        if (open && event.key === "ArrowLeft") {
          event.preventDefault();
          event.stopPropagation();
          onClose();
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={(event) => {
          event.stopPropagation();
          onToggle();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) onToggle();
            requestAnimationFrame(() =>
              trigger.current?.parentElement
                ?.querySelector<HTMLElement>(
                  ".export-submenu-options button, .export-submenu-options .file-import",
                )
                ?.focus(),
            );
          }
        }}
      >
        {title}
        <span aria-hidden="true">›</span>
      </button>
      <div
        ref={options}
        className="export-submenu-options"
        id={id}
        role="group"
        aria-label={title}
        hidden={!open}
      >
        {children}
      </div>
    </div>
  );
}

export function FileCommandMenu({
  NativeFileCommands,
  nativeFiles,
  cloudEnabled = true,
  canRevert,
  hasRecoverySessions,
  checkAndSave,
  projectInputRef,
  onNewProject,
  onSave,
  onImportProject,
  onImportSpice,
  onExportProject,
  onExportSvg,
  onExportRaster,
  onRevert,
  onOpenRecovery,
  onOpenInfo,
  embedded = false,
}: FileCommandMenuProps) {
  const [openSubmenu, setOpenSubmenu] = useState<"import" | "export" | null>(
    null,
  );
  const activateFileLabel = (
    event: ReactKeyboardEvent<HTMLLabelElement>,
  ): void => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.currentTarget.querySelector("input")?.click();
  };
  // Private Cloud Projects are listed on the account page and in the
  // project tabs' Shelf, not here.
  const commands = (
    <>
      {onOpenInfo ? (
        <button type="button" aria-haspopup="dialog" onClick={onOpenInfo}>
          Project Info
        </button>
      ) : null}
      <button type="button" onClick={onNewProject}>
        New Project
      </button>
      <button
        type="button"
        data-testid="save-cloud-project"
        onClick={onSave}
        disabled={nativeFiles?.busy}
      >
        {cloudEnabled || nativeFiles ? "Save" : "Export Project File…"}
      </button>
      {nativeFiles && NativeFileCommands ? (
        <NativeFileCommands {...nativeFiles} newProject={onNewProject} />
      ) : null}
      {cloudEnabled ? (
        <>
          <button
            type="button"
            data-testid="check-and-save"
            disabled={!checkAndSave.enabled}
            onClick={checkAndSave.execute}
            title="Check ERC and visual issues, and save this Cloud Project"
          >
            Check and Save
          </button>
        </>
      ) : null}
      <div>
        <CommandSubmenu
          id="file-import-options"
          title="Import"
          open={openSubmenu === "import"}
          onToggle={() => {
            setOpenSubmenu((current) =>
              current === "import" ? null : "import",
            );
          }}
          onClose={() => setOpenSubmenu(null)}
        >
          <label
            className="file-import"
            tabIndex={0}
            onKeyDown={activateFileLabel}
          >
            Project File…
            <input
              ref={projectInputRef}
              data-testid="project-file"
              type="file"
              accept=".json,.icproj.json,application/json"
              onChange={(event) =>
                onImportProject(event.currentTarget.files?.[0] ?? null)
              }
            />
          </label>
          <label
            className="file-import"
            tabIndex={0}
            onKeyDown={activateFileLabel}
          >
            SPICE / SCS…
            <input
              data-testid="spice-files"
              type="file"
              accept=".spi,.cir,.sp,.scs,.inc,.lib"
              multiple
              onChange={(event) => onImportSpice(event.currentTarget.files)}
            />
          </label>
          <label
            className="file-import"
            tabIndex={0}
            onKeyDown={activateFileLabel}
          >
            Cadence SPICE (`!` globals)…
            <input
              data-testid="cadence-spice-files"
              type="file"
              accept=".spi,.cir,.sp,.scs,.inc,.lib"
              multiple
              onChange={(event) =>
                onImportSpice(event.currentTarget.files, "cadence-bang")
              }
            />
          </label>
        </CommandSubmenu>
      </div>
      <div>
        <CommandSubmenu
          id="file-export-options"
          title="Export"
          open={openSubmenu === "export"}
          onToggle={() => {
            setOpenSubmenu((current) =>
              current === "export" ? null : "export",
            );
          }}
          onClose={() => setOpenSubmenu(null)}
        >
          <button
            type="button"
            aria-label="Export Project File…"
            onClick={onExportProject}
          >
            Project File…
          </button>
          <button type="button" aria-label="Export SVG" onClick={onExportSvg}>
            Drawing as SVG
          </button>
          <button
            type="button"
            aria-label="Export PNG"
            onClick={() => onExportRaster("png")}
          >
            Drawing as PNG
          </button>
          <button
            type="button"
            aria-label="Export PDF"
            onClick={() => onExportRaster("pdf")}
          >
            Drawing as PDF
          </button>
        </CommandSubmenu>
      </div>
      {canRevert ? (
        <button type="button" onClick={onRevert}>
          Revert to Last Saved
        </button>
      ) : null}
      {hasRecoverySessions ? (
        <button type="button" onClick={onOpenRecovery}>
          Recover Unsaved Work…
        </button>
      ) : null}
    </>
  );
  if (embedded)
    return (
      <div className="command-section" role="group" aria-label="File">
        {/* The File menu's own summary names these commands. */}
        {commands}
      </div>
    );
  return (
    <details
      className="command-menu"
      name="editor-command-menu"
      onToggle={(event) => {
        if (event.currentTarget.open) nativeFiles?.refresh();
        else setOpenSubmenu(null);
      }}
    >
      <summary>File</summary>
      <div className="command-popover file-command-popover">{commands}</div>
    </details>
  );
}
