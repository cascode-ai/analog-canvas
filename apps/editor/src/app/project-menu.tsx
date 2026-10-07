import { useRef, type ReactNode } from "react";

import { dismissOpenCommandMenus } from "./editor-runtime-helpers";

export interface ProjectMenuProps {
  /** The menu's name in the header; the project's name is its tooltip. */
  label?: string;
  name: string;
  dirty: boolean;
  /** The file commands: the header's File group. */
  children?: ReactNode;
  onOpen?(): void;
}

/**
 * The header's File menu holds Project Info, where the circuit and its Cell
 * are named, and the file commands. Project tabs select projects.
 */
export function ProjectMenu({
  label,
  name,
  dirty,
  children,
  onOpen,
}: ProjectMenuProps) {
  const menu = useRef<HTMLDetailsElement>(null);
  const close = () => {
    if (menu.current) menu.current.open = false;
    menu.current?.querySelector("summary")?.focus();
  };
  return (
    <details
      className="command-menu project-menu"
      name="editor-command-menu"
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
        <span className="project-menu-title">{label ?? name}</span>
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
    </details>
  );
}
