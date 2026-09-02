import { renderDocumentSvg } from "@icm/render-svg";
import { builtInSymbols, InMemorySymbolResolver } from "@icm/symbols";

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
  const resolver = new InMemorySymbolResolver(builtInSymbols);
  return libraryProjectExamples.map((example) => {
    const topDocument = example.project.documents.find(
      (document) => document.id === example.project.topDocumentId,
    )!;
    return {
      id: example.id,
      name: example.name,
      description: example.description,
      svg: renderDocumentSvg(topDocument, resolver),
    };
  });
}
