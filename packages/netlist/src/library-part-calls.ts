// What a Library part's call reaches (#1928). The name is never the key: an
// unbound part calls its own generated body, under its plain name or, where
// one of the author's definitions takes that name, a reserved one; a part
// retargeted to a name the Project defines is bound to that definition.
import { libraryPartRetarget, portableCellIdentifier } from "@icm/derived";
import type { CircuitProject, SchematicDocument } from "@icm/model";
import { boundPartParameters } from "@icm/devices";

import type { DesignNetlistIR } from "./ir.js";
import type { NetlistFormat } from "./net-name-codec.js";
import { inspectProjectModelSource } from "./project-model-source.js";

/** The prefix a generated body's name takes where the author has its name. */
const GENERATED_BODY_PREFIX = "icm_";

/**
 * The subcircuit names the author's definitions take, folded as SPICE folds
 * them, each with what takes it: the Cells, external definitions and model
 * sources given. For the whole Project, so each root of it writes a body
 * under one name.
 */
export function authorSubcircuitNames(
  project: Pick<
    CircuitProject,
    "documents" | "externalSubcircuitDefinitions" | "modelSources"
  >,
): ReadonlyMap<string, string> {
  const owners = new Map<string, string>();
  const take = (name: string, owner: string) => {
    const folded = name.toLowerCase();
    if (!owners.has(folded)) owners.set(folded, owner);
  };
  for (const document of project.documents)
    if (document.netlist?.name)
      take(
        portableCellIdentifier(document.netlist.name, document.id),
        `Cell ${document.netlist.name}`,
      );
  for (const definition of project.externalSubcircuitDefinitions)
    take(definition.name, `external subcircuit ${definition.name}`);
  for (const source of project.modelSources ?? [])
    for (const entry of inspectProjectModelSource(source).entries)
      take(entry.name, `model-source subcircuit ${entry.name}`);
  return owners;
}

/**
 * The names the author's definitions take in one output: the Cells it prints,
 * the external definitions they call and those definitions' model sources.
 */
export function outputSubcircuitNames(
  project: Pick<
    CircuitProject,
    "externalSubcircuitDefinitions" | "modelSources"
  >,
  documents: readonly SchematicDocument[],
): ReadonlyMap<string, string> {
  const called = new Set(
    documents.flatMap((document) =>
      document.instances.flatMap((instance) =>
        instance.netlist?.binding?.kind === "external-subcircuit"
          ? [instance.netlist.binding.definitionId]
          : [],
      ),
    ),
  );
  const definitions = project.externalSubcircuitDefinitions.filter(
    (definition) => called.has(definition.id),
  );
  const sources = new Set(
    definitions.flatMap((definition) =>
      definition.implementation?.kind === "source"
        ? [definition.implementation.sourceId]
        : [],
    ),
  );
  return authorSubcircuitNames({
    documents: [...documents],
    externalSubcircuitDefinitions: definitions,
    modelSources: (project.modelSources ?? []).filter((source) =>
      sources.has(source.id),
    ),
  });
}

/** The name a generated body is written under, or why it has none. */
export type WrittenBodyName =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly message: string };

/**
 * The name a generated body is written under: its own, or, where an author's
 * definition takes that, the reserved one. None where the reserved name is
 * taken too, or the body's own name is already reserved; the message follows
 * the calling part's Reference.
 */
export function writtenBodyName(
  plain: string,
  owners: ReadonlyMap<string, string>,
): WrittenBodyName {
  const owner = owners.get(plain.toLowerCase());
  if (!owner) return { ok: true, name: plain };
  if (withoutReservedPrefix(plain) !== undefined)
    return {
      ok: false,
      message: `generated body ${plain} has a name Analog Canvas reserves, but ${owner} of this Project has it too; rename it`,
    };
  const reserved = `${GENERATED_BODY_PREFIX}${plain}`;
  const reservedOwner = owners.get(reserved.toLowerCase());
  return reservedOwner
    ? {
        ok: false,
        message: `generated ${plain} body is written as ${reserved} where ${owner} of this Project has its name, but ${reservedOwner} has that one too; rename one of them`,
      }
    : { ok: true, name: reserved };
}

/** A written name without the reserved prefix a yielding body takes, if it has it. */
export function withoutReservedPrefix(name: string): string | undefined {
  return name.toLowerCase().startsWith(GENERATED_BODY_PREFIX)
    ? name.slice(GENERATED_BODY_PREFIX.length)
    : undefined;
}

/** The generated body's own name that a name the IR writes stands for. */
export function plainBodyName(ir: DesignNetlistIR, written: string): string {
  for (const definition of ir.generatedDefinitions ?? [])
    if (definition.kind === "behavioral" && definition.name === written)
      return definition.body ?? written;
  for (const cell of ir.cells)
    if (cell.origin === "generated-model" && cell.name === written)
      return cell.body ?? written;
  return written;
}

/**
 * Why a Library part's call by name cannot be written: the name is the
 * reader's interface, yet one of the author's definitions takes it. Undefined
 * where it can.
 */
export function libraryCallCollision(
  call: { readonly reference: string; readonly target: string },
  owner: string | undefined,
  kind: "call-only" | "undeclared",
  format: NetlistFormat,
): string | undefined {
  if (!owner) return undefined;
  return kind === "call-only"
    ? `${call.reference} calls ${call.target}, which a ${format === "spectre" ? "Spectre" : "SPICE"} export leaves to your libraries, but ${owner} of this Project has that name: bind ${call.reference} to it with set-model (its Pins by name), or rename it`
    : `${call.reference} names ${call.target}, which ${owner} of this Project defines without declaring its ports: bind ${call.reference} with set-model to a subcircuit whose ports are named (its Pins by name), or rename one of them`;
}

/**
 * The Project with each Library part retargeted to a name it defines bound
 * to that definition, as set-model would bind it: Pins by name, never by
 * position, and the body's own parameters dropped. A part retargeted to any
 * other name keeps its call to the reader's libraries. The Project passed in
 * is not changed.
 */
export function withRetargetBindings(project: CircuitProject): CircuitProject {
  let changed = false;
  const documents = project.documents.map((document) => {
    let instances = document.instances;
    document.instances.forEach((instance, index) => {
      const retarget = libraryPartRetarget(project, instance);
      if (!retarget) return;
      if (instances === document.instances) instances = [...instances];
      instances[index] = {
        ...instance,
        netlist: {
          ...instance.netlist,
          binding: retarget.binding,
          parameters: boundPartParameters(
            instance.netlist?.parameters ?? {},
            retarget.formalParameters,
          ),
        },
      };
      changed = true;
    });
    return instances === document.instances
      ? document
      : { ...document, instances };
  });
  return changed ? { ...project, documents } : project;
}
