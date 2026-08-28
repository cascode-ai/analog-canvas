import { lazy, type ComponentType } from "react";

import { createChunkLoadFallback } from "../components/chunk-load-fallback";

/**
 * A rejected dynamic import would otherwise re-throw through Suspense into
 * the root error boundary and unmount the whole editor — the classic failure
 * is a tab that survived a redeploy asking for chunk names that no longer
 * exist. Resolving to a scoped fallback keeps the schematic alive and offers
 * the refresh (with automatic restore) that actually fixes it.
 */
function lazyChunk<Component extends ComponentType<any>>(
  variant: "dialog" | "inline",
  load: () => Promise<{ default: Component }>,
) {
  return lazy(() =>
    load().catch((error: unknown) => {
      console.error("Editor dialog chunk failed to load:", error);
      // The fallback ignores unknown props, so standing in for the real
      // component is safe even though the prop types differ.
      return {
        default: createChunkLoadFallback(variant, error),
      } as unknown as { default: Component };
    }),
  );
}

export const LazyCellManagerDialog = lazyChunk("dialog", () =>
  import("../features/hierarchy/cell-manager-dialog").then((module) => ({
    default: module.CellManagerDialog,
  })),
);

export const LazyNetlistPreflightDialog = lazyChunk("dialog", () =>
  import("../features/netlist-export/netlist-preflight-dialog").then(
    (module) => ({ default: module.NetlistPreflightDialog }),
  ),
);

export const LazyPublishGalleryDialog = lazyChunk("dialog", () =>
  import("../features/editor-shell/publish-gallery-dialog").then((module) => ({
    default: module.PublishGalleryDialog,
  })),
);

export const LazyVersionHistoryDialog = lazyChunk("dialog", () =>
  import("../components/version-history-dialog").then((module) => ({
    default: module.VersionHistoryDialog,
  })),
);

export const LazyEditorHelpDialog = lazyChunk("dialog", () =>
  import("../components/editor-help-dialog").then((module) => ({
    default: module.EditorHelpDialog,
  })),
);

export const LazyReplaceGuardDialog = lazyChunk("dialog", () =>
  import("../components/replace-guard-dialog").then((module) => ({
    default: module.ReplaceGuardDialog,
  })),
);

export const LazyRecentRecoveryDialog = lazyChunk("dialog", () =>
  import("../components/recent-recovery-dialog").then((module) => ({
    default: module.RecentRecoveryDialog,
  })),
);

export const LazyProjectSearchDialog = lazyChunk("dialog", () =>
  import("../features/search/project-search-dialog").then((module) => ({
    default: module.ProjectSearchDialog,
  })),
);

export const LazyInstanceTableDialog = lazyChunk("dialog", () =>
  import("../features/properties/instance-table-dialog").then((module) => ({
    default: module.InstanceTableDialog,
  })),
);

export const LazyInsertComponentDialog = lazyChunk("dialog", () =>
  import("../features/component-insert/insert-component-dialog").then(
    (module) => ({ default: module.InsertComponentDialog }),
  ),
);

export const LazyConnectAgentPanel = lazyChunk("dialog", () =>
  import("../agent/connect-agent-panel").then((module) => ({
    default: module.ConnectAgentPanel,
  })),
);

export const LazyAgentPropertiesSection = lazyChunk("inline", () =>
  import("../agent/connect-agent-panel").then((module) => ({
    default: module.AgentPropertiesSection,
  })),
);
