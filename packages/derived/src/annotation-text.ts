import {
  boundAnnotationName,
  flattenRichText,
  labelTextDocument,
  richTextPresentsIdentifier,
  formatSignalMembers,
  routeElectricalConnections,
} from "@icm/model";
import type {
  Annotation,
  RichTextDocument,
  SchematicDocument,
} from "@icm/model";

import {
  displayableInstanceParameter,
  displayableInstanceValue,
} from "./instance-value.js";
import {
  resolveDocumentLogicalNets,
  type ResolvedDocumentLogicalNets,
} from "./logical-net.js";
import type { SymbolResolver } from "@icm/symbols";
import type { RouteEndpoint } from "@icm/model";

function selectedMemberName(
  document: SchematicDocument,
  endpoint: RouteEndpoint,
  netId: string,
  resolver?: SymbolResolver,
  fallback = true,
): string {
  const terminalName = (selected: RouteEndpoint): string | undefined => {
    if (selected.kind !== "terminal" || !selected.memberId) return undefined;
    const local = document.netlist?.terminals.find(
      (terminal) =>
        selected.pinName === "P" &&
        terminal.interfaceInstanceIds.includes(selected.instanceId),
    );
    const localName = local?.signal?.members.find(
      (member) => member.id === selected.memberId,
    )?.name;
    if (localName) return localName;
    const instance = document.instances.find(
      (item) => item.id === selected.instanceId,
    );
    return (
      instance &&
      resolver
        ?.resolve(instance.symbolId, instance.symbolVariantId)
        ?.definition.pins.find((pin) => pin.name === selected.pinName)
        ?.signalMembers?.find((member) => member.id === selected.memberId)?.name
    );
  };
  const direct = terminalName(endpoint);
  if (direct) return direct;
  const names = [
    ...new Set(
      document.nets
        .find((net) => net.id === netId)
        ?.terminals.flatMap((terminal) => {
          const name = terminalName({ kind: "terminal", ...terminal });
          return name ? [name] : [];
        }) ?? [],
    ),
  ].sort();
  if (names.length) return names.join(" / ");
  if (fallback && endpoint.kind === "junction") {
    const index = document.junctions
      .find((item) => item.id === endpoint.junctionId)
      ?.members?.findIndex((member) => member.id === endpoint.memberId);
    if (index !== undefined && index >= 0) return `Member ${index + 1}`;
  }
  return "";
}

const EMPTY_TEXT: RichTextDocument = { runs: [{ kind: "line-break" }] };

/**
 * Resolve one Annotation's text from its bound fact. A captured selector look
 * can survive an open copied boundary until a live member name is available.
 */
export function resolveAnnotationText(
  document: SchematicDocument,
  annotation: Annotation,
  logicalNets?: ResolvedDocumentLogicalNets,
  resolver?: SymbolResolver,
): RichTextDocument {
  const semanticLabel = (name: string): RichTextDocument =>
    labelTextDocument(name, document.presentation);
  const binding = annotation.binding;
  if (!binding) return annotation.content ?? EMPTY_TEXT;
  if (
    annotation.formatOverride &&
    (binding.kind === "instance-reference" ||
      (binding.kind === "net-name" &&
        !binding.memberEndpoint &&
        !binding.memberEndpoints) ||
      binding.kind === "cell-terminal-name")
  ) {
    return annotation.formatOverride;
  }
  switch (binding.kind) {
    case "instance-reference": {
      const instance = document.instances.find(
        (candidate) => candidate.id === binding.instanceId,
      );
      return semanticLabel(instance?.reference ?? "");
    }
    case "instance-value": {
      const instance = document.instances.find(
        (candidate) => candidate.id === binding.instanceId,
      );
      if (!instance) return EMPTY_TEXT;
      const display = binding.parameter
        ? displayableInstanceParameter(
            instance,
            binding.parameter,
            binding.showValue === false ? { showValue: false } : {},
          )
        : displayableInstanceValue(instance);
      if (display.kind !== "displayable") return EMPTY_TEXT;
      // A value's live parameter remains authoritative. A stale authored look
      // must never display an old electrical value after an edit/import.
      return annotation.formatOverride &&
        flattenRichText(annotation.formatOverride) ===
          flattenRichText(display.content)
        ? annotation.formatOverride
        : display.content;
    }
    case "net-name": {
      if (binding.memberEndpoints) {
        const route =
          annotation.anchor.kind === "route"
            ? document.routes.find(
                (item) =>
                  annotation.anchor.kind === "route" &&
                  item.id === annotation.anchor.routeId,
              )
            : undefined;
        const edges = route ? routeElectricalConnections(route) : [];
        const logical = logicalNets ?? resolveDocumentLogicalNets(document);
        const names = binding.memberEndpoints.map((endpoint, index) => {
          const netId = edges[index]?.netId ?? binding.netId;
          return (
            logical.byBaseNetId.get(netId)?.name ??
            selectedMemberName(document, endpoint, netId, resolver, false)
          );
        });
        // A copied selector can outlive its naming owner. Its captured look is
        // only a display fallback; any live member name takes precedence.
        if (annotation.formatOverride && names.every((name) => !name))
          return annotation.formatOverride;
        const name = formatSignalMembers(
          binding.memberEndpoints.map((endpoint, index) => {
            const netId = edges[index]?.netId ?? binding.netId;
            return (
              logical.byBaseNetId.get(netId)?.name ??
              selectedMemberName(document, endpoint, netId, resolver)
            );
          }),
        );
        return annotation.formatOverride &&
          richTextPresentsIdentifier(annotation.formatOverride, name)
          ? annotation.formatOverride
          : semanticLabel(name);
      }
      const ownerClaim = document.connectivityEvidence.find(
        (evidence) =>
          evidence.kind === "name-claim" &&
          evidence.netId === binding.netId &&
          ((evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === annotation.id) ||
            (annotation.anchor.kind === "object" &&
              evidence.owner.kind === "power-marker" &&
              evidence.owner.objectId === annotation.anchor.objectId)),
      );
      const logicalName = (
        logicalNets ?? resolveDocumentLogicalNets(document)
      ).byBaseNetId.get(binding.netId)?.name;
      const ownerClaimName =
        ownerClaim?.kind === "name-claim" ? ownerClaim.name : undefined;
      if (
        annotation.formatOverride &&
        binding.memberEndpoint &&
        !ownerClaimName &&
        !logicalName &&
        !selectedMemberName(
          document,
          binding.memberEndpoint,
          binding.netId,
          resolver,
          false,
        )
      )
        return annotation.formatOverride;
      const name =
        ownerClaimName ??
        logicalName ??
        (binding.memberEndpoint
          ? selectedMemberName(
              document,
              binding.memberEndpoint,
              binding.netId,
              resolver,
            )
          : "");
      return annotation.formatOverride &&
        richTextPresentsIdentifier(annotation.formatOverride, name)
        ? annotation.formatOverride
        : semanticLabel(name);
    }
    case "cell-terminal-name": {
      const terminal = document.netlist?.terminals.find(
        (candidate) => candidate.id === binding.terminalId,
      );
      return semanticLabel(terminal?.name ?? "");
    }
  }
}

/** Electrical names must never be inferred from a lossy rendered string. */
export function resolveAnnotationName(
  document: SchematicDocument,
  annotation: Annotation,
  logicalNets?: ResolvedDocumentLogicalNets,
): string {
  const name = boundAnnotationName(document, annotation);
  if (annotation.binding?.kind === "net-name")
    return (
      name ||
      (logicalNets ?? resolveDocumentLogicalNets(document)).byBaseNetId.get(
        annotation.binding.netId,
      )?.name ||
      ""
    );
  // A Net label showing a display alias keeps the name its claim gives the
  // Net (#1880).
  const claim =
    !annotation.binding && annotation.kind === "net-label"
      ? document.connectivityEvidence.find(
          (evidence) =>
            evidence.kind === "name-claim" &&
            evidence.owner.kind === "net-label" &&
            evidence.owner.annotationId === annotation.id,
        )
      : undefined;
  if (claim?.kind === "name-claim") return claim.name;
  return (
    name ??
    flattenRichText(resolveAnnotationText(document, annotation, logicalNets))
  );
}
