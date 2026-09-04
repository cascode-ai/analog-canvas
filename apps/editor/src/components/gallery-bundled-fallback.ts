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
      // A Cell instance draws with artwork derived from the Project, so the
      // tile needs the same Project-aware resolver the canvas uses.
      svg: renderDocumentSvg(
        topDocument,
        createProjectSymbolResolver(example.project, builtInSymbols),
      ),
    };
  });
}
