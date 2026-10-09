// Generic DIODE, NPN and PNP cards for a Process without its own, and the
// findings on parts that lean on a generic model.
import type { CircuitProject, SchematicDocument } from "@icm/model";
import type {
  DesignNetlistInstance,
  DesignNetlistModel,
  NetlistDiagnostic,
} from "./ir.js";
import { diagnostic } from "./extract-common.js";
import { partList } from "./extract-findings.js";

/**
 * The model a diode takes in a Process with no diode of its own (#1310):
 * Abstract, SKY130, IHP SG13G2 and Custom bind each diode placed from the
 * library to `DIODE`, a name no library defines, so every run of that
 * netlist failed on the missing model while the export said ready. Like the
 * ideal switch, each Cell using the name carries this card in its own body:
 * SPICE's default junction, with its saturation current and emission
 * coefficient stated. It is a stand-in, reported as information, and a model
 * of the same name that the Project defines itself replaces it.
 */
export const GENERIC_DIODE_MODEL: DesignNetlistModel = {
  name: "DIODE",
  type: "D",
  parameters: [
    { name: "IS", rawValue: "1e-14" },
    { name: "N", rawValue: "1" },
  ],
  authoredName: true,
};

/**
 * The models a bipolar transistor takes in a Process with no BJT of its own
 * (#1420): Abstract and Custom bind each NPN and PNP placed from the library
 * to `NPN` and `PNP`, names no library defines, so a run of that netlist
 * stopped on the missing model as a diode's did (#1310). They are carried
 * and replaced as the generic diode is: Gummel-Poon placeholders with their
 * saturation current, forward gain and Early voltage stated, not any real
 * device.
 */
export const GENERIC_NPN_MODEL: DesignNetlistModel = {
  name: "NPN",
  type: "NPN",
  parameters: [
    { name: "IS", rawValue: "1e-16" },
    { name: "BF", rawValue: "100" },
    { name: "VAF", rawValue: "100" },
  ],
  authoredName: true,
};
export const GENERIC_PNP_MODEL: DesignNetlistModel = {
  name: "PNP",
  type: "PNP",
  parameters: [
    { name: "IS", rawValue: "1e-16" },
    { name: "BF", rawValue: "50" },
    { name: "VAF", rawValue: "50" },
  ],
  authoredName: true,
};

/**
 * Whether the author's own text defines a generic model's name, `.model
 * DIODE …` in SPICE or `model DIODE …` in VACASK and Spectre: a source file
 * of the run this netlist is for, or the SPICE the Project was imported
 * from. That model is the author's. The card inside a Cell would shadow it
 * there, so no Cell carries one. Another simulation folder's files do not
 * count: a testbench defining DIODE for its own run left a second folder's
 * run, and the design export, with no model at all.
 */
export function definesGenericModel(
  project: CircuitProject,
  deckSources: readonly string[],
  model: DesignNetlistModel,
): boolean {
  const definition = new RegExp(
    String.raw`^[ \t]*\.?model[ \t]+${model.name}(?=[\s(]|$)`,
    "imu",
  );
  const texts = [
    ...deckSources,
    ...(project.source?.files ?? []).flatMap((file) => [
      file.content?.text,
      file.originalContent?.text,
    ]),
  ];
  return texts.some((text) => text !== undefined && definition.test(text));
}

/** Printed parts by the References their Cell shows, in reading order. */
function namedParts(
  document: SchematicDocument,
  parts: readonly DesignNetlistInstance[],
): Array<{ id: string; name: string; symbolId: string | undefined }> {
  return parts
    .map((part) => {
      const instance = document.instances.find((item) => item.id === part.id);
      return {
        id: part.id,
        name: instance?.reference ?? part.reference,
        symbolId: instance?.symbolId,
      };
    })
    .sort((left, right) =>
      left.name.localeCompare(right.name, "en", { numeric: true }),
    );
}

/**
 * Which diodes run on the generic card (#1310). Information, as a default
 * body supply is: the netlist now runs, but on a stand-in junction, not on a
 * device anyone chose.
 */
export function reportGenericDiodes(
  document: SchematicDocument,
  diodes: readonly DesignNetlistInstance[],
  diagnostics: NetlistDiagnostic[],
): void {
  const parts = namedParts(document, diodes);
  const values = GENERIC_DIODE_MODEL.parameters
    .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
    .join(", ");
  // A Zener on it runs, but never breaks down: say so rather than let a
  // regulator simulate as a plain diode unnoticed.
  const zeners = parts
    .filter((part) => part.symbolId === "zener-diode")
    .map((part) => part.name);
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_DIODE_MODEL",
    `${partList(parts.map((part) => part.name))} ${parts.length === 1 ? "uses" : "use"} the generic diode model ${GENERIC_DIODE_MODEL.name} (${values}); set a model for a real device${
      zeners.length
        ? `. It has no breakdown, so ${partList(zeners)} ${zeners.length === 1 ? "does" : "do"} not act as a Zener until given a Zener model`
        : ""
    }`,
    parts.map((part) => part.id),
    "info",
  );
}

/**
 * The generic targets the editor binds that a SPICE netlist names but does
 * not define (#1420): Abstract's NMOS and PMOS, and SW for a voltage-
 * controlled switch. No one card suits every simulator, as a level-1 card
 * refuses the nf every MOS carries, and a switch's threshold is the
 * design's own. A Cell that leans on one says it needs a card before it
 * simulates, unless the imported SPICE or the run's own files supply it.
 */
const UNDEFINED_GENERIC_TARGETS = [
  { name: "NMOS", deviceClass: "mos" },
  { name: "PMOS", deviceClass: "mos" },
  { name: "SW", deviceClass: "switch" },
] as const;

export function reportUndefinedGenericModels(
  project: CircuitProject,
  document: SchematicDocument,
  instances: readonly DesignNetlistInstance[],
  deckSources: readonly string[],
  diagnostics: NetlistDiagnostic[],
): void {
  const named = UNDEFINED_GENERIC_TARGETS.flatMap(({ name, deviceClass }) => {
    // SPICE reads model names in any case. Only a device of that class names
    // the model: a call to a Cell named sw names the Cell.
    const parts = instances.filter(
      (instance) =>
        instance.deviceClass === deviceClass &&
        instance.target?.toUpperCase() === name,
    );
    return parts.length &&
      !definesGenericModel(project, deckSources, {
        name,
        type: name,
        parameters: [],
      })
      ? [{ name, parts }]
      : [];
  });
  if (!named.length) return;
  const uses = named.map(({ name, parts }) => {
    const names = namedParts(document, parts).map((part) => part.name);
    return `${partList(names)} ${names.length === 1 ? "names" : "name"} ${name}`;
  });
  const models = named.map(({ name }) => name);
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_MODEL_UNDEFINED",
    `${partList(uses)}, ${models.length === 1 ? "a generic model" : "generic models"} the netlist does not define: add ${models.length === 1 ? `a .model ${models[0]!} card` : `.model cards for ${partList(models)}`} to the simulation folder before simulating, or set a real model`,
    named.flatMap(({ parts }) => parts.map((part) => part.id)),
    "info",
  );
}

/**
 * Which bipolar transistors run on the generic cards (#1420), one finding
 * for the Cell as for its diodes: information, since the netlist runs, but
 * on stand-in transistors, not on devices anyone chose.
 */
export function reportGenericBjts(
  document: SchematicDocument,
  used: ReadonlyArray<{
    model: DesignNetlistModel;
    parts: readonly DesignNetlistInstance[];
  }>,
  diagnostics: NetlistDiagnostic[],
): void {
  const named = used.map(({ model, parts }) => ({
    model,
    parts: namedParts(document, parts),
  }));
  const uses = named.map(({ model, parts }) => {
    const values = model.parameters
      .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
      .join(", ");
    return `${partList(parts.map((part) => part.name))} ${parts.length === 1 ? "uses" : "use"} the generic bipolar model ${model.name} (${values})`;
  });
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_BJT_MODEL",
    `${uses.join(", ")}; set a model for a real device`,
    named.flatMap(({ parts }) => parts.map((part) => part.id)),
    "info",
  );
}
