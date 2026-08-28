import type { SearchResult } from "@icm/derived";
import { useEffect, useRef } from "react";

export interface ProjectSearchDialogProps {
  open: boolean;
  query: string;
  results: readonly SearchResult[];
  onQueryChange(query: string): void;
  onSelect(result: SearchResult): void;
  onClose(): void;
}

export function ProjectSearchDialog({
  open,
  query,
  results,
  onQueryChange,
  onSelect,
  onClose,
}: ProjectSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (open) requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);
  if (!open) return null;
  return (
    <div
      className="search-backdrop"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className="project-search-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="project-search-title"
      >
        <header>
          <div>
            <p className="help-kicker">Project navigation</p>
            <h2 id="project-search-title">Search schematic</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close search">
            Close
          </button>
        </header>
        <input
          dir="auto"
          ref={inputRef}
          data-testid="project-search-input"
          aria-label="Search project"
          value={query}
          placeholder="Instance, Net, port, property…"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <div className="project-search-results" aria-live="polite">
          {query.trim().length === 0 ? (
            <p>
              Search instance IDs, symbols, Nets, ports, property keys or
              values.
            </p>
          ) : results.length === 0 ? (
            <p>No matching project objects.</p>
          ) : (
            results.map((result) => (
              <button
                type="button"
                key={`${result.locator.documentId}:${result.locator.kind}:${result.locator.objectId}:${result.locator.hierarchyPath.map((frame) => frame.instanceId).join("/")}`}
                data-testid={`project-search-result-${result.locator.objectId}${result.locator.hierarchyPath.length > 0 ? `-${result.locator.hierarchyPath.map((frame) => frame.instanceId).join("-")}` : ""}`}
                onClick={() => onSelect(result)}
              >
                <strong>{result.label}</strong>
                <small>
                  {result.locator.kind} · {result.locator.documentId} ·{" "}
                  {result.field}
                  {result.locator.hierarchyPath.length > 0
                    ? ` · via ${result.locator.hierarchyPath.map((frame) => frame.instanceId).join(" / ")}`
                    : ""}
                </small>
              </button>
            ))
          )}
        </div>
      </section>
    </div>
  );
}
