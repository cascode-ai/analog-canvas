import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

import { libraryProjectExamples } from "../examples/library-examples";

export interface BundledGalleryTile {
  id: string;
  name: string;
  description: string;
  svg: string;
}

/**
 * Render the starter wall only after the community feed has settled empty.
 * Keeping this work in its own dynamic module means a populated Gallery never
 * downloads the renderer, symbol catalogue, or bundled Project fixtures.
 */
export function loadBundledGalleryTiles(): BundledGalleryTile[] {
  return libraryProjectExamples.map((example) => {
    const topDocument = example.project.documents.find(
      (document) => document.id === example.project.topDocumentId,
    )!;
    return {
      id: example.id,
      name: example.name,
      description: example.description,
      // A hierarchical example draws its child Cell as a block whose Symbol
      // is derived from that example's own Project, so the built-in
      // catalogue alone cannot resolve it.
      svg: renderDocumentSvg(
        topDocument,
        createProjectSymbolResolver(example.project, builtInSymbols),
      ),
    };
  });
}
