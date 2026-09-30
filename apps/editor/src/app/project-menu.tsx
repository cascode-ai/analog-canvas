import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { dismissOpenCommandMenus } from "./editor-runtime-helpers";

export interface ProjectMenuProps {
  name: string;
  nameDraft: string | null;
  documentName: string;
  dirty: boolean;
  publication: { author: string; description: string } | null;
  onNameChange(value: string): void;
  onNameCommit(): void;
  onNameCancel(): void;
  projects?: {
    tabs: { id: string; name: string; dirty: boolean }[];
    activeId: string;
    busy: boolean;
    onSelect(id: string): void;
  };
  /**
   * The editor's commands, one labelled group each (File, Edit, Hierarchy,
   * Netlist): the header keeps one menu instead of a row of them.
   */
  children?: ReactNode;
  onOpen?(): void;
}

/** The project's name as the header's one menu; its details and commands live inside. */
export function ProjectMenu({
  name,
  nameDraft,
  documentName,
  dirty,
  publication,
  onNameChange,
  onNameCommit,
  onNameCancel,
  projects,
  children,
  onOpen,
}: ProjectMenuProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const cancelNameOnBlur = useRef(false);
  const close = () => {
    if (menu.current) menu.current.open = false;
    menu.current?.querySelector("summary")?.focus();
  };
  const navigateProjects = (event: KeyboardEvent<HTMLDivElement>) => {
    const items = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>(
        "button:not(:disabled)",
      ),
    );
    const index = items.indexOf(event.target as HTMLButtonElement);
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowUp"
          ? (index + items.length - 1) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : null;
    if (next === null || !items.length) return;
    event.preventDefault();
    event.stopPropagation();
    items[next]?.focus();
  };
  return (
    <details
      className="command-menu project-menu"
      data-testid="project-menu"
      ref={menu}
      onKeyDown={(event) => {
        if (event.key === "Escape") close();
      }}
      onToggle={(event) => {
        if (event.currentTarget.open) onOpen?.();
      }}
    >
      <summary title={name} data-testid="project-menu-toggle">
        <span className="project-menu-title">{name}</span>
        {dirty ? (
          <span
            className="project-unsaved-indicator"
            data-testid="project-unsaved-indicator"
            aria-label="Unsaved changes"
            title="Unsaved changes"
          >
            ●
          </span>
        ) : null}
      </summary>
      <div
        className="command-popover project-menu-popover"
        role="region"
        aria-label="Project details"
      >
        <label className="project-menu-name">
          <span>Project name</span>
          <input
            aria-label="Project name"
            autoComplete="off"
            data-testid="project-name-input"
            value={nameDraft ?? name}
            onChange={(event) => onNameChange(event.currentTarget.value)}
            onBlur={() => {
              if (cancelNameOnBlur.current) cancelNameOnBlur.current = false;
              else onNameCommit();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
                close();
              }
              if (event.key === "Escape") {
                event.preventDefault();
                cancelNameOnBlur.current = true;
                onNameCancel();
                close();
              }
            }}
          />
        </label>
        <dl className="project-menu-metadata">
          <div>
            <dt>Current Cell</dt>
            <dd data-testid="active-document-name">{documentName}</dd>
          </div>
        </dl>
        {projects ? (
          <div className="project-menu-projects">
            <span className="project-menu-heading">Open projects</span>
            <div
              role="menu"
              aria-label="Choose open project"
              onKeyDown={navigateProjects}
            >
              {projects.tabs.map((tab) => (
                <button
                  type="button"
                  role="menuitemradio"
                  aria-checked={tab.id === projects.activeId}
                  key={tab.id}
                  disabled={projects.busy}
                  onClick={() => {
                    close();
                    projects.onSelect(tab.id);
                  }}
                >
                  <span className="project-menu-check" aria-hidden="true">
                    {tab.id === projects.activeId ? "✓" : ""}
                  </span>
                  <span className="project-menu-option-name">{tab.name}</span>
                  {tab.dirty ? (
                    <span
                      className="project-menu-dirty"
                      aria-label="Unsaved changes"
                    >
                      ●
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        {publication ? (
          <dl
            className="project-menu-metadata project-menu-publication"
            data-testid="gallery-entry-popover"
            aria-label="Gallery entry information"
          >
            <div>
              <dt>Contributor</dt>
              <dd>{publication.author.trim() || "Unknown contributor"}</dd>
            </div>
            {publication.description.trim() ? (
              <div>
                <dt>Notes</dt>
                <dd>{publication.description.trim()}</dd>
              </div>
            ) : null}
          </dl>
        ) : null}
        {children ? (
          <div
            className="project-menu-commands"
            onClick={(event) => {
              // A command done closes the menu, as the old menus did; a
              // submenu or an inline confirmation keeps it open itself.
              const target = event.target;
              if (target instanceof Element && target.closest("button"))
                dismissOpenCommandMenus();
            }}
          >
            {children}
          </div>
        ) : null}
      </div>
    </details>
  );
}
