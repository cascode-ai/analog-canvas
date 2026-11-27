import {
  boundAnnotationName,
  flattenRichText,
  foldNetName,
  hasRichTextOverbar,
} from "@icm/model";
import type { CircuitProject } from "@icm/model";

import {
  annotationNetId,
  memberNetIds,
  visibleDocumentAnnotations,
} from "../document-read-helpers.js";
import type { resolveDocumentLogicalNets } from "../logical-net.js";
import { directObjectLocator } from "../object-locator.js";
import type { ErcDiagnostic } from "./erc.js";

type Document = CircuitProject["documents"][number];
type LogicalNets = ReturnType<typeof resolveDocumentLogicalNets>;

/**
 * A part whose name label reads another part's name, while that other part
 * shows something else: the drawing then names the wrong devices, and the
 * netlist, which goes by References, disagrees with it. Swapped labels are
 * the usual case.
 *
 * A display alias that reads a name no part has, or the name of a part that
 * shows that same name (several parts drawn as one), is deliberate and stays
 * silent.
 */
export function reportLabelsNamingAnotherPart(
  document: Document,
  diagnostics: ErcDiagnostic[],
): void {
  const fold = (text: string) => text.trim().toLowerCase();
  const byReference = new Map<string, string>();
  for (const instance of document.instances)
    if (instance.reference)
      byReference.set(fold(instance.reference), instance.id);
  // What each part's visible name label reads: its Reference when bound,
  // the literal text otherwise.
  const shown = new Map<string, string>();
  const literal: { annotationId: string; instanceId: string; text: string }[] =
    [];
  for (const annotation of visibleDocumentAnnotations(document)) {
    if (annotation.kind !== "instance-label") continue;
    const binding = annotation.binding;
    if (binding?.kind === "instance-reference") {
      const instance = document.instances.find(
        (item) => item.id === binding.instanceId,
      );
      if (instance?.reference && !shown.has(instance.id))
        shown.set(instance.id, instance.reference);
      continue;
    }
    if (binding || annotation.anchor.kind !== "object" || !annotation.content)
      continue;
    const owner = annotation.anchor.objectId;
    const text = flattenRichText(annotation.content).trim();
    if (!/^[A-Za-z][A-Za-z0-9_]*$/u.test(text)) continue;
    if (!shown.has(owner)) shown.set(owner, text);
    literal.push({ annotationId: annotation.id, instanceId: owner, text });
  }
  for (const label of literal) {
    const owner = document.instances.find(
      (item) => item.id === label.instanceId,
    );
    if (!owner?.reference || fold(owner.reference) === fold(label.text))
      continue;
    const namedId = byReference.get(fold(label.text));
    if (!namedId || namedId === owner.id) continue;
    const named = document.instances.find((item) => item.id === namedId)!;
    const namedShows = shown.get(namedId);
    if (namedShows && fold(namedShows) === fold(label.text)) continue;
    diagnostics.push({
      id: `erc:label-reference-mismatch:${document.id}:${label.annotationId}`,
      domain: "erc",
      code: "ERC_LABEL_REFERENCE_MISMATCH",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `${owner.reference}'s name label reads ${label.text}, another part's name${
        namedShows ? `, while ${named.reference} reads ${namedShows}` : ""
      }. The netlist calls this part ${owner.reference}; untick Display alias on the label to show its own name.`,
      primary: directObjectLocator(
        document.id,
        "annotation",
        label.annotationId,
      ),
      related: [
        directObjectLocator(document.id, "instance", owner.id),
        directObjectLocator(document.id, "instance", namedId),
      ],
      parameters: {
        instanceId: owner.id,
        reference: owner.reference,
        labelText: label.text,
        namedInstanceId: namedId,
      },
    });
  }
}

/**
 * Net names read the same once look-alike characters are: digit 0 and letter
 * O, digit 1 and letters l and I. The characters are read as written, before
 * case folds: I and l look alike, but i and L do not.
 */
function lookAlikeKey(name: string): string {
  return foldNetName(name.replace(/[Oo]/gu, "0").replace(/[Il|]/gu, "1"));
}

/**
 * Two Nets of one Cell whose names differ only by look-alike characters, X0
 * and XO, or V1 and Vl: the drawing reads one node, the netlist keeps two
 * (#2557). Reported once for each set of such names.
 */
export function reportLookAlikeNetNames(
  document: Document,
  logicalNets: LogicalNets,
  diagnostics: ErcDiagnostic[],
): void {
  const byKey = new Map<string, Map<string, (typeof logicalNets.groups)[0]>>();
  for (const net of logicalNets.groups) {
    if (!net.name) continue;
    const names = byKey.get(lookAlikeKey(net.name)) ?? new Map();
    const folded = foldNetName(net.name);
    if (!names.has(folded)) names.set(folded, net);
    byKey.set(lookAlikeKey(net.name), names);
  }
  for (const [key, names] of byKey) {
    if (names.size < 2) continue;
    const nets = [...names.values()].sort((left, right) =>
      left.name!.localeCompare(right.name!, "en"),
    );
    const listed = nets.map((net) => net.name!);
    diagnostics.push({
      id: `erc:lookalike-net-names:${document.id}:${key}`,
      domain: "erc",
      code: "ERC_LOOKALIKE_NET_NAMES",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Net names ${listed.slice(0, -1).join(", ")} and ${listed.at(-1)} differ only by look-alike characters (0 and O, 1, l and I), so they are ${listed.length === 2 ? "two" : "separate"} Nets; rename one if they are meant to be the same node`,
      primary: directObjectLocator(document.id, "net", nets[0]!.id),
      related: nets
        .slice(1)
        .map((net) => directObjectLocator(document.id, "net", net.id)),
      parameters: { names: listed.join(","), count: listed.length },
    });
  }
}

/**
 * A Net Label whose Net reaches no pin, wire or Junction names nothing, though
 * drawn beside a wire it reads as that wire's name: the wire's own Net stays
 * unnamed. A label pasted away from a wire lands so, as do older drawings;
 * pasting it onto the wire, or the Net Label tool (L), puts it on its wire.
 * Hidden Net Labels (`visible: false`, such as retired process-supply stubs)
 * are never drawn and are skipped.
 */
export function reportNetLabelsNamingNothing(
  document: Document,
  diagnostics: ErcDiagnostic[],
): void {
  const reached = new Set<string>([
    ...document.nets.flatMap((net) => (net.terminals.length ? [net.id] : [])),
    ...document.routes.flatMap((route) => memberNetIds(route)),
    ...document.junctions.flatMap((junction) => memberNetIds(junction)),
  ]);
  for (const annotation of visibleDocumentAnnotations(document)) {
    if (annotation.kind !== "net-label") continue;
    const netId = annotationNetId(annotation);
    if (!netId || reached.has(netId)) continue;
    const claim = document.connectivityEvidence.find(
      (evidence) =>
        evidence.kind === "name-claim" &&
        evidence.owner.kind === "net-label" &&
        evidence.owner.annotationId === annotation.id,
    );
    const name = claim?.kind === "name-claim" ? claim.name : annotation.id;
    diagnostics.push({
      id: `erc:net-label-names-nothing:${document.id}:${annotation.id}`,
      domain: "erc",
      code: "ERC_NET_LABEL_NAMES_NOTHING",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Net Label ${name} is on no wire or pin, so it names nothing; paste it onto its wire, or place it there with the Net Label tool (L)`,
      primary: directObjectLocator(document.id, "annotation", annotation.id),
      related: [directObjectLocator(document.id, "net", netId)],
      parameters: { annotationId: annotation.id, netId },
    });
  }
}

/** Legacy presentation is not a rename: flag ambiguous signals, never infer
 * connectivity from their RichText or from a device Reference's styling. */
export function reportOverbarNameMismatches(
  document: Document,
  diagnostics: ErcDiagnostic[],
): void {
  for (const annotation of visibleDocumentAnnotations(document)) {
    const binding = annotation.binding;
    if (
      (binding?.kind !== "net-name" &&
        binding?.kind !== "cell-terminal-name") ||
      !annotation.formatOverride ||
      !hasRichTextOverbar(annotation.formatOverride)
    )
      continue;
    const name = boundAnnotationName(document, annotation);
    if (!name || name.endsWith("_bar")) continue;
    diagnostics.push({
      id: `erc:overbar-name-mismatch:${document.id}:${annotation.id}`,
      domain: "erc",
      code: "ERC_OVERBAR_NAME_MISMATCH",
      severity: "warning",
      confidence: "high",
      gateEligible: false,
      message: `Label draws ${name} with an overbar, but its electrical name is ${name}; it still connects by that name. Rename it to ${name}_bar if it denotes a separate signal`,
      primary: directObjectLocator(document.id, "annotation", annotation.id),
      related: [],
      parameters: { annotationId: annotation.id, name },
    });
  }
}
