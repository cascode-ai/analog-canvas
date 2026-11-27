import { useState } from "react";
import {
  endpointKey,
  resolveDocumentLogicalNets,
  type DocumentConnectivityIndex,
} from "@icm/derived";
import {
  selectWireMember,
  planSetNoConnect,
  type WireSource,
  type SchematicEdit,
} from "@icm/edit-engine";
import type { SchematicDocument, RouteEndpoint } from "@icm/model";
import type { SymbolResolver } from "@icm/symbols";
import { endpointNetId } from "../wiring/route-interaction-geometry";

/** Resolve current member identities for the existing selection and trace surfaces. */
export function useSignalMemberInspection({
  model,
  actions,
}: {
  model: {
    document: SchematicDocument;
    documentConnectivity: DocumentConnectivityIndex | undefined;
    resolver: SymbolResolver;
    selectedEndpoint: WireSource | null;
    visibleEndpoints: readonly WireSource[];
    selectedRoute: SchematicDocument["routes"][number] | undefined;
  };
  actions: {
    setSelectedEndpoint(source: WireSource | null): void;
    highlightNet(
      netId: string,
      documentId: string,
      endpoint: RouteEndpoint,
    ): void;
    transact(edits: SchematicEdit[]): { ok: boolean };
    setStatus(message: string): void;
  };
}) {
  const {
    document,
    documentConnectivity,
    resolver,
    selectedEndpoint,
    visibleEndpoints,
    selectedRoute,
  } = model;
  const { setSelectedEndpoint, highlightNet, transact, setStatus } = actions;
  const [inspectedRouteMember, setInspectedRouteMember] = useState<{
    routeId: string;
    memberId: string;
  } | null>(null);
  const selectedBusSource =
    selectedEndpoint &&
    visibleEndpoints.find(
      (source) =>
        endpointKey({ ...source.endpoint, memberId: undefined }) ===
        endpointKey({ ...selectedEndpoint.endpoint, memberId: undefined }),
    );
  const logical =
    selectedBusSource?.members || selectedRoute?.members
      ? (documentConnectivity?.logicalNetResolution ??
        resolveDocumentLogicalNets(document))
      : undefined;
  const endpointSignalInspection = selectedBusSource?.members
    ? {
        members: selectedBusSource.members.map((member) => {
          const endpoint = {
            ...selectedBusSource.endpoint,
            memberId: member.id,
          };
          const netId = endpointNetId(document, endpoint);
          return {
            id: member.id,
            name:
              (netId ? logical?.byBaseNetId.get(netId)?.name : undefined) ??
              member.name ??
              member.id,
            hasNet: netId !== null,
            noConnect: document.noConnects.some(
              (mark) => endpointKey(mark.endpoint) === endpointKey(endpoint),
            ),
          };
        }),
        selectedId: selectedEndpoint?.endpoint.memberId,
        onSelect: (id: string) =>
          setSelectedEndpoint(selectWireMember(selectedBusSource, id)),
        onTrace: (id: string) => {
          const endpoint = { ...selectedBusSource.endpoint, memberId: id };
          const netId = endpointNetId(document, endpoint);
          if (netId !== null) highlightNet(netId, document.id, endpoint);
        },
        ...(selectedBusSource.endpoint.kind === "terminal"
          ? {
              onMark: (ids: readonly string[], marked: boolean) => {
                if (selectedBusSource.endpoint.kind !== "terminal") return;
                const endpoint = selectedBusSource.endpoint;
                try {
                  const edits = planSetNoConnect(
                    document,
                    resolver,
                    ids.map((memberId) => ({ ...endpoint, memberId })),
                    marked,
                  );
                  if (edits.length && transact(edits).ok)
                    setStatus(
                      `${marked ? "Marked" : "Cleared"} ${ids.length} No Connect members`,
                    );
                } catch (error) {
                  setStatus(
                    error instanceof Error
                      ? error.message
                      : "Cannot update No Connect",
                  );
                }
              },
            }
          : {}),
      }
    : undefined;
  const routeSignalInspection = selectedRoute?.members
    ? {
        members: selectedRoute.members.map((member) => ({
          id: member.id,
          name: logical?.byBaseNetId.get(member.netId)?.name ?? member.id,
          hasNet: true,
          noConnect: false,
        })),
        selectedId:
          inspectedRouteMember?.routeId === selectedRoute.id
            ? inspectedRouteMember.memberId
            : undefined,
        onSelect: (memberId: string) =>
          setInspectedRouteMember({ routeId: selectedRoute.id, memberId }),
        onTrace: (id: string) => {
          const member = selectedRoute.members!.find((item) => item.id === id)!;
          highlightNet(member.netId, document.id, {
            ...selectedRoute.start,
            memberId: member.startMemberId,
          });
        },
      }
    : undefined;
  return { endpointSignalInspection, routeSignalInspection };
}
