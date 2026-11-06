import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

/**
 * A right-click menu at a pointer position, kept inside the window. Escape
 * or a press outside closes it without taking that press, which still
 * reaches what it lands on. Opened from the keyboard, it takes focus: the
 * arrow keys move through its commands and Escape hands focus back.
 */
export function ContextMenu({
  position,
  label,
  testId,
  className,
  takeFocus = false,
  onClose,
  children,
}: {
  position: { x: number; y: number };
  label?: string;
  testId: string;
  className?: string;
  takeFocus?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const focusBefore = useRef<HTMLElement | null>(null);
  const [placed, setPlaced] = useState(position);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const bounds = menu.getBoundingClientRect();
    setPlaced({
      x: Math.max(
        4,
        Math.min(position.x, window.innerWidth - bounds.width - 4),
      ),
      y: Math.max(
        4,
        Math.min(position.y, window.innerHeight - bounds.height - 4),
      ),
    });
  }, [position]);

  useLayoutEffect(() => {
    if (!takeFocus) return;
    if (document.activeElement instanceof HTMLElement)
      focusBefore.current ??= document.activeElement;
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
      style={{ left: placed.x, top: placed.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
      onKeyDown={(event) => {
        const step =
          event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        event.preventDefault();
        const commands = [
          ...event.currentTarget.querySelectorAll<HTMLElement>(
            "button:enabled",
          ),
        ];
        const at = commands.indexOf(event.target as HTMLElement);
        commands[(at + step + commands.length) % commands.length]?.focus();
      }}
    >
      {children}
    </div>
  );
}
