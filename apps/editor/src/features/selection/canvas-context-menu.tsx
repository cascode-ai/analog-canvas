import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  ContextMenu,
  fitContextMenuPosition,
} from "../../components/context-menu";

export interface ContextMenuAction {
  label: string;
  enabled: boolean;
  execute: () => void;
}

type MenuItem =
  ContextMenuAction | { label: string; actions: readonly ContextMenuAction[] };

interface OpenSubmenu {
  label: string;
  trigger: HTMLButtonElement;
  focus: boolean;
}

const SUBMENU_SWITCH_DELAY_MS = 180;

function placeSubmenu(panel: HTMLElement, trigger: HTMLButtonElement) {
  // Meet the trigger's edge so the pointer can cross the root menu padding.
  const { left, right, top } = trigger.getBoundingClientRect();
  const bounds = panel.getBoundingClientRect();
  const rightSpace = window.innerWidth - right;
  const x =
    rightSpace >= bounds.width || rightSpace >= left
      ? right - 1
      : left - bounds.width + 1;
  const position = fitContextMenuPosition({ x, y: top - 4 }, bounds);
  panel.style.left = `${position.x}px`;
  panel.style.top = `${position.y}px`;
}

export function CanvasContextMenu({
  position,
  items,
  onClose,
}: {
  position: { x: number; y: number };
  items: readonly MenuItem[];
  onClose: () => void;
}) {
  const [submenu, setSubmenu] = useState<OpenSubmenu | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const hoverTimeout = useRef<number | undefined>(undefined);
  const submenuId = useId();

  useEffect(() => () => window.clearTimeout(hoverTimeout.current), []);

  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!submenu || !panel) return;
    const { trigger, focus } = submenu;
    const parent = trigger.closest('[role="menu"]');
    if (!parent) return;
    const place = () => placeSubmenu(panel, trigger);
    place();
    if (focus) panel.querySelector("button")?.focus({ preventScroll: true });
    window.addEventListener("resize", place);
    parent.addEventListener("scroll", place, { passive: true });
    return () => {
      window.removeEventListener("resize", place);
      parent.removeEventListener("scroll", place);
    };
  }, [submenu]);

  function changeSubmenu(next: OpenSubmenu | null) {
    if (panelRef.current?.contains(document.activeElement))
      submenu?.trigger.focus({ preventScroll: true });
    setSubmenu(next);
  }

  function hoverSubmenu(next: OpenSubmenu | null) {
    window.clearTimeout(hoverTimeout.current);
    if (submenu?.label === next?.label) return;
    // Crossing another row on the way to an open submenu must leave time
    // for that submenu to receive the pointer and keep itself open.
    if (submenu) {
      hoverTimeout.current = window.setTimeout(
        () => changeSubmenu(next),
        SUBMENU_SWITCH_DELAY_MS,
      );
    } else {
      setSubmenu(next);
    }
  }

  const available = items.flatMap<MenuItem>((item) => {
    if (!("actions" in item)) return item.enabled ? [item] : [];
    const actions = item.actions.filter((action) => action.enabled);
    return actions.length ? [{ label: item.label, actions }] : [];
  });

  function actionButton(action: ContextMenuAction, topLevel = false) {
    return (
      <button
        key={action.label}
        type="button"
        role="menuitem"
        tabIndex={-1}
        className="context-menu-item"
        onPointerEnter={
          topLevel
            ? (event) => {
                if (event.pointerType !== "touch") hoverSubmenu(null);
              }
            : undefined
        }
        onClick={() => {
          action.execute();
          onClose();
        }}
      >
        {action.label}
      </button>
    );
  }

  return (
    <ContextMenu
      position={position}
      label="Selection actions"
      testId="canvas-context-menu"
      className="canvas-context-menu"
      takeFocus
      closeOnFocusLeave
      onClose={onClose}
      onKeyDownCapture={(event) => {
        window.clearTimeout(hoverTimeout.current);
        // The editor shortcut router runs in capture at the window.
        if (event.defaultPrevented) onClose();
      }}
    >
      <div className="context-menu-section" role="none">
        {available.map((item) => {
          if (!("actions" in item)) return actionButton(item, true);
          const open = submenu?.label === item.label;
          const openAndFocus = (trigger: HTMLButtonElement) => {
            window.clearTimeout(hoverTimeout.current);
            setSubmenu({ label: item.label, trigger, focus: true });
          };
          return (
            <div
              key={item.label}
              role="none"
              onPointerLeave={(event) => {
                if (event.pointerType !== "touch") hoverSubmenu(null);
              }}
            >
              <button
                type="button"
                role="menuitem"
                tabIndex={-1}
                className="context-menu-item context-menu-branch"
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? submenuId : undefined}
                onPointerEnter={(event) => {
                  if (event.pointerType !== "touch")
                    hoverSubmenu({
                      label: item.label,
                      trigger: event.currentTarget,
                      focus: false,
                    });
                }}
                onClick={(event) => openAndFocus(event.currentTarget)}
                onKeyDown={(event) => {
                  if (
                    event.key !== "ArrowRight" ||
                    event.altKey ||
                    event.ctrlKey ||
                    event.metaKey
                  )
                    return;
                  event.preventDefault();
                  openAndFocus(event.currentTarget);
                }}
              >
                {item.label}
              </button>
              {open ? (
                <div
                  id={submenuId}
                  ref={panelRef}
                  role="menu"
                  tabIndex={-1}
                  aria-label={item.label}
                  className="context-menu context-menu-submenu"
                  onPointerEnter={() =>
                    window.clearTimeout(hoverTimeout.current)
                  }
                  onKeyDown={(event) => {
                    if (
                      event.key !== "Escape" &&
                      (event.key !== "ArrowLeft" ||
                        event.altKey ||
                        event.ctrlKey ||
                        event.metaKey)
                    )
                      return;
                    event.preventDefault();
                    event.stopPropagation();
                    changeSubmenu(null);
                  }}
                >
                  {item.actions.map((action) => actionButton(action))}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </ContextMenu>
  );
}
