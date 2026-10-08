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

/**
 * A closed Project fragment, never a reference to another tab's mutable state.
 * Every copy path encodes a fresh insertion: what was selected travels, with
 * its own wiring and labels, and no Net name, Bulk or No Connect from outside
 * the selection does. Copying a whole Cell leaves nothing outside it.
 */
export function encodeCircuitClipboard(
  project: CircuitProject,
  document: SchematicDocument,
  selection: Selection,
): string | null {
  // Every copy is a clone of what was selected, placed the way C places it. A
  // partial selection brings nothing from outside it; a whole Cell leaves
  // nothing outside, so its names, No Connects and testbench come too.
  const copied = captureProjectCopy(project, document, selection);
  if (!copied?.context) return null;
  const context = copied.context;
  const fragment = createEmptyProject(project.id, "Clipboard", document.id);
  fragment.source = context.source;
  fragment.symbolLibrary = context.symbolLibrary;
  fragment.componentDefinitions = context.componentDefinitions;
  fragment.externalSubcircuitDefinitions =
    context.externalSubcircuitDefinitions;
  fragment.simulationFolders = context.simulationFolders ?? [];
  fragment.modelSources = context.modelSources ?? [];
  const presentation = structuredClone(context.presentation);
  fragment.documents = [
    {
      ...fragment.documents[0]!,
      name: document.name,
      presentation,
      // A copied MOS body travels as the membership of a Net the copy
      // brings; any other body takes the destination Cell's policy, as a
      // newly inserted MOS does. So the fragment carries no bulk binding
      // (it would name a Net the copy does not bring).
      instances: copied.instances.map(({ mosBulkBinding: _, ...instance }) => ({
        ...instance,
      })),
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
  // The fragment is exactly what was copied, so all of it travels, and it is
  // placed the way C places a copy, whichever key pasted it.
  const clipboard = captureProjectCopy(project, document, {
    instanceIds: document.instances.map((item) => item.id),
    routeIds: document.routes.map((item) => item.id),
    junctionIds: document.junctions.map((item) => item.id),
    annotationIds: document.annotations.map((item) => item.id),
    draftingIds: (document.drafting?.objects ?? []).map((item) => item.id),
  });
  return clipboard;
}
