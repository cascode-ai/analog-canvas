import { useEffect, useState } from "react";

export const LIBRARY_WIDTH_MIN = 180;
// Leave room for an expanded Gallery: one tag column and at least three cards.
export const LIBRARY_WIDTH_MAX = 960;
const LIBRARY_WIDTH_DEFAULT = 248;

function clampLibraryWidth(width: number): number {
  if (!Number.isFinite(width)) return LIBRARY_WIDTH_DEFAULT;
  return Math.min(
    LIBRARY_WIDTH_MAX,
    Math.max(LIBRARY_WIDTH_MIN, Math.round(width)),
  );
}

export type LeftPanelMode = "library" | "examples" | "hierarchy" | "objects";

export interface UseEditorPanelsOptions {
  initialCompact: boolean;
  compactMediaQuery: string;
  forceInitialLibraryOpen?: boolean;
  libraryStorageKey: string;
  libraryWidthStorageKey: string;
  /**
   * The compact layout shows one side at a time: a left panel opening there
   * closes the right-hand ones. Properties closes here; the editor closes
   * its project panel in this callback.
   */
  onCompactLeftPanelOpen?: () => void;
}

/** Flat owner of responsive shell-panel state and Library persistence. */
export function useEditorPanels(options: UseEditorPanelsOptions) {
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(() => {
    if (options.forceInitialLibraryOpen) return true;
    if (typeof window === "undefined") return true;
    try {
      return window.localStorage.getItem(options.libraryStorageKey) !== "false";
    } catch {
      return true;
    }
  });
  const [libraryWidth, setLibraryWidthState] = useState(() => {
    if (typeof window === "undefined") return LIBRARY_WIDTH_DEFAULT;
    try {
      const stored = window.localStorage.getItem(
        options.libraryWidthStorageKey,
      );
      return stored === null
        ? LIBRARY_WIDTH_DEFAULT
        : clampLibraryWidth(Number(stored));
    } catch {
      return LIBRARY_WIDTH_DEFAULT;
    }
  });
  const [compactLayout, setCompactLayout] = useState(options.initialCompact);
  const [compactLibraryPanelOpen, setCompactLibraryPanelOpen] = useState(false);
  const [leftPanelMode, setLeftPanelMode] = useState<LeftPanelMode>("library");
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [agentPanelOpen, setAgentPanelOpen] = useState(false);
  const [agentDetailsOpen, setAgentDetailsOpen] = useState(false);
  const [agentStatusDismissed, setAgentStatusDismissed] = useState(false);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const mediaQuery = window.matchMedia(options.compactMediaQuery);
    const updateCompactLayout = (): void => {
      setCompactLayout(mediaQuery.matches);
      if (mediaQuery.matches) setCompactLibraryPanelOpen(false);
    };
    updateCompactLayout();
    mediaQuery.addEventListener("change", updateCompactLayout);
    return () => mediaQuery.removeEventListener("change", updateCompactLayout);
  }, [options.compactMediaQuery]);

  const persistLibraryOpen = (open: boolean): void => {
    try {
      window.localStorage.setItem(options.libraryStorageKey, String(open));
    } catch {
      // Library visibility stays usable when browser storage is unavailable.
    }
  };

  /** Commit a dragged panel width, clamped to the readable range. */
  const setLibraryWidth = (width: number): void => {
    const next = clampLibraryWidth(width);
    setLibraryWidthState(next);
    try {
      window.localStorage.setItem(options.libraryWidthStorageKey, String(next));
    } catch {
      // The panel stays resizable when browser storage is unavailable.
    }
  };

  const showLeftPanel = (mode: LeftPanelMode): void => {
    setLeftPanelMode(mode);
    if (compactLayout) {
      setCompactLibraryPanelOpen(true);
      setSelectionOpen(false);
      options.onCompactLeftPanelOpen?.();
      return;
    }
    setLibraryPanelOpen(true);
    persistLibraryOpen(true);
  };

  /** Each left-panel mode has its own toggle; another mode's toggle switches. */
  const toggleLeftPanel = (mode: LeftPanelMode): void => {
    if (leftPanelMode !== mode) {
      showLeftPanel(mode);
      return;
    }
    if (compactLayout) {
      if (compactLibraryPanelOpen) {
        setCompactLibraryPanelOpen(false);
        return;
      }
      setCompactLibraryPanelOpen(true);
      setSelectionOpen(false);
      options.onCompactLeftPanelOpen?.();
      return;
    }
    setLibraryPanelOpen((current) => {
      const next = !current;
      persistLibraryOpen(next);
      return next;
    });
  };
  const toggleLibraryPanel = (): void => toggleLeftPanel("library");
  const toggleExamplesPanel = (): void => toggleLeftPanel("examples");
  const toggleHierarchyPanel = (): void => toggleLeftPanel("hierarchy");
  const toggleObjectsPanel = (): void => toggleLeftPanel("objects");

  const closeSearch = (): void => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  return {
    agentDetailsOpen,
    agentPanelOpen,
    agentStatusDismissed,
    closeSearch,
    compactLayout,
    compactLibraryPanelOpen,
    leftPanelMode,
    libraryPanelOpen,
    libraryWidth,
    searchOpen,
    searchQuery,
    selectionOpen,
    setAgentDetailsOpen,
    setAgentPanelOpen,
    setAgentStatusDismissed,
    setCompactLayout,
    setCompactLibraryPanelOpen,
    setLeftPanelMode,
    setLibraryPanelOpen,
    setLibraryWidth,
    setSearchOpen,
    setSearchQuery,
    setSelectionOpen,
    showLeftPanel,
    toggleExamplesPanel,
    toggleHierarchyPanel,
    toggleLibraryPanel,
    toggleObjectsPanel,
  };
}
