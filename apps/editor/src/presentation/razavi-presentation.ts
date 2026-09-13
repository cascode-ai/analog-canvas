import { executeTransaction, type SchematicEdit } from "@icm/edit-engine";
import {
  hasExplicitMosBulkRoute,
  mosBulkKind,
  mosBulkShouldBeVisible,
  resolveDetachedMosBulkDefault,
  resolveMosBulkConnection,
} from "@icm/derived";
import { replaceProjectDocument } from "../document/editor-session";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { builtInSymbols, createProjectSymbolResolver } from "@icm/symbols";

const DEFAULT_SYMBOL_VARIANTS: Readonly<Record<string, string>> = {
  nmos: "textbook-3terminal",
  pmos: "textbook-3terminal",
  "depletion-nmos": "textbook-3terminal",
  "depletion-pmos": "textbook-3terminal",
  ndmos: "standard-3terminal",
  pdmos: "standard-3terminal",
};

export function defaultRazaviSymbolVariantId(
  symbolId: string,
): string | undefined {
  return DEFAULT_SYMBOL_VARIANTS[symbolId];
}

/** Explicit body-bias is information, never an error. */
export function razaviHiddenBulkRisk(
  document: SchematicDocument,
  instanceId: string,
): SchematicDocument["nets"][number] | undefined {
  const resolution = resolveMosBulkConnection(document, instanceId);
  return resolution?.status === "explicit" &&
    mosBulkShouldBeVisible(document, instanceId)
    ? resolution.net
    : undefined;
}

/** One Edit-Engine operation owns configured cell-default materialization. */
export function razaviManualBulkConnectionEdits(
  document: SchematicDocument,
  instances: readonly SchematicDocument["instances"][number][],
): SchematicEdit[] {
  const instanceIds = instances
    .filter((instance) => {
      const resolution = resolveMosBulkConnection(document, instance);
      if (hasExplicitMosBulkRoute(document, instance.id)) {
        return instance.mosBulkBinding !== undefined;
      }
      const kind = mosBulkKind(instance);
      const configuredNetId =
        kind === "nmos"
          ? document.mosBulkDefaults?.nmosNetId
          : kind === "pmos"
            ? document.mosBulkDefaults?.pmosNetId
            : undefined;
      return Boolean(
        resolution &&
        ((!resolution.materialized && resolution.status === "cell-default") ||
          (resolution.materialized &&
            resolution.status === "explicit" &&
            configuredNetId &&
            (configuredNetId === resolution.net.id ||
              resolveDetachedMosBulkDefault(document, instance)?.id ===
                configuredNetId))),
      );
    })
    .map((instance) => instance.id);
  return instanceIds.length > 0
    ? [{ kind: "reconcile_mos_bulk", instanceIds }]
    : [];
}

/**
 * Materialize current bulk defaults at a Project entry boundary before the
 * editor history/recovery graph is installed.
 */
export function materializeRazaviProjectBulkConnections(
  project: CircuitProject,
): { project: CircuitProject; instanceCount: number } {
  let nextProject = structuredClone(project);
  let instanceCount = 0;
  for (const sourceDocument of [...nextProject.documents]) {
    const document = nextProject.documents.find(
      (candidate) => candidate.id === sourceDocument.id,
    )!;
    const edits = razaviManualBulkConnectionEdits(document, document.instances);
    if (edits.length === 0) continue;
    const affectedCount =
      edits[0]?.kind === "reconcile_mos_bulk"
        ? (edits[0].instanceIds?.length ?? sourceDocument.instances.length)
        : 0;
    const result = executeTransaction(
      document,
      {
        transactionId: `razavi-bulk-entry-${document.id}`,
        documentId: document.id,
        expectedRevision: document.revision,
        // This deterministic default transform executes before user
        // history is installed; it is not an Agent request.
        actor: { kind: "human", id: "razavi-bulk-entry" },
        edits,
      },
      {
        symbolResolver: createProjectSymbolResolver(
          nextProject,
          builtInSymbols,
        ),
      },
    );
    if (!result.ok) {
      throw new Error(
        `Cannot materialize Razavi bulk defaults for ${document.id}: ${result.error.message}`,
      );
    }
    nextProject = replaceProjectDocument(nextProject, result.document);
    instanceCount += affectedCount;
  }
  return { project: nextProject, instanceCount };
}

export function razaviBulkAnchorIsVisible(
  document: SchematicDocument,
  instanceId: string,
): boolean {
  return mosBulkShouldBeVisible(document, instanceId);
}

export function razaviMosPresentationEdits(
  document: SchematicDocument,
): SchematicEdit[] {
  return document.instances.flatMap((instance) => {
    const symbolVariantId = defaultRazaviSymbolVariantId(instance.symbolId);
    if (!symbolVariantId || instance.symbolVariantId === symbolVariantId) {
      return [];
    }
    return [
      {
        kind: "set_instance_symbol",
        instanceId: instance.id,
        symbolId: instance.symbolId,
        symbolVariantId,
      },
    ];
  });
}
