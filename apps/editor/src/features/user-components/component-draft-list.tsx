import { useState } from "react";
import {
  componentDraftKey,
  type ComponentDraftCatalog,
  type ComponentDraftTarget,
} from "@icm/edit-engine";
import { ComponentPopover } from "./component-popover";
const size = (n: number) =>
  n < 1024 ? `${n} B` : `${(n / 1024).toFixed(1)} KiB`;
export function ComponentDraftList({
  catalog,
  onOpen,
  onDelete,
  previewDeletion,
  expanded = false,
}: {
  catalog: ComponentDraftCatalog;
  onOpen(target: ComponentDraftTarget): void;
  onDelete?: ((targets: ComponentDraftTarget[]) => string | null) | undefined;
  previewDeletion?: ((targets: ComponentDraftTarget[]) => number) | undefined;
  expanded?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [manage, setManage] = useState(false);
  const [message, setMessage] = useState("");
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const targets = catalog.entries
    .filter((e) => selected.includes(componentDraftKey(e.target)))
    .map((e) => e.target);
  function remove(targets: ComponentDraftTarget[]) {
    const error = onDelete?.(targets);
    setMessage(error ?? "Draft deleted. Undo restores it.");
    if (!error) {
      setSelected([]);
      setAnchor(null);
    }
  }
  if (!expanded && !catalog.entries.length && !message) return null;
  const Container = expanded ? "section" : "details";
  const Heading = expanded ? "h3" : "summary";
  return (
    <Container
      className={`component-project-drafts${expanded ? " is-expanded" : ""}`}
    >
      <Heading>Project drafts ({catalog.entries.length})</Heading>
      <div className="component-draft-summary">
        <small>
          {size(catalog.bytes)} stored · shared sources counted once
        </small>
        {onDelete ? (
          <button
            type="button"
            onClick={() => {
              setManage(!manage);
              setSelected([]);
            }}
          >
            Select
          </button>
        ) : null}
      </div>
      {catalog.limits
        .filter((l) => l.used >= l.maximum * 0.9)
        .map((l) => (
          <small role="status" key={l.scope + l.unit}>
            {l.scope}: {l.used}/{l.maximum} {l.unit}
          </small>
        ))}
      <div className="component-draft-rows">
        {catalog.entries.map((e) => {
          const key = componentDraftKey(e.target);
          return (
            <div className="component-draft-row" key={key}>
              {manage ? (
                <input
                  type="checkbox"
                  aria-label={"Select " + e.name}
                  checked={selected.includes(key)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, key]
                        : selected.filter((k) => k !== key),
                    )
                  }
                />
              ) : null}
              <button
                type="button"
                className="component-draft-name"
                title={e.diagnostic ?? e.name}
                onClick={() => onOpen(e.target)}
              >
                {e.name}
              </button>
              <small>
                {e.target.kind} · {size(e.bytes)}
              </small>
              {onDelete ? (
                <button
                  type="button"
                  aria-label={"Delete draft " + e.name}
                  title="Delete draft"
                  onClick={() => remove([e.target])}
                >
                  ×
                </button>
              ) : null}
            </div>
          );
        })}
      </div>
      {manage && targets.length ? (
        <button type="button" onClick={(e) => setAnchor(e.currentTarget)}>
          Delete selected ({targets.length})
        </button>
      ) : null}
      {anchor && targets.length ? (
        <ComponentPopover
          anchor={anchor}
          label="Delete selected drafts"
          onClose={() => setAnchor(null)}
        >
          <span>
            Delete {targets.length} drafts · free{" "}
            {size(previewDeletion?.(targets) ?? 0)}?
          </span>
          <button type="button" onClick={() => remove(targets)}>
            Delete
          </button>
          <button type="button" onClick={() => setAnchor(null)}>
            Cancel
          </button>
        </ComponentPopover>
      ) : null}
      {message ? <small role="status">{message}</small> : null}
    </Container>
  );
}
