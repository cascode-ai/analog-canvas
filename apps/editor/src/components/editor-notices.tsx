import { useLayoutEffect, useRef, type ReactNode } from "react";

/**
 * The one place the editor's passive notices stand (#2182): a column just
 * under the actual chrome, wrapped toolbar and project tabs included. Each
 * notice takes its own height, wrapped text too, so none covers another;
 * what the chrome drops down (menus, a tab's close confirmation) stands
 * above the column.
 */
export function EditorNotices({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const chrome = document.querySelector(".app-chrome");
    if (!chrome) return;
    const update = () =>
      ref.current?.style.setProperty(
        "--editor-notices-top",
        `${chrome.getBoundingClientRect().bottom + 8}px`,
      );
    update();
    const observer = new ResizeObserver(update);
    observer.observe(chrome);
    window.addEventListener("resize", update);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);
  return (
    <div ref={ref} className="editor-notices" data-testid="editor-notices">
      {children}
    </div>
  );
}
