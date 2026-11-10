import type {
  AgentHostSemanticIntentRequest,
  AgentHostSemanticIntentResult,
} from "@icm/agent-adapter";
import {
  findHierarchyPath,
  resolveDocumentLogicalNets,
  type ObjectLocator,
  type ProjectConnectivityIndex,
} from "@icm/derived";
import type { CircuitProject, RouteEndpoint } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { hierarchyPathReaches } from "../document/editor-session";

export interface AgentSemanticIntentHandlerDependencies {
  project: CircuitProject;
  resolver: SymbolResolver;
  connectivityIndex: ProjectConnectivityIndex;
  navigateToLocator: (locator: ObjectLocator, statusMessage: string) => void;
  fitDocument: (documentId: string, statusMessage?: string) => void;
  clearFocus: () => void;
  highlightNet: (
    netId: string,
    documentId: string,
    endpoint?: RouteEndpoint,
  ) => void;
}

/** Validate Agent semantic requests, then delegate navigation to editor policy. */
export function createAgentSemanticIntentHandler({
  project,
  resolver,
  connectivityIndex,
  navigateToLocator,
  fitDocument,
  clearFocus,
  highlightNet,
}: AgentSemanticIntentHandlerDependencies) {
  return (
    request: AgentHostSemanticIntentRequest,
  ): AgentHostSemanticIntentResult => {
    const intent = request.intent;
    const targetDocument = project.documents.find(
      (candidate) => candidate.id === request.documentId,
    );
    if (!targetDocument) {
      return {
        ok: false,
        code: "DOCUMENT_NOT_FOUND",
        message: `Document ${request.documentId} is not present in this Project`,
      };
    }
    const hierarchyPath = () =>
      findHierarchyPath(
        connectivityIndex,
        project.topDocumentId,
        targetDocument.id,
      ) ?? [];
    const activateDocument = (message: string): void => {
      navigateToLocator(
        {
          documentId: targetDocument.id,
          hierarchyPath: hierarchyPath(),
          kind: "document",
          objectId: targetDocument.id,
        },
        message,
      );
    };
    const fail = (
      code: string,
      message: string,
    ): AgentHostSemanticIntentResult => ({ ok: false, code, message });

    switch (intent.kind) {
      case "activate-document":
        activateDocument(`Agent activated Cell ${targetDocument.name}`);
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [],
        };
      case "fit-document":
        fitDocument(targetDocument.id, `Agent fit Cell ${targetDocument.name}`);
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [],
        };
      case "clear-focus":
        clearFocus();
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [],
        };
      case "highlight-net": {
        const net = targetDocument.nets.find(
          (candidate) => candidate.id === intent.netId,
        );
        if (!net) {
          return fail(
            "OBJECT_NOT_FOUND",
            `Net ${intent.netId} is not present in Document ${targetDocument.id}`,
          );
        }
        activateDocument(
          `Agent highlighted Net ${
            resolveDocumentLogicalNets(targetDocument).byBaseNetId.get(net.id)
              ?.name ?? net.id
          }`,
        );
        highlightNet(net.id, targetDocument.id, intent.endpoint);
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [net.id],
          netId: net.id,
        };
      }
      case "select": {
        const { locator } = intent;
        if (locator.documentId !== targetDocument.id) {
          return fail(
            "DOCUMENT_MISMATCH",
            "A semantic locator must address the transaction Document",
          );
        }
        if (
          !hierarchyPathReaches(
            project,
            targetDocument.id,
            locator.hierarchyPath,
          )
        ) {
          return fail(
            "LOCATOR_MISMATCH",
            "The locator hierarchy path does not reach this Cell",
          );
        }
        const exists = (() => {
          switch (locator.kind) {
            case "instance":
              return targetDocument.instances.some(
                (item) => item.id === locator.objectId,
              );
            case "net":
              return targetDocument.nets.some(
                (item) => item.id === locator.objectId,
              );
            case "route":
              return targetDocument.routes.some(
                (item) => item.id === locator.objectId,
              );
            case "junction":
              return targetDocument.junctions.some(
                (item) => item.id === locator.objectId,
              );
            case "annotation":
              return targetDocument.annotations.some(
                (item) => item.id === locator.objectId,
              );
            case "no-connect":
              return targetDocument.noConnects.some(
                (item) => item.id === locator.objectId,
              );
            case "terminal": {
              const endpoint = locator.endpoint;
              if (endpoint?.kind !== "terminal") return false;
              const instance = targetDocument.instances.find(
                (item) => item.id === endpoint.instanceId,
              );
              const resolved = instance
                ? resolver.resolve(instance.symbolId, instance.symbolVariantId)
                : null;
              return (
                resolved?.definition.pins.some(
                  (pin) => pin.name === endpoint.pinName,
                ) ?? false
              );
            }
          }
        })();
        if (!exists) {
          return fail(
            "OBJECT_NOT_FOUND",
            `Locator ${locator.kind} ${locator.objectId} is not present in Document ${targetDocument.id}`,
          );
        }
        const objectLocator: ObjectLocator = {
          documentId: locator.documentId,
          hierarchyPath: locator.hierarchyPath,
          kind: locator.kind,
          objectId: locator.objectId,
          ...(locator.endpoint ? { endpoint: locator.endpoint } : {}),
        };
        navigateToLocator(
          objectLocator,
          `Agent selected ${locator.kind} ${locator.objectId}`,
        );
        return {
          ok: true,
          kind: intent.kind,
          documentId: targetDocument.id,
          objectIds: [locator.objectId],
          ...(locator.kind === "net" ? { netId: locator.objectId } : {}),
        };
      }
    }
  };
}
