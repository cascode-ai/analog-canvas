import { useEffect, useRef, useState, type ComponentProps } from "react";
import { createPortal } from "react-dom";
import type { ComponentLibrarySummary } from "@icm/agent-adapter";
import { ComponentDraftList } from "../features/user-components/component-draft-list";
import { ContextMenu } from "../components/context-menu";
import { SymbolArtwork } from "../features/component-insert/symbol-artwork";
import { InlineConfirm } from "../components/inline-confirm";
import { ComponentPreviewCard } from "../features/user-components/component-preview-card";
import {
  ComponentMenuItem,
  ComponentRows,
  useComponentRowSurface,
} from "../features/user-components/component-row-surface";
import {
  parseSharedComponentPayload,
  summarizeSharedComponent,
  type SharedComponent,
} from "../features/user-components/component-library-contract";
import { useEditorServices } from "../services/editor-services";
import {
  listNativeComponents,
  readNativeComponent,
  saveNativeComponent,
  manageNativeComponent,
} from "./native-component-library";

type Props = ComponentProps<
  typeof import("../features/user-components/user-components-library").default
>;

/**
 * The Library's My components fold on the desktop: the shared rows and the
 * Project capture model over a private library that needs no account.
 */
export default function NativeComponentsLibrary({
  fold,
  onEdit,
  onInsert,
  onDropPlacement,
  refresh,
  drafts,
  onDeleteDrafts,
  previewDraftDeletion,
  onOpenDraft,
}: Props) {
  const { open, query, toolsSlot } = fold;
  const importFile = useRef<HTMLInputElement>(null);
  const { exportDelivery } = useEditorServices();
  const surface = useComponentRowSurface(fold.focusSearch);
  const [entries, setEntries] = useState<SharedComponent[]>([]);
  const [removedOpen, setRemovedOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    void listNativeComponents(controller.signal)
      .then(setEntries)
      .catch((failure) => {
        if (!controller.signal.aborted) setError(String(failure));
      });
    return () => controller.abort();
  }, [open, refresh]);
  async function run(work: () => Promise<void>): Promise<boolean> {
    if (busy) return false;
    setBusy(true);
    setError("");
    try {
      await work();
      setEntries(await listNativeComponents());
      return true;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
      return false;
    } finally {
      setBusy(false);
    }
  }
  const record = (summary: ComponentLibrarySummary) =>
    entries.find((entry) => entry.id === summary.id)!;
  async function choose(
    summary: ComponentLibrarySummary,
    intent: "place" | "new" | "update",
  ): Promise<boolean> {
    return run(async () => {
      const current = await readNativeComponent(summary.id);
      if (current.revision !== summary.revision || current.status === "deleted")
        throw Error(
          "This component changed. Reopen the library before selecting it.",
        );
      if (intent !== "place") await onEdit(current, intent);
      else if ((await onInsert(current)) === false)
        throw Error("This component could not be placed.");
    });
  }
  async function deliver(summary: ComponentLibrarySummary) {
    await run(async () => {
      const current = await readNativeComponent(summary.id);
      await exportDelivery.deliverFile({
        suggestedName: `${current.definition.symbol.name.replace(/[<>:"/\\|?*]/gu, "-")}.component.json`,
        mediaType: "application/json",
        bytes: new TextEncoder().encode(JSON.stringify(current, null, 2)),
      });
    });
  }
  const summaries = entries.map(summarizeSharedComponent);
  const term = query.trim().toLocaleLowerCase();
  const matching = summaries.filter((summary) =>
    summary.name.toLocaleLowerCase().includes(term),
  );
  const active = matching.filter((summary) => summary.status !== "deleted");
  const removed = matching.filter((summary) => summary.status === "deleted");
  const artwork = (
    summary: ComponentLibrarySummary,
    onPreviewWarning?: (warning: string | null) => void,
  ) => (
    <span className="user-component-preview">
      <SymbolArtwork
        symbol={record(summary).definition.symbol}
        fitContent
        className="user-component-art"
        {...(onPreviewWarning ? { onPreviewWarning } : {})}
      />
    </span>
  );
  const closeMenu = () => surface.setMenu(null);
  const renderMenu = () => {
    const entry = surface.menu?.entry;
    if (!entry) return null;
    const deleted = entry.status === "deleted";
    return (
      <ContextMenu
        position={surface.menu!}
        label={`Actions for ${entry.name}`}
        testId="component-context-menu"
        className="hierarchy-context-menu"
        takeFocus={surface.menu?.fromKeyboard ?? false}
        onClose={closeMenu}
      >
        <ComponentMenuItem
          label="Details"
          onClose={closeMenu}
          onSelect={() => surface.pin(entry, record(entry))}
        />
        {deleted ? (
          <ComponentMenuItem
            label="Restore"
            onClose={closeMenu}
            onSelect={() =>
              void run(async () => {
                await manageNativeComponent(record(entry), "shared");
              })
            }
          />
        ) : (
          <>
            <ComponentMenuItem
              label="Edit definition…"
              onClose={closeMenu}
              onSelect={() => void choose(entry, "update")}
            />
            <ComponentMenuItem
              label="Create independent copy…"
              onClose={closeMenu}
              onSelect={() => void choose(entry, "new")}
            />
          </>
        )}
        <ComponentMenuItem
          label="Export definition…"
          onClose={closeMenu}
          onSelect={() => void deliver(entry)}
        />
        {!deleted ? (
          <>
            <div className="hierarchy-context-divider" role="separator" />
            <InlineConfirm
              disabled={busy}
              onConfirm={async () => {
                await run(async () => {
                  await manageNativeComponent(record(entry), "deleted");
                });
                closeMenu();
              }}
            >
              Remove component
            </InlineConfirm>
          </>
        ) : null}
      </ContextMenu>
    );
  };
  return (
    <div
      ref={surface.root}
      className="user-components-panel"
      data-plain-keys="local"
      onKeyDown={(event) => surface.onKeyDown(event, matching)}
    >
      {toolsSlot
        ? createPortal(
            <button
              type="button"
              className="shapes-fold-tool"
              aria-label="Import definition"
              title="Import definition"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                importFile.current?.click();
              }}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path d="M8 2.5v8M4.8 7.3 8 10.5l3.2-3.2M3 13.5h10" />
              </svg>
            </button>,
            toolsSlot,
          )
        : null}
      <input
        ref={importFile}
        hidden
        type="file"
        accept=".json"
        aria-label="Import local component"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (!file) return;
          void run(async () => {
            if (file.size > 1024 * 1024)
              throw Error("Component definition is too large");
            const value = JSON.parse(await file.text());
            const payload = parseSharedComponentPayload(
              value?.symbol
                ? { definition: value }
                : {
                    definition: value?.definition,
                    ...(value?.circuit === undefined
                      ? {}
                      : { circuit: value.circuit }),
                  },
            );
            await saveNativeComponent(
              crypto.randomUUID(),
              0,
              payload.definition,
              payload.circuit,
              { idempotencyKey: crypto.randomUUID() },
            );
          });
        }}
      />
      {error ? (
        <p className="user-components-message" role="alert">
          {error}
        </p>
      ) : null}
      <ComponentRows
        surface={surface}
        entries={active}
        scope="local"
        busy={busy}
        authorImplied
        artwork={artwork}
        onPlace={(entry) => choose(entry, "place")}
        onDropPlacement={onDropPlacement}
      />
      {!active.length ? (
        <p className="user-components-message">
          {term
            ? `No component of yours matches “${query.trim()}”.`
            : "Create or import a definition to reuse it across projects. It stays on this computer; placed components are captured in the Project."}
        </p>
      ) : null}
      {drafts ? (
        <ComponentDraftList
          catalog={drafts}
          onOpen={(target) => onOpenDraft?.(target)}
          onDelete={onDeleteDrafts}
          previewDeletion={previewDraftDeletion}
        />
      ) : null}
      {summaries.some((summary) => summary.status === "deleted") ? (
        <details
          className="user-components-nested"
          open={removedOpen}
          onToggle={(event) => setRemovedOpen(event.currentTarget.open)}
        >
          <summary>
            <span>Removed</span>
          </summary>
          {removedOpen ? (
            <ComponentRows
              surface={surface}
              entries={removed}
              scope="removed"
              busy={busy}
              authorImplied
              artwork={artwork}
            />
          ) : null}
        </details>
      ) : null}
      {renderMenu()}
      {surface.card ? (
        <ComponentPreviewCard
          summary={surface.card.summary}
          row={surface.card.row}
          artwork={artwork}
          entry={surface.card.entry}
          onHold={surface.holdPreview}
          onRelease={surface.endPreview}
          onClose={surface.closeCard}
          authorImplied
        />
      ) : null}
    </div>
  );
}
