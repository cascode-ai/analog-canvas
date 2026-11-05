import type { SchematicDocument } from "@icm/model";

export interface HierarchyToolbarProps {
  documents: readonly SchematicDocument[];
  activeDocumentId: string;
  topDocumentId: string;
  navigationDepth: number;
  canEnter: boolean;
  onTop: () => void;
  onSelectDocument: (documentId: string) => void;
  onEnter: () => void;
  onManageCells: () => void;
  onPlaceCell: () => void;
}

export function HierarchyToolbar({
  documents,
  activeDocumentId,
  topDocumentId,
  navigationDepth,
  canEnter,
  onTop,
  onSelectDocument,
  onEnter,
  onManageCells,
  onPlaceCell,
}: HierarchyToolbarProps) {
  if (documents.length <= 1 && navigationDepth === 0 && !canEnter) return null;

  return (
    <div className="toolbar-row" aria-label="Document hierarchy">
      <div
        className="document-nav"
        aria-label="Cell navigation"
        data-testid="cell-navigation"
      >
        <button
          type="button"
          onClick={onTop}
          disabled={activeDocumentId === topDocumentId}
          title="Return to the top Cell"
        >
          Top
        </button>
        <select
          aria-label="Cells"
          data-testid="document-selector"
          value={activeDocumentId}
          onChange={(event) => onSelectDocument(event.currentTarget.value)}
        >
          {documents.map((document) => (
            <option key={document.id} value={document.id}>
              {document.id === topDocumentId
                ? `${document.name} (top)`
                : document.name}
            </option>
          ))}
        </select>
        <button
          type="button"
          onClick={onEnter}
          disabled={!canEnter}
          title="Enter the selected Cell (E)"
        >
          Enter Cell
        </button>
        <div className="cell-command-row" data-testid="cell-command-menu">
          <button type="button" onClick={onManageCells}>
            Manage Cells…
          </button>
          <button
            type="button"
            onClick={onPlaceCell}
            disabled={documents.length < 2}
          >
            Place Cell
          </button>
        </div>
      </div>
    </div>
  );
}
