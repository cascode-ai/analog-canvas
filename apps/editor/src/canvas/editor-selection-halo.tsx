import { useMemo } from "react";

import type { resolveDocumentStyleProfile } from "@icm/derived";
import type { SchematicDocument } from "@icm/model";
import { renderInstanceOutlineGeometry } from "@icm/render-svg";
import type { SymbolResolver } from "@icm/symbols";

type StyleProfile = ReturnType<typeof resolveDocumentStyleProfile>;

export interface EditorSelectionHaloProps {
  document: SchematicDocument;
  resolver: SymbolResolver;
  styleProfile: StyleProfile;
  selectedInstanceIds: readonly string[];
  /**
   * Everything a drag on the selection would carry. Non-instance members are
   * ignored here; routes and junctions mark themselves in their own layers.
   */
  wouldMoveIds: ReadonlySet<string>;
}

/**
 * A selected component is marked by tracing its own artwork, never by boxing
 * it. The halo is a second copy of the symbol geometry painted underneath the
 * scene with a thick accent stroke, so every line of the component reads as
 * lit while the component itself is drawn on top exactly as before —
 * including a per-instance colour override, which a recolour would have
 * destroyed and this leaves untouched.
 *
 * A box would also claim an extent the drawing does not occupy: an
 * axis-aligned box around a rotated device, or around a symbol that is mostly
 * whitespace, is far larger than the lines it contains, and in a dense
 * schematic it overlaps neighbours that are not selected.
 */
export function EditorSelectionHalo({
  document,
  resolver,
  styleProfile,
  selectedInstanceIds,
  wouldMoveIds,
}: EditorSelectionHaloProps) {
  const selected = useMemo(
    () =>
      renderInstanceOutlineGeometry(
        document,
        resolver,
        selectedInstanceIds,
        styleProfile,
      ),
    [document, resolver, selectedInstanceIds, styleProfile],
  );
  // Painting a selected instance twice would double the stroke alpha and read
  // as a third state, so the trailing body covers only the rest.
  const wouldMove = useMemo(
    () =>
      renderInstanceOutlineGeometry(
        document,
        resolver,
        [...wouldMoveIds].filter((id) => !selectedInstanceIds.includes(id)),
        styleProfile,
      ),
    [document, resolver, selectedInstanceIds, styleProfile, wouldMoveIds],
  );
  if (selected === "" && wouldMove === "") return null;
  return (
    <g
      data-layer="selection-halo"
      className="selection-halo"
      aria-hidden="true"
    >
      {wouldMove === "" ? null : (
        <g
          data-testid="selection-halo-would-move"
          className="selection-halo-body selection-halo-body--would-move"
          dangerouslySetInnerHTML={{ __html: wouldMove }}
        />
      )}
      {selected === "" ? null : (
        <g
          data-testid="selection-halo-selected"
          className="selection-halo-body selection-halo-body--selected"
          dangerouslySetInnerHTML={{ __html: selected }}
        />
      )}
    </g>
  );
}
