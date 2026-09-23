import { useMemo } from "react";

import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import {
  libraryProjectExamples,
  type LibraryProjectExample,
} from "../../examples/library-examples";

export function LocalExamplesCards({
  onOpenExample,
}: {
  onOpenExample(example: LibraryProjectExample): void;
}) {
  const previews = useMemo(
    () =>
      new Map(
        libraryProjectExamples.map((example) => {
          const topDocument = example.project.documents.find(
            (candidate) => candidate.id === example.project.topDocumentId,
          )!;
          return [
            example.id,
            renderDocumentSvg(
              topDocument,
              createProjectSymbolResolver(example.project, builtInSymbols),
            ),
          ];
        }),
      ),
    [],
  );

  return libraryProjectExamples.map((example) => (
    <button
      key={example.id}
      type="button"
      className="shapes-example-card"
      data-testid={`shapes-example-${example.id}`}
      aria-label={`Insert example ${example.name}`}
      title={`Insert ${example.name}`}
      onClick={() => onOpenExample(example)}
    >
      <span
        className="shapes-example-preview"
        // Server-free preview: our own renderer's escaped output.
        dangerouslySetInnerHTML={{ __html: previews.get(example.id) ?? "" }}
      />
      <span className="shapes-example-copy">
        <span className="shapes-example-kicker">Example</span>
        <span className="shapes-example-name">{example.name}</span>
      </span>
    </button>
  ));
}
