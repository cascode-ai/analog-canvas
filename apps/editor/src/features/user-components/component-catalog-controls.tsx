import { useRef, useState } from "react";
import { useDismissDetails } from "../../components/dismiss-details";
import type {
  ComponentCatalogQuery,
  ComponentLibrarySummaryPage,
} from "./component-library-contract";

export function ComponentCatalogControls({
  value,
  authors = [],
  onChange,
}: {
  value: ComponentCatalogQuery;
  authors: NonNullable<ComponentLibrarySummaryPage["authors"]> | undefined;
  onChange(value: ComponentCatalogQuery): void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const selected = useRef<{ id: string; name: string } | null>(null);
  const author = authors.find((item) => item.authorId === value.authorId);
  if (author) selected.current = { id: author.authorId, name: author.author };
  const authorName =
    selected.current?.id === value.authorId
      ? selected.current?.name
      : undefined;
  const [search, setSearch] = useState("");
  useDismissDetails(menu);
  const chooseAuthor = (authorId?: string) => {
    const { authorId: _previous, ...rest } = value;
    onChange(authorId ? { ...rest, authorId } : rest);
    menu.current?.removeAttribute("open");
    setSearch("");
  };
  return (
    <>
      <select
        aria-label="Component type"
        value={value.type}
        onChange={(event) =>
          onChange({
            ...value,
            type: event.target.value as ComponentCatalogQuery["type"],
          })
        }
      >
        <option value="all">All types</option>
        <option value="with-circuit">With circuit</option>
        <option value="symbol-only">Symbol only</option>
        <option value="needs-repair">Needs repair</option>
      </select>
      <details className="component-catalog-authors" ref={menu}>
        <summary aria-label="Component author">
          {value.authorId ? authorName || "Selected author" : "All authors"}
        </summary>
        <div
          className="component-catalog-author-options"
          role="group"
          aria-label="Authors"
        >
          <input
            aria-label="Search authors"
            placeholder="Find an author…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            aria-pressed={!value.authorId}
            onClick={() => chooseAuthor()}
          >
            All authors
          </button>
          {authors
            .filter((author) =>
              author.author.toLowerCase().includes(search.trim().toLowerCase()),
            )
            .map((author) => (
              <button
                type="button"
                key={author.authorId}
                aria-pressed={author.authorId === value.authorId}
                onClick={() => chooseAuthor(author.authorId)}
              >
                <span>{author.author || "Unknown author"}</span>
                <small>{author.count}</small>
              </button>
            ))}
        </div>
      </details>
      <select
        aria-label="Component order"
        value={value.order}
        onChange={(event) =>
          onChange({
            ...value,
            order: event.target.value as ComponentCatalogQuery["order"],
          })
        }
      >
        <option value="circuit-first">Circuit first</option>
        <option value="newest">Newest first</option>
        <option value="oldest">Oldest first</option>
      </select>
    </>
  );
}
