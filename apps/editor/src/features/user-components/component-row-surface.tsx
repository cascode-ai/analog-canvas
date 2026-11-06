import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { startCanvasDrag } from "../editor-shell/canvas-drag";
import { groupCatalogEntries } from "./component-catalog-groups";
import type { SharedComponent } from "./component-library-contract";
import { ComponentLibraryRow } from "./component-library-row";

const PREVIEW_DELAY_MS = 300;
const PREVIEW_SWITCH_MS = 60;
const PREVIEW_LINGER_MS = 150;

interface RowMenu {
  entry: ComponentLibrarySummary;
  x: number;
  y: number;
  fromKeyboard?: boolean;
}

/**
 * The working surface both hosts' component lists share: which row shows its
 * preview, which row's menu is open and which groups are expanded. Each host
 * brings its own records and commands, so this module stays free of the
 * network library the desktop build must not contain.
 */
export function useComponentRowSurface() {
  const [card, setCard] = useState<{
    summary: ComponentLibrarySummary;
    row: HTMLElement;
    entry?: SharedComponent;
  } | null>(null);
  const [menu, setMenu] = useState<RowMenu | null>(null);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const suppressClick = useRef(false);
  useEffect(() => () => clearTimeout(timer.current), []);
  const closeCard = () => {
    clearTimeout(timer.current);
    setCard(null);
  };
  const endPreview = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(
      () => setCard((current) => (current?.entry ? current : null)),
      PREVIEW_LINGER_MS,
    );
  };
  return {
    root,
    card,
    menu,
    openGroups,
    suppressClick,
    setMenu,
    setOpenGroups,
    closeCard,
    endPreview,
    holdPreview: () => clearTimeout(timer.current),
    preview(summary: ComponentLibrarySummary, row: HTMLElement) {
      clearTimeout(timer.current);
      timer.current = setTimeout(
        () =>
          setCard((current) => (current?.entry ? current : { summary, row })),
        card ? PREVIEW_SWITCH_MS : PREVIEW_DELAY_MS,
      );
    },
    /** Details keeps the card open and adds what the full record holds. */
    pin(summary: ComponentLibrarySummary, entry: SharedComponent) {
      const row = root.current?.querySelector<HTMLElement>(
        `[data-component-id="${CSS.escape(summary.id)}"]`,
      );
      if (row) setCard({ summary, row, entry });
    },
    onKeyDown(
      event: ReactKeyboardEvent<HTMLDivElement>,
      entries: readonly ComponentLibrarySummary[],
    ) {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("component-row-main")) return;
      const rows = [
        ...event.currentTarget.querySelectorAll<HTMLElement>(
          ".component-row-main",
        ),
      ];
      const at = rows.indexOf(target);
      if (
        event.key === "ContextMenu" ||
        (event.key === "F10" && event.shiftKey)
      ) {
        const id = target.closest<HTMLElement>("[data-component-id]")?.dataset
          .componentId;
        const entry = entries.find((item) => item.id === id);
        if (entry) {
          const box = target.getBoundingClientRect();
          closeCard();
          setMenu({
            entry,
            x: box.left + 24,
            y: box.bottom,
            fromKeyboard: true,
          });
        }
      } else if (event.key === "ArrowDown") rows[at + 1]?.focus();
      else if (event.key === "ArrowUp") rows[at - 1]?.focus();
      else if (event.key === "Home") rows[0]?.focus();
      else if (event.key === "End") rows.at(-1)?.focus();
      else {
        // Typing on a row continues the panel's search, as in a file explorer.
        if (
          event.key.length === 1 &&
          event.key !== " " &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        )
          event.currentTarget
            .closest(".shapes-panel")
            ?.querySelector<HTMLElement>('input[type="search"]')
            ?.focus();
        return;
      }
      event.preventDefault();
    },
  };
}

/** One list of records, with one author's same-named records grouped. */
export function ComponentRows({
  surface,
  entries,
  scope,
  busy,
  own = false,
  artwork,
  onPlace,
  onDropPlacement,
}: {
  surface: ReturnType<typeof useComponentRowSurface>;
  entries: readonly ComponentLibrarySummary[];
  /** Keeps two lists' expanded groups apart. */
  scope: string;
  busy: boolean;
  own?: boolean;
  artwork(entry: ComponentLibrarySummary): ReactNode;
  /** Resolves true once placement has started. */
  onPlace(entry: ComponentLibrarySummary): Promise<boolean>;
  onDropPlacement?: ((clientX: number, clientY: number) => void) | undefined;
}) {
  const rows: ReactNode[] = [];
  const row = (
    entry: ComponentLibrarySummary,
    extra: {
      variant?: boolean;
      count?: number;
      expanded?: boolean;
      onToggleGroup?(): void;
    },
  ) => (
    <ComponentLibraryRow
      key={`${entry.id}:${entry.revision}`}
      entry={entry}
      busy={busy}
      tabbable={rows.length === 0}
      own={own}
      artwork={artwork(entry)}
      {...extra}
      onToggleGroup={extra.onToggleGroup ?? (() => {})}
      onPlace={() => {
        surface.closeCard();
        if (!surface.suppressClick.current) void onPlace(entry);
      }}
      onDragStart={(event) => {
        surface.closeCard();
        startCanvasDrag(event, {
          begin: () => onPlace(entry),
          drop: (x, y) => onDropPlacement?.(x, y),
          dragged: () => {
            surface.suppressClick.current = true;
            window.setTimeout(() => {
              surface.suppressClick.current = false;
            }, 0);
          },
        });
      }}
      onMenu={(anchor) => {
        surface.closeCard();
        surface.setMenu({ entry, ...anchor });
      }}
      onPreview={(element) => surface.preview(entry, element)}
      onPreviewEnd={surface.endPreview}
    />
  );
  for (const group of groupCatalogEntries(entries)) {
    const groupKey = `${scope}:${group.key}`;
    const expanded = surface.openGroups.has(groupKey);
    rows.push(
      row(group.head, {
        count: group.others.length,
        expanded,
        onToggleGroup: () =>
          surface.setOpenGroups((current) => {
            const next = new Set(current);
            if (!next.delete(groupKey)) next.add(groupKey);
            return next;
          }),
      }),
    );
    if (expanded)
      for (const other of group.others)
        rows.push(row(other, { variant: true }));
  }
  return <>{rows}</>;
}

export function ComponentMenuItem({
  label,
  note,
  onSelect,
  onClose,
}: {
  label: string;
  note?: string;
  onSelect(): void;
  onClose(): void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={() => {
        onClose();
        onSelect();
      }}
    >
      <span>
        {label}
        {note ? <small className="hierarchy-menu-note">{note}</small> : null}
      </span>
    </button>
  );
}
