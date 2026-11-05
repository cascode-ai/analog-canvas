import type { HierarchyFrame, SchematicDocument } from "@icm/model";

export interface HierarchyToolbarProps {
  documents: readonly SchematicDocument[];
  activeDocumentId: string;
  topDocumentId: string;
  path: readonly HierarchyFrame[];
  canEnter: boolean;
  onTop(): void;
  onUp(): void;
  onOpenOccurrence(documentId: string, path: readonly HierarchyFrame[]): void;
  onEnter(): void;
  onManageCells(): void;
  onPlaceCell(): void;
  onShowHierarchy(): void;
  onNewChild(): void;
}

export function HierarchyToolbar(props: HierarchyToolbarProps) {
  const { documents, activeDocumentId, topDocumentId, path } = props;
  const rootId = path[0]?.parentDocumentId ?? activeDocumentId;
  const name = (id: string) =>
    documents.find((cell) => cell.id === id)?.name ?? id;
  return (
    <div
      className="toolbar-row hierarchy-toolbar"
      aria-label="Document hierarchy"
    >
      <div
        className="document-nav"
        aria-label="Cell navigation"
        data-testid="cell-navigation"
      >
        <button type="button" onClick={props.onShowHierarchy}>
          Hierarchy
        </button>
        <button
          type="button"
          onClick={props.onTop}
          disabled={activeDocumentId === topDocumentId && !path.length}
          title="Open the default Top"
        >
          Top
        </button>
        <button
          type="button"
          onClick={props.onUp}
          disabled={!path.length}
          title="Return to the parent instance (Shift+E)"
        >
          Up
        </button>
        <nav className="hierarchy-breadcrumb" aria-label="Instance path">
          <button
            type="button"
            onClick={() => props.onOpenOccurrence(rootId, [])}
            aria-current={!path.length ? "page" : undefined}
          >
            {rootId === topDocumentId ? "Top" : `${name(rootId)} (definition)`}
          </button>
          {path.map((frame, index) => {
            const instance = documents
              .find((cell) => cell.id === frame.parentDocumentId)
              ?.instances.find((item) => item.id === frame.instanceId);
            return (
              <span key={`${frame.parentDocumentId}/${frame.instanceId}`}>
                <span aria-hidden="true"> / </span>
                <button
                  type="button"
                  aria-current={index === path.length - 1 ? "page" : undefined}
                  onClick={() =>
                    props.onOpenOccurrence(
                      frame.childDocumentId,
                      path.slice(0, index + 1),
                    )
                  }
                >
                  {instance?.reference ?? frame.instanceId}:{" "}
                  {name(frame.childDocumentId)}
                </button>
              </span>
            );
          })}
        </nav>
        <button
          type="button"
          onClick={props.onEnter}
          disabled={!props.canEnter}
          title="Enter the selected Cell (E)"
        >
          Enter Cell
        </button>
        <div className="cell-command-row" data-testid="cell-command-menu">
          <button type="button" onClick={props.onNewChild}>
            New child
          </button>
          <button
            type="button"
            onClick={props.onPlaceCell}
            disabled={documents.length < 2}
          >
            Place Cell
          </button>
          <button type="button" onClick={props.onManageCells}>
            Cell properties
          </button>
        </div>
      </div>
    </div>
  );
}
