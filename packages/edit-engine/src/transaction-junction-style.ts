import { writableDraftRow } from "./local-transaction-draft.js";
import { routeEndpoints, type SchematicDocument } from "@icm/model";
import {
  carriedContactJunctionIds,
  contactRequiresJunctionDot,
  deriveDocumentContactEvidence,
  endpointKey,
  junctionForContact,
  resolveEndpointConnection,
  sameDocumentStyle,
} from "@icm/derived";
import type { SymbolResolver } from "@icm/symbols";
import { uniquePhysicalContactId } from "./transaction-connectivity.js";
import type { SchematicEdit } from "./edit-schema.js";
import type { EditMutationOutcome, RejectEdit } from "./transaction-domain.js";

export function applyJunctionStyleOverrideEdit(
  edit: Extract<SchematicEdit, { kind: "set_junction_style_override" }>,
  context: {
    draft: SchematicDocument;
    resolver: SymbolResolver | undefined;
    changedObjectIds: Set<string>;
    reject: RejectEdit;
  },
): EditMutationOutcome {
  const { draft, changedObjectIds, reject } = context;
  const target = edit.target;
  let junction =
    target.kind === "junction"
      ? draft.junctions.find((j) => j.id === target.junctionId)
      : undefined;
  if (target.kind === "terminal") {
    if (!context.resolver)
      return {
        ok: false,
        rejection: reject(
          "EDIT_CONTEXT_REQUIRED",
          "Junction color at a terminal requires a Symbol Resolver",
        ),
      };
    const contact = deriveDocumentContactEvidence(
      draft,
      context.resolver,
    ).byEndpointKey.get(endpointKey(target));
    if (!contact || !contactRequiresJunctionDot(contact))
      return {
        ok: false,
        rejection: reject(
          "EDIT_PRECONDITION",
          "The terminal has no visible junction dot",
        ),
      };
    junction = junctionForContact(
      contact,
      new Map(draft.junctions.map((j) => [j.id, j])),
    );
    if (!junction && edit.styleOverride?.color) {
      const connection = resolveEndpointConnection(
        draft,
        context.resolver,
        target,
      );
      if (!connection)
        return {
          ok: false,
          rejection: reject(
            "EDIT_PRECONDITION",
            "The contact has no grid landing",
          ),
        };
      const objects = contact.incidents.map((incident) =>
        incident.kind === "route"
          ? draft.routes.find((route) => route.id === incident.objectId)
          : draft.instances.find(
              (instance) => instance.id === incident.objectId,
            ),
      );
      const documentStyle = objects[0]?.documentStyle;
      const sharedStyle =
        documentStyle &&
        objects.every((object) =>
          sameDocumentStyle(object?.documentStyle, documentStyle),
        );
      junction = {
        id: uniquePhysicalContactId(draft, "junction", `color:${contact.id}`),
        netId: contact.netId,
        position: { ...connection.gridLanding },
        contactAnchor: {
          instanceId: target.instanceId,
          pinName: target.pinName,
        },
        role: "style-anchor",
        ...(sharedStyle
          ? { documentStyle: structuredClone(documentStyle) }
          : {}),
      };
      draft.junctions.push(junction);
    }
  }
  if (!junction)
    return {
      ok: false,
      rejection: reject("OBJECT_NOT_FOUND", "Junction does not exist"),
    };
  const color = edit.styleOverride?.color;
  if (junction.styleOverride?.color === color)
    return {
      ok: false,
      rejection: reject(
        "EDIT_PRECONDITION",
        "Junction style override edit does not change the junction",
      ),
    };
  if (color) junction.styleOverride = { color };
  else {
    delete junction.styleOverride;
    if (junction.role === "style-anchor") {
      junction.role = "branch";
      const referenced =
        draft.routes.some((route) =>
          routeEndpoints(route).some(
            (e) => e.kind === "junction" && e.junctionId === junction.id,
          ),
        ) ||
        draft.annotations.some(
          (a) =>
            a.anchor.kind === "object" && a.anchor.objectId === junction.id,
        ) ||
        [...draft.layoutGroups, ...draft.constraints].some((owner) =>
          owner.objectIds.includes(junction.id),
        );
      if (!referenced)
        draft.junctions = draft.junctions.filter((j) => j.id !== junction.id);
    }
  }
  changedObjectIds.add(junction.id);
  return { ok: true, connectivityChanged: false };
}

/** Follow a materialized dot only while all of its pins keep one contact. */
export function followStyledContactJunctions(
  before: SchematicDocument,
  draft: SchematicDocument,
  resolver: SymbolResolver,
  instanceIds: ReadonlySet<string>,
  movedJunctionIds: Set<string>,
  changedObjectIds: Set<string>,
): void {
  const ids = carriedContactJunctionIds(before, resolver, instanceIds);
  if (
    !ids.length &&
    !draft.junctions.some((junction) => junction.contactAnchor)
  )
    return;
  const evidence = deriveDocumentContactEvidence(before, resolver);
  for (const id of ids) {
    const contact = evidence.byEndpointKey.get(
      endpointKey({ kind: "junction", junctionId: id }),
    );
    const points =
      contact?.endpoints
        .filter((e) => e.kind === "terminal")
        .map((e) => resolveEndpointConnection(draft, resolver, e)) ?? [];
    const connection = points[0];
    if (
      !connection ||
      !points.every(
        (p) =>
          p?.contactPoint.x === connection.contactPoint.x &&
          p.contactPoint.y === connection.contactPoint.y,
      )
    )
      continue;
    const index = draft.junctions.findIndex((j) => j.id === id);
    if (index < 0) continue;
    const junction = writableDraftRow(
      draft,
      draft.junctions,
      draft.junctions[index]!,
      index,
    );
    junction.position = { ...connection.gridLanding };
    if (connection.endpoint.kind === "terminal") {
      junction.contactAnchor = {
        instanceId: connection.endpoint.instanceId,
        pinName: connection.endpoint.pinName,
      };
    }
    movedJunctionIds.add(id);
    changedObjectIds.add(id);
  }
  // A partial move or deletion leaves the dot at the surviving contact. A
  // stale terminal reference must never drag its color onto a separate pin.
  for (const [index, junction] of draft.junctions.entries()) {
    if (!junction.contactAnchor || ids.includes(junction.id)) continue;
    if (movedJunctionIds.has(junction.id)) {
      const anchor = resolveEndpointConnection(draft, resolver, {
        kind: "terminal",
        ...junction.contactAnchor!,
      });
      if (
        !anchor ||
        anchor.gridLanding.x !== junction.position.x ||
        anchor.gridLanding.y !== junction.position.y
      )
        delete writableDraftRow(draft, draft.junctions, junction, index)
          .contactAnchor;
      continue;
    }
    const oldContact = evidence.byEndpointKey.get(
      endpointKey({ kind: "junction", junctionId: junction.id }),
    );
    if (!oldContact) continue;
    const terminals =
      draft.nets.find((net) => net.id === junction.netId)?.terminals ?? [];
    const belongsToNet = (endpoint: { instanceId: string; pinName: string }) =>
      terminals.some(
        (terminal) =>
          terminal.instanceId === endpoint.instanceId &&
          terminal.pinName === endpoint.pinName,
      );
    const currentAnchor = resolveEndpointConnection(draft, resolver, {
      kind: "terminal",
      ...junction.contactAnchor!,
    });
    if (
      belongsToNet(junction.contactAnchor!) &&
      currentAnchor?.contactPoint.x === oldContact.point.x &&
      currentAnchor.contactPoint.y === oldContact.point.y &&
      currentAnchor.gridLanding.x === junction.position.x &&
      currentAnchor.gridLanding.y === junction.position.y
    )
      continue;
    const survivor = oldContact?.endpoints
      .filter(
        (endpoint) => endpoint.kind === "terminal" && belongsToNet(endpoint),
      )
      .map((endpoint) => resolveEndpointConnection(draft, resolver, endpoint))
      .find(
        (connection) =>
          connection?.contactPoint.x === oldContact.point.x &&
          connection.contactPoint.y === oldContact.point.y,
      );
    const owned = writableDraftRow(draft, draft.junctions, junction, index);
    if (survivor?.endpoint.kind === "terminal") {
      owned.contactAnchor = {
        instanceId: survivor.endpoint.instanceId,
        pinName: survivor.endpoint.pinName,
      };
      owned.position = { ...survivor.gridLanding };
    } else {
      delete owned.contactAnchor;
    }
    changedObjectIds.add(junction.id);
  }
}

/** Net splits may retire the terminal that supplied a marker's exact contact. */
export function reconcileJunctionContactAnchors(
  document: SchematicDocument,
  resolver: SymbolResolver,
  changedObjectIds: Set<string>,
): void {
  for (const [index, junction] of document.junctions.entries()) {
    const anchor = junction.contactAnchor;
    if (!anchor) continue;
    const terminals =
      document.nets.find((net) => net.id === junction.netId)?.terminals ?? [];
    if (
      terminals.some(
        (terminal) =>
          terminal.instanceId === anchor.instanceId &&
          terminal.pinName === anchor.pinName,
      )
    )
      continue;
    const oldConnection = resolveEndpointConnection(document, resolver, {
      kind: "terminal",
      ...anchor,
    });
    const replacement = terminals.find((terminal) => {
      const connection = resolveEndpointConnection(document, resolver, {
        kind: "terminal",
        ...terminal,
      });
      return (
        connection &&
        oldConnection &&
        connection.contactPoint.x === oldConnection.contactPoint.x &&
        connection.contactPoint.y === oldConnection.contactPoint.y &&
        connection.gridLanding.x === junction.position.x &&
        connection.gridLanding.y === junction.position.y
      );
    });
    const owned = writableDraftRow(
      document,
      document.junctions,
      junction,
      index,
    );
    if (replacement) owned.contactAnchor = { ...replacement };
    else delete owned.contactAnchor;
    changedObjectIds.add(junction.id);
  }
}
