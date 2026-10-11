import { lazy, type ComponentProps, type ComponentType } from "react";

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

export const LazyCellInterfaceConfirmationDialog = lazyChunk("dialog", () =>
  import("../features/hierarchy/cell-interface-confirmation").then(
    (module) => ({
      default: module.CellInterfaceConfirmationDialog,
    }),
  ),
);

export const LazyProjectCodePanel = lazyChunk("inline", () =>
  import("../features/project-code/project-code-panel").then((module) => ({
    default: module.ProjectCodePanel,
  })),
);

export const LazySpiceSimulationSurface = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../features/simulation/spice-simulation-surface").SpiceSimulationSurface
      >,
    ) => null
  : lazyChunk("inline", () =>
      import("../features/simulation/spice-simulation-surface").then(
        (module) => ({
          default: module.SpiceSimulationSurface,
        }),
      ),
    );

export const LazyNetlistPreflightDialog = lazyChunk("dialog", () =>
  import("../features/netlist-export/netlist-preflight-dialog").then(
    (module) => ({ default: module.NetlistPreflightDialog }),
  ),
);

export const LazyPublishGalleryDialog = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../features/editor-shell/publish-gallery-dialog").PublishGalleryDialog
      >,
    ) => null
  : lazyChunk("dialog", () =>
      import("../features/editor-shell/publish-gallery-dialog").then(
        (module) => ({
          default: module.PublishGalleryDialog,
        }),
      ),
    );

export const LazyVersionHistoryDialog = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../components/version-history-dialog").VersionHistoryDialog
      >,
    ) => null
  : lazyChunk("dialog", () =>
      import("../components/version-history-dialog").then((module) => ({
        default: module.VersionHistoryDialog,
      })),
    );

export const LazyProjectInfoDialog = lazyChunk("dialog", () =>
  import("../features/editor-shell/project-info-dialog").then((module) => ({
    default: module.ProjectInfoDialog,
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

export const LazyInsertComponentDialog = lazyChunk("dialog", () =>
  import("../features/component-insert/insert-component-dialog").then(
    (module) => ({ default: module.InsertComponentDialog }),
  ),
);

export const LazyConnectAgentPanel = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../agent/connect-agent-panel").ConnectAgentPanel
      >,
    ) => null
  : lazyChunk("dialog", () =>
      import("../agent/connect-agent-panel").then((module) => ({
        default: module.ConnectAgentPanel,
      })),
    );

// Properties sections load with the first selection that shows them. A tab
// that outlived a deploy found the chunk gone, and the whole editor fell to
// its crash screen when a paste selected the new part.
export const LazyComponentPropertyCodeEditor = lazyChunk("inline", () =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.ComponentPropertyCodeEditor,
  })),
);

export const LazyAnnotationColorProperties = lazyChunk("inline", () =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.AnnotationColorProperties,
  })),
);

export const LazyDraftingPropertiesPanel = lazyChunk("inline", () =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.DraftingPropertiesPanel,
  })),
);

export const LazyDocumentSettingsSection = lazyChunk("inline", () =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.DocumentSettingsSection,
  })),
);

export const LazyExamplesPanel = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../features/editor-shell/examples-panel").ExamplesPanel
      >,
    ) => null
  : lazyChunk("inline", () =>
      import("../features/editor-shell/examples-panel").then((module) => ({
        default: module.ExamplesPanel,
      })),
    );

export const LazyComponentDefinitionEditor = lazyChunk(
  "dialog",
  () => import("../features/user-components/component-definition-editor"),
);

export const LazyAgentPropertiesSection = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../agent/connect-agent-panel").AgentPropertiesSection
      >,
    ) => null
  : lazyChunk("inline", () =>
      import("../agent/connect-agent-panel").then((module) => ({
        default: module.AgentPropertiesSection,
      })),
    );

/** Community polling is absent when no community surface is mounted. */
export const LazyGalleryPublishedNotice = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../features/editor-shell/gallery-published-notice").GalleryPublishedNotice
      >,
    ) => null
  : lazyChunk("inline", () =>
      import("../features/editor-shell/gallery-published-notice").then(
        (module) => ({
          default: module.GalleryPublishedNotice,
        }),
      ),
    );

export const LazyGalleryTopologyTaskNotice = import.meta.env?.ICM_DESKTOP
  ? (
      _props: ComponentProps<
        typeof import("../features/editor-shell/gallery-topology-task-notice").GalleryTopologyTaskNotice
      >,
    ) => null
  : lazyChunk("inline", () =>
      import("../features/editor-shell/gallery-topology-task-notice").then(
        (module) => ({
          default: module.GalleryTopologyTaskNotice,
        }),
      ),
    );
