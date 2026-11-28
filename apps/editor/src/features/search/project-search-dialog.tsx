import type { SearchResult } from "@icm/derived";
import { useEffect, useRef, useState } from "react";
import { deferFocus } from "../../interaction/deferred-focus";

export interface ProjectSearchDialogProps {
  open: boolean;
  query: string;
  results: readonly SearchResult[];
  truncated?: boolean;
  currentCellId?: string;
  onSelectMatching?: (ids: readonly string[]) => void;
  onQueryChange(query: string): void;
  onSelect(result: SearchResult): void;
  onClose(): void;
}

export function ProjectSearchDialog({
  open,
  query,
  results,
  truncated,
  currentCellId,
  onSelectMatching,
  onQueryChange,
  onSelect,
  onClose,
}: ProjectSearchDialogProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  useEffect(() => {
    if (open) return deferFocus(() => inputRef.current);
  }, [open]);
  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);
  if (!open) return null;
  const boundedIndex =
    results.length > 0 ? Math.min(activeIndex, results.length - 1) : -1;
  const matchingInCell = [
    ...new Set(
      results.flatMap(({ locator }) =>
        locator.kind === "instance" && locator.documentId === currentCellId
          ? [locator.objectId]
          : [],
      ),
    ),
  ];
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
            <h2 id="project-search-title">Find in Circuit</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close search">
            Close
          </button>
        </header>
        <input
          dir="auto"
          ref={inputRef}
          data-testid="project-search-input"
          aria-label="Find in circuit"
          autoComplete="off"
          value={query}
          placeholder="Instance, Net, port, property…"
          onChange={(event) => onQueryChange(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              onClose();
            } else if (event.key === "ArrowDown" && results.length > 0) {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % results.length);
            } else if (event.key === "ArrowUp" && results.length > 0) {
              event.preventDefault();
              setActiveIndex(
                (index) => (index - 1 + results.length) % results.length,
              );
            } else if (
              event.key === "Enter" &&
              boundedIndex >= 0 &&
              results[boundedIndex]
            ) {
              event.preventDefault();
              onSelect(results[boundedIndex]!);
            }
          }}
        />
        {matchingInCell.length > 0 && onSelectMatching ? (
          <button
            type="button"
            onClick={() => onSelectMatching(matchingInCell)}
          >
            Select matching instances in this Cell ({matchingInCell.length})
          </button>
        ) : null}
        {truncated ? (
          <p role="status">
            Some caller paths were omitted from these results.
          </p>
        ) : null}
        <div className="project-search-results" aria-live="polite">
          {query.trim().length === 0 ? (
            <p>
              Search instance IDs, component names, symbols, Nets, ports,
              property keys or values. Use a condition like w=2u to match both.
            </p>
          ) : results.length === 0 ? (
            <p>No matching project objects.</p>
          ) : (
            results.map((result, index) => (
              <button
                type="button"
                key={JSON.stringify([
                  result.locator.documentId,
                  result.locator.kind,
                  result.locator.objectId,
                  result.locator.hierarchyPath,
                ])}
                data-active={index === boundedIndex || undefined}
                aria-current={index === boundedIndex ? "true" : undefined}
                data-testid={`project-search-result-${result.locator.objectId}${result.locator.hierarchyPath.length > 0 ? `-${result.locator.hierarchyPath.map((frame) => frame.instanceId).join("-")}` : ""}`}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => onSelect(result)}
              >
                <strong>{result.label}</strong>
                <small>
                  {result.locator.kind} · {result.locator.documentId} ·{" "}
                  {result.field}
                  {result.locator.hierarchyPath.length > 0
                    ? ` · via ${result.hierarchyLabel ?? result.locator.hierarchyPath.map((frame) => frame.instanceId).join(" / ")}`
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
