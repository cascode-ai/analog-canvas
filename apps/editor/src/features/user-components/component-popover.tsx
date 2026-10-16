import { useLayoutEffect, useRef, type ReactNode } from "react";

/** Top-layer positioning keeps compact menus outside a scrolling card's clip. */
export function ComponentPopover({
  anchor,
  onClose,
  children,
  label,
}: {
  anchor: HTMLElement;
  onClose(): void;
  children: ReactNode;
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useLayoutEffect(() => {
    const node = ref.current!;
    node.showPopover();
    const position = () => {
      const a = anchor.getBoundingClientRect();
      const r = node.getBoundingClientRect();
      const scale = node.offsetWidth ? r.width / node.offsetWidth : 1;
      node.style.left = `${Math.max(8, Math.min(a.right - r.width, window.innerWidth - r.width - 8)) / scale}px`;
      node.style.top = `${Math.max(8, Math.min(a.bottom + 4, window.innerHeight - r.height - 8)) / scale}px`;
    };
    position();
    const resize = new ResizeObserver(position);
    resize.observe(node);
    const pointer = (e: PointerEvent) => {
      if (
        !node.contains(e.target as Node) &&
        !anchor.contains(e.target as Node)
      )
        close.current();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopImmediatePropagation();
        close.current();
        anchor.focus();
      }
      if (e.key === "ArrowDown" && document.activeElement === anchor) {
        e.preventDefault();
        node.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
      }
    };
    document.addEventListener("pointerdown", pointer, true);
    document.addEventListener("keydown", key, true);
    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    return () => {
      resize.disconnect();
      node.hidePopover();
      document.removeEventListener("pointerdown", pointer, true);
      document.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
    };
  }, [anchor]);
  return (
    <div
      ref={ref}
      popover="manual"
      className="component-popover"
      role="group"
      aria-label={label}
    >
      {children}
    </div>
  );
}
