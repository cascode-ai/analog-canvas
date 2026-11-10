import { useRef, type ReactNode } from "react";

import { useBelowChrome } from "./below-chrome";

/**
 * The one place the editor's passive notices stand (#2182): a column just
 * under the actual chrome, wrapped toolbar and project tabs included. Each
 * notice takes its own height, wrapped text too, so none covers another;
 * what the chrome drops down (menus, a tab's close confirmation) stands
 * above the column.
 */
export function EditorNotices({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useBelowChrome(ref, "--editor-notices-top");
  return (
    <div ref={ref} className="editor-notices" data-testid="editor-notices">
      {children}
    </div>
  );
}
