import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEventHandler,
  type ReactNode,
} from "react";

export function fitContextMenuPosition(
  { x, y }: { x: number; y: number },
  { width, height }: { width: number; height: number },
) {
  const margin = 4;
  return {
    x: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
    y: Math.max(margin, Math.min(y, window.innerHeight - height - margin)),
  };
}

/**
 * A right-click menu at a pointer position, kept inside the window. Escape
 * or a press outside closes it without taking that press, which still
 * reaches what it lands on. With takeFocus, the first command takes focus
 * and Escape hands focus back.
 */
export function ContextMenu({
  position,
  label,
  testId,
  className,
  takeFocus = false,
  closeOnFocusLeave = false,
  onClose,
  onKeyDownCapture,
  children,
}: {
  position: { x: number; y: number };
  label?: string;
  testId: string;
  className?: string;
  takeFocus?: boolean;
  closeOnFocusLeave?: boolean;
  onClose: () => void;
  onKeyDownCapture?: KeyboardEventHandler<HTMLDivElement>;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const focusBefore = useRef<HTMLElement | SVGElement | null>(null);
  const [placed, setPlaced] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    setPlaced(fitContextMenuPosition(position, menu.getBoundingClientRect()));
  }, [position]);

  useLayoutEffect(() => {
    if (!takeFocus) return;
    const previous = document.activeElement;
    if (previous instanceof HTMLElement || previous instanceof SVGElement)
      focusBefore.current ??= previous;
    menuRef.current?.querySelector<HTMLElement>("button:enabled")?.focus();
  }, [takeFocus]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      focusBefore.current?.focus();
      onClose();
    };
    const onPointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node &&
        !menuRef.current?.contains(event.target)
      )
        onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={className ? `context-menu ${className}` : "context-menu"}
      data-testid={testId}
      role="menu"
      aria-label={label}
      tabIndex={closeOnFocusLeave ? -1 : undefined}
      style={{ left: placed.x, top: placed.y }}
      onBlur={
        closeOnFocusLeave
          ? (event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) onClose();
            }
          : undefined
      }
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDownCapture={onKeyDownCapture}
      onKeyDown={(event) => {
        if (
          event.defaultPrevented ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        )
          return;
        const step =
          event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        const target = event.target as HTMLElement;
        const menu = target.closest('[role="menu"]');
        if (!step || !menu) return;
        event.preventDefault();
        const commands = [
          ...menu.querySelectorAll<HTMLElement>("button:enabled"),
        ].filter((button) => button.closest('[role="menu"]') === menu);
        const current = commands.indexOf(target);
        const at = current === -1 && step === -1 ? 0 : current;
        commands[(at + step + commands.length) % commands.length]?.focus();
      }}
    >
      {children}
    </div>
  );
}
