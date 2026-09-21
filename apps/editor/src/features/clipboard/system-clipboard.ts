import { z } from "zod";
import {
  CircuitProjectSchema,
  createEmptyProject,
  type CircuitProject,
  type SchematicDocument,
} from "@icm/model";
import { captureProjectCopy } from "./project-copy";
import type {
  SchematicClipboard,
  ExplicitCopyRoutingSelection,
} from "./clipboard";

const FORMAT = "analog-canvas/clipboard";
export const CIRCUIT_CLIPBOARD_MIME = "application/x-analog-canvas+json";
const MAX_CHARACTERS = 16 * 1024 * 1024;
const Envelope = z.strictObject({
  format: z.literal(FORMAT),
  version: z.literal(1),
  project: CircuitProjectSchema,
});
type Selection = ExplicitCopyRoutingSelection & {
  instanceIds: readonly string[];
  draftingIds: readonly string[];
};

/** A closed Project fragment, never a reference to another tab's mutable state. */
export function encodeCircuitClipboard(
  project: CircuitProject,
  document: SchematicDocument,
  selection: Selection,
): string | null {
  const includes = (items: readonly { id: string }[], ids: readonly string[]) =>
    items.every((item) => ids.includes(item.id));
  const whole =
    includes(document.instances, selection.instanceIds) &&
    includes(document.routes, selection.routeIds) &&
    includes(document.junctions, selection.junctionIds) &&
    includes(document.annotations, selection.annotationIds) &&
    includes(document.drafting?.objects ?? [], selection.draftingIds);
  const copied = captureProjectCopy(
    project,
    document,
    whole ? undefined : selection,
    true,
  );
  if (!copied?.context) return null;
  const context = copied.context;
  const fragment = createEmptyProject(project.id, "Clipboard", document.id);
  fragment.source = context.source;
  fragment.symbolLibrary = context.symbolLibrary;
  fragment.componentDefinitions = context.componentDefinitions;
  fragment.externalSubcircuitDefinitions =
    context.externalSubcircuitDefinitions;
  fragment.simulationFolders = context.simulationFolders ?? [];
  const presentation = structuredClone(context.presentation);
  // The source Cell's own symbol interface is not part of a partial canvas selection.
  if (!whole) delete presentation.cellSymbol;
  fragment.documents = [
    {
      ...fragment.documents[0]!,
      name: document.name,
      presentation,
      instances: copied.instances,
      nets: copied.nets,
      routes: copied.routes,
      junctions: copied.junctions,
      annotations: copied.annotations,
      connectivityEvidence: copied.connectivityEvidence,
      noConnects: copied.noConnects,
      layoutGroups: copied.layoutGroups,
      constraints: copied.constraints,
      drafting: { objects: copied.draftingObjects },
      ...(document.netlist
        ? {
            netlist: {
              name: document.netlist.name,
              terminals: copied.cellTerminals,
              formalParameters: copied.formalParameters,
            },
          }
        : {}),
    },
    ...context.documents,
  ];
  const text = JSON.stringify(
    Envelope.parse({ format: FORMAT, version: 1, project: fragment }),
  );
  if (text.length > MAX_CHARACTERS)
    throw new Error(
      "Circuit is too large for the clipboard; export the Project file instead",
    );
  return text;
}

/** Native text clipboard fallback works across tabs, windows and browser origins. */
export function decodeCircuitClipboard(
  text: string,
): SchematicClipboard | null {
  if (!text.includes(`"${FORMAT}"`)) return null;
  if (text.length > MAX_CHARACTERS)
    throw new Error("Circuit clipboard exceeds the size limit");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new Error("Circuit clipboard is incomplete or invalid");
  }
  const parsed = Envelope.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "Circuit clipboard is invalid or uses an unsupported version; copy again from an updated editor",
    );
  const project = parsed.data.project;
  const document = project.documents.find(
    (item) => item.id === project.topDocumentId,
  )!;
  const clipboard = captureProjectCopy(project, document);
  if (clipboard) clipboard.isolateLocalNames = true;
  return clipboard;
}
