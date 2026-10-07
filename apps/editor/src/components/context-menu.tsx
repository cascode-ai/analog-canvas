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
 * reaches what it lands on.
 */
export function ContextMenu({
  position,
  label,
  testId,
  onClose,
  children,
}: {
  position: { x: number; y: number };
  label?: string;
  testId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const menuRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
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
      className="context-menu"
      data-testid={testId}
      role="menu"
      aria-label={label}
      style={{ left: placed.x, top: placed.y }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      {children}
    </div>
  );
}
