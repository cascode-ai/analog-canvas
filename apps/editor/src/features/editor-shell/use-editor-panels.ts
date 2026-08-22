import { useEffect, useState } from "react";
import type { MutableRefObject } from "react";

export const LIBRARY_WIDTH_MIN = 180;
export const LIBRARY_WIDTH_MAX = 520;
export const LIBRARY_WIDTH_DEFAULT = 248;

export function clampLibraryWidth(width: number): number {
  if (!Number.isFinite(width)) return LIBRARY_WIDTH_DEFAULT;
  return Math.min(
    LIBRARY_WIDTH_MAX,
    Math.max(LIBRARY_WIDTH_MIN, Math.round(width)),
  );
}

export interface UseEditorPanelsOptions {
  initialCompact: boolean;
  compactMediaQuery: string;
  libraryStorageKey: string;
  libraryWidthStorageKey: string;
  helpButtonRef: MutableRefObject<HTMLButtonElement | null>;
  helpCloseRef: MutableRefObject<HTMLButtonElement | null>;
}

/** Flat owner of responsive shell-panel state and Library persistence. */
export function useEditorPanels(options: UseEditorPanelsOptions) {
  const [libraryPanelOpen, setLibraryPanelOpen] = useState(() => {
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
  const [leftPanelMode, setLeftPanelMode] = useState<"library" | "examples">(
    "library",
  );
  const [selectionOpen, setSelectionOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
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

  useEffect(() => {
    if (helpOpen) options.helpCloseRef.current?.focus();
  }, [helpOpen]);

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

  const showLeftPanel = (mode: "library" | "examples"): void => {
    setLeftPanelMode(mode);
    if (compactLayout) {
      setCompactLibraryPanelOpen(true);
      setSelectionOpen(false);
      return;
    }
    setLibraryPanelOpen(true);
    persistLibraryOpen(true);
  };

  const toggleLibraryPanel = (): void => {
    if (leftPanelMode === "examples") {
      showLeftPanel("library");
      return;
    }
    if (compactLayout) {
      setCompactLibraryPanelOpen((current) => {
        const next = !current;
        if (next) setSelectionOpen(false);
        return next;
      });
      return;
    }
    setLibraryPanelOpen((current) => {
      const next = !current;
      persistLibraryOpen(next);
      return next;
    });
  };

  const toggleExamplesPanel = (): void => {
    if (leftPanelMode !== "examples") {
      showLeftPanel("examples");
      return;
    }
    if (compactLayout) {
      setCompactLibraryPanelOpen((current) => {
        const next = !current;
        if (next) setSelectionOpen(false);
        return next;
      });
      return;
    }
    setLibraryPanelOpen((current) => {
      const next = !current;
      persistLibraryOpen(next);
      return next;
    });
  };

  const closeHelp = (): void => {
    setHelpOpen(false);
    requestAnimationFrame(() => options.helpButtonRef.current?.focus());
  };

  const closeSearch = (): void => {
    setSearchOpen(false);
    setSearchQuery("");
  };

  return {
    agentDetailsOpen,
    agentPanelOpen,
    agentStatusDismissed,
    closeHelp,
    closeSearch,
    compactLayout,
    compactLibraryPanelOpen,
    helpOpen,
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
    setHelpOpen,
    setLeftPanelMode,
    setLibraryPanelOpen,
    setLibraryWidth,
    setSearchOpen,
    setSearchQuery,
    setSelectionOpen,
    showLeftPanel,
    toggleExamplesPanel,
    toggleLibraryPanel,
  };
}
