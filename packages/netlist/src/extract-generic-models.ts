// Generic DIODE, DSCH, NPN, PNP, NJF, PJF, NMOS_DEP and PMOS_DEP cards for a
// Process without its own, and the findings on parts that lean on a generic
// model.
import type { CircuitProject, SchematicDocument } from "@icm/model";
import {
  GENERIC_MODEL_TARGETS,
  instanceEvidence,
  namesModelOutsideSources,
  reviewedExternalBindingForMaster,
  sourcesDefineModel,
} from "@icm/devices";
import type {
  DesignNetlistInstance,
  DesignNetlistModel,
  NetlistDiagnostic,
} from "./ir.js";
import { diagnostic } from "./extract-common.js";
import { spectreModelCard, spiceModelCard } from "./printers.js";
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
  name: GENERIC_MODEL_TARGETS.diode,
  type: "D",
  parameters: [
    { name: "IS", rawValue: "1e-14" },
    { name: "N", rawValue: "1" },
  ],
  authoredName: true,
};

/**
 * The model a Schottky diode takes in every Process, none of which ships one:
 * each Schottky Diode placed from the library binds to `DSCH`, carried and
 * replaced as the generic diode is. A placeholder barrier junction with its
 * saturation current, emission coefficient and series resistance stated, not
 * any real device: about 0.3 V forward at 1 mA, where `DIODE` drops 0.7 V.
 */
export const GENERIC_SCHOTTKY_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS["schottky-diode"],
  type: "D",
  parameters: [
    { name: "IS", rawValue: "1e-8" },
    { name: "N", rawValue: "1.05" },
    { name: "RS", rawValue: "1" },
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
  name: GENERIC_MODEL_TARGETS.npn,
  type: "NPN",
  parameters: [
    { name: "IS", rawValue: "1e-16" },
    { name: "BF", rawValue: "100" },
    { name: "VAF", rawValue: "100" },
  ],
  authoredName: true,
};
export const GENERIC_PNP_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS.pnp,
  type: "PNP",
  parameters: [
    { name: "IS", rawValue: "1e-16" },
    { name: "BF", rawValue: "50" },
    { name: "VAF", rawValue: "50" },
  ],
  authoredName: true,
};

/**
 * The models a junction FET takes in every Process, none of which ships one:
 * each NJFET and PJFET placed from the library binds to `NJF` and `PJF`,
 * carried and replaced as the generic diode is. Shichman-Hodges placeholders
 * with their pinch-off voltage, transconductance coefficient and channel-
 * length modulation stated, not any real device: IDSS = BETA*VTO^2 = 4 mA.
 * SPICE's PJF takes VTO negative as NJF does, so both state -2.
 */
export const GENERIC_NJF_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS.njfet,
  type: "NJF",
  parameters: [
    { name: "VTO", rawValue: "-2" },
    { name: "BETA", rawValue: "1e-3" },
    { name: "LAMBDA", rawValue: "0.01" },
  ],
  authoredName: true,
};
export const GENERIC_PJF_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS.pjfet,
  type: "PJF",
  parameters: [
    { name: "VTO", rawValue: "-2" },
    { name: "BETA", rawValue: "1e-3" },
    { name: "LAMBDA", rawValue: "0.01" },
  ],
  authoredName: true,
};

function importedModelTexts(project: CircuitProject): string[] {
  return (project.source?.files ?? []).flatMap((file) =>
    [file.content?.text, file.originalContent?.text].filter(
      (text): text is string => text !== undefined,
    ),
  );
}

/**
 * Whether the author's own text defines a generic model's name, `.model
 * DIODE …` in SPICE or `model DIODE …` in Spectre: a source file
 * of the run this netlist is for, or the SPICE the Project was imported
 * from. That model is the author's. The card inside a Cell would shadow it
 * there, so no Cell carries one. Another simulation folder's files do not
 * count: a testbench defining DIODE for its own run left a second folder's
 * run, and the design export, with no model at all. The stand-in card
 * itself, as the export writes it in SPICE or Spectre, is not the author's:
 * a netlist the editor wrote and imported again holds it (#1789).
 */
export function definesGenericModel(
  project: CircuitProject,
  deckSources: readonly string[],
  model: DesignNetlistModel,
): boolean {
  const definition = new RegExp(
    String.raw`^[ \t]*\.?model[ \t]+${model.name}(?=[\s(]|$)`,
    "iu",
  );
  // A card as what it says, however it is spelled: its type, Spectre's diode
  // as SPICE's d, and its parameters in any order, case or parentheses.
  const spelled = (line: string) => {
    const [, type = "", rest = ""] =
      /^\s*\.?model\s+\S+\s+([^\s(]+)\s*\(?([^)]*)\)?\s*$/iu.exec(line) ?? [];
    const kind = type.toLowerCase();
    return [
      kind === "diode" ? "d" : kind,
      ...rest.toLowerCase().split(/\s+/u).filter(Boolean).sort(),
    ].join(" ");
  };
  // Only a stand-in the export writes has parameters: a bare card such as
  // `.model NMOS NMOS` is the author's.
  const standIn = new Set(
    model.parameters.length
      ? [spiceModelCard(model), spectreModelCard(model)].flatMap((card) =>
          card ? [spelled(card)] : [],
        )
      : [],
  );
  const texts = [...deckSources, ...importedModelTexts(project)];
  return texts.some((text) =>
    text
      // A card goes on in `+` lines.
      .replace(/\r?\n[ \t]*\+/gu, " ")
      .split(/\r?\n/u)
      .some((line) => definition.test(line) && !standIn.has(spelled(line))),
  );
}

function namesModelOutside(
  project: CircuitProject,
  document: SchematicDocument,
  part: DesignNetlistInstance,
): boolean {
  const source = document.instances.find((item) => item.id === part.id);
  return (
    !!source && namesModelOutsideSources(instanceEvidence(project, source))
  );
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

function carriedModelName(
  parts: readonly DesignNetlistInstance[],
  model: DesignNetlistModel,
): string {
  return parts[0]?.target?.toUpperCase() ?? model.name;
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
    `${partList(parts.map((part) => part.name))} ${parts.length === 1 ? "uses" : "use"} the generic diode model ${carriedModelName(diodes, GENERIC_DIODE_MODEL)} (${values}); set a model for a real device${
      zeners.length
        ? `. It has no breakdown, so ${partList(zeners)} ${zeners.length === 1 ? "does" : "do"} not act as a Zener until given a Zener model`
        : ""
    }`,
    parts.map((part) => part.id),
    "info",
  );
}

/**
 * Which Schottky diodes run on the generic card, one finding for the Cell as
 * for its plain diodes: information, since the netlist runs, but on a
 * stand-in barrier, not on a device anyone chose.
 */
export function reportGenericSchottkys(
  document: SchematicDocument,
  diodes: readonly DesignNetlistInstance[],
  diagnostics: NetlistDiagnostic[],
): void {
  const parts = namedParts(document, diodes);
  const values = GENERIC_SCHOTTKY_MODEL.parameters
    .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
    .join(", ");
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_SCHOTTKY_MODEL",
    `${partList(parts.map((part) => part.name))} ${parts.length === 1 ? "uses" : "use"} the generic Schottky model ${carriedModelName(diodes, GENERIC_SCHOTTKY_MODEL)} (${values}); set a model for a real device`,
    parts.map((part) => part.id),
    "info",
  );
}

/**
 * The stand-ins a MOS takes in a netlist the editor hands out (its panel,
 * copy and save, SPICE+RNL and Spectre+RNL among them) from a Process with no
 * MOS of its own: Abstract binds each NMOS and PMOS placed from the library to
 * `NMOS` and `PMOS`, names no library defines, so that netlist left them
 * undefined and reading it back could not tell an n-channel part from a
 * p-channel one (the user's choice after a hands-on test, 2026-10-17). They
 * are BSIM4 with its defaults, which take the nf every MOS carries where a
 * level-1 card refuses it: level 54 in SPICE, Spectre's own `bsim4`, so the
 * netlist reads in ngspice and Spectre alike (no other simulator is
 * promised). They are carried and replaced as the generic diode is.
 */
export const GENERIC_NMOS_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS.nmos,
  type: "nmos",
  parameters: [{ name: "level", rawValue: "54" }],
  authoredName: true,
};
export const GENERIC_PMOS_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS.pmos,
  type: "pmos",
  parameters: [{ name: "level", rawValue: "54" }],
  authoredName: true,
};

/**
 * The models a depletion MOS takes in every Process, none of which ships
 * one: each depletion NMOS and PMOS placed from the library binds to
 * `NMOS_DEP` and `PMOS_DEP`, carried and replaced as the JFETs' cards are, in
 * a run's SPICE deck too. They are the generic BSIM4 with its threshold moved
 * past zero, on for VGS = 0 (VTH0 -1 for n-channel, +1 for p-channel), so
 * they take the nf every MOS carries, which a level-1 card refuses; not any
 * real device.
 */
export const GENERIC_NMOS_DEPLETION_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS["depletion-nmos"],
  type: "nmos",
  parameters: [
    { name: "level", rawValue: "54" },
    { name: "vth0", rawValue: "-1" },
  ],
  authoredName: true,
};
export const GENERIC_PMOS_DEPLETION_MODEL: DesignNetlistModel = {
  name: GENERIC_MODEL_TARGETS["depletion-pmos"],
  type: "pmos",
  parameters: [
    { name: "level", rawValue: "54" },
    { name: "vth0", rawValue: "1" },
  ],
  authoredName: true,
};

/** Keep a selected stand-in from satisfying a model reference left to the reader. */
export function standInExportName(
  project: CircuitProject,
  name: string,
  currentSources: readonly string[],
  ownedDeviceModels: ReadonlySet<string>,
  authorDefinesModel: boolean,
): string {
  const occupied = new Set(ownedDeviceModels);
  let needsAlias = authorDefinesModel;
  for (const document of project.documents) {
    if (document.netlist) occupied.add(document.netlist.name.toLowerCase());
    for (const instance of document.instances) {
      const binding = instance.netlist?.binding;
      if (binding?.kind !== "model") continue;
      occupied.add(binding.name.toLowerCase());
      if (
        binding.name.toUpperCase() === name &&
        namesModelOutsideSources(instanceEvidence(project, instance))
      ) {
        needsAlias = true;
      }
    }
  }
  if (!needsAlias) return name;
  for (const definition of project.externalSubcircuitDefinitions)
    occupied.add(definition.name.toLowerCase());
  const sources = [...currentSources, ...importedModelTexts(project)];
  const prefix = `CANVAS_${name}`;
  let candidate = prefix;
  let suffix = 2;
  while (
    occupied.has(candidate.toLowerCase()) ||
    sourcesDefineModel(sources, candidate)
  )
    candidate = `${prefix}_${suffix++}`;
  return candidate;
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
  /** Names this netlist carries a stand-in card for. */
  carried: ReadonlySet<string> = new Set(),
): void {
  const named = UNDEFINED_GENERIC_TARGETS.flatMap(({ name, deviceClass }) => {
    if (carried.has(name)) return [];
    // SPICE reads model names in any case. Only a device of that class names
    // the model: a call to a Cell named sw names the Cell.
    // An imported part naming a model no card declares is the reader's
    // (`reportImportedModelsWithoutCards`), not a generic target.
    const parts = instances.filter(
      (instance) =>
        instance.deviceClass === deviceClass &&
        instance.target?.toUpperCase() === name &&
        !namesModelOutside(project, document, instance),
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
 * Imported parts naming a model no card in the sources declares (#2294):
 * their type draws them, and their model is the reader's library, so the
 * netlist keeps each reference and carries no card. A netlist handed out
 * says so, as information. A run says which parts its files leave without a
 * model and refuses, since nothing it loads defines them: its own files, a
 * Project model source or a reviewed PDK table would.
 */
export function reportImportedModelsWithoutCards(
  project: CircuitProject,
  document: SchematicDocument,
  instances: readonly DesignNetlistInstance[],
  deckSources: readonly string[] | undefined,
  diagnostics: NetlistDiagnostic[],
): void {
  const run = deckSources !== undefined;
  const loaded = [
    ...(deckSources ?? []),
    ...(project.modelSources ?? []).flatMap((source) =>
      source.files.map((file) => file.text),
    ),
  ];
  const byModel = new Map<string, DesignNetlistInstance[]>();
  for (const part of instances) {
    if (!part.target || !namesModelOutside(project, document, part)) continue;
    if (run && reviewedExternalBindingForMaster(part.target)) continue;
    if (run && sourcesDefineModel(loaded, part.target)) continue;
    byModel.set(part.target, [...(byModel.get(part.target) ?? []), part]);
  }
  if (!byModel.size) return;
  // Each part where its sources put it, as the dependency list says: a
  // converted file's lines are the conversion's, so it is named alone.
  const files = new Map(
    (project.source?.files ?? []).map((file) => [file.id, file]),
  );
  const located = (part: { id: string; name: string }) => {
    const span = document.instances.find(
      (item) => item.id === part.id,
    )?.sourceRef;
    const file = span && files.get(span.fileId);
    if (!file) return part.name;
    return file.originalContent
      ? `${part.name} (${file.path})`
      : `${part.name} (${file.path}:${span.start.line})`;
  };
  const uses = [...byModel].map(([model, parts]) => {
    const names = namedParts(document, parts).map(located);
    return `${partList(names)} ${names.length === 1 ? "names" : "name"} ${model}`;
  });
  const models = [...byModel.keys()];
  const ids = [...byModel.values()].flat().map((part) => part.id);
  // A file of the run that includes another file (`.include`, `.lib FILE
  // SECTION`, Spectre `include`) may define them through it: say so, rather
  // than refuse a run that would work. A library's own `.lib tt` header
  // includes nothing.
  const includesLibrary = loaded.some((text) =>
    /^[ \t]*(?:\.?include|\.inc)[ \t]+\S|^[ \t]*\.lib[ \t]+\S+[ \t]+\S/imu.test(
      text,
    ),
  );
  if (run)
    diagnostic(
      diagnostics,
      document.id,
      "IMPORTED_MODEL_MISSING",
      includesLibrary
        ? `${partList(uses)}, which no card in the imported sources declares and no file of this run defines: unless a library this run includes defines ${models.length === 1 ? "it" : "them"}, add ${models.length === 1 ? "its model library" : "their model libraries"} to the simulation folder`
        : `${partList(uses)}, which no card in the imported sources declares and no file of this run defines: add ${models.length === 1 ? "its model library" : "their model libraries"} to the simulation folder`,
      ids,
      includesLibrary ? "warning" : "error",
    );
  else
    diagnostic(
      diagnostics,
      document.id,
      "IMPORTED_MODEL_EXTERNAL",
      `${partList(uses)}, which no card in the imported sources declares: the netlist keeps ${models.length === 1 ? "the reference" : "each reference"} and carries no card, so ${models.length === 1 ? "its model comes" : "their models come"} from the reader's library`,
      ids,
      "info",
    );
}

/**
 * Which MOS parts a netlist handed out names on the stand-in cards: one
 * finding for the Cell, information, as for its diodes and transistors.
 */
export function reportGenericMos(
  document: SchematicDocument,
  used: ReadonlyArray<{
    model: DesignNetlistModel;
    parts: readonly DesignNetlistInstance[];
  }>,
  diagnostics: NetlistDiagnostic[],
): void {
  const named = used.map(({ model, parts }) => ({
    name: carriedModelName(parts, model),
    parts: namedParts(document, parts),
  }));
  const uses = named.map(
    ({ name, parts }) =>
      `${partList(parts.map((part) => part.name))} ${parts.length === 1 ? "names" : "name"} ${name}`,
  );
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_MOS_MODEL",
    `${partList(uses)}, which the netlist defines with ${named.length === 1 ? "a stand-in model" : "stand-in models"}, BSIM4 with its defaults rather than any real device, so it reads back and runs in ngspice and Spectre; set a model for a real device before simulating`,
    named.flatMap(({ parts }) => parts.map((part) => part.id)),
    "info",
  );
}

/**
 * Which depletion MOS run on the generic cards, one finding for the Cell as
 * for its JFETs: information, since the netlist runs, but on stand-in
 * transistors, not on devices anyone chose.
 */
export function reportGenericDepletionMos(
  document: SchematicDocument,
  used: ReadonlyArray<{
    model: DesignNetlistModel;
    parts: readonly DesignNetlistInstance[];
  }>,
  diagnostics: NetlistDiagnostic[],
): void {
  const uses = used.map(({ model, parts }) => {
    const names = namedParts(document, parts).map((part) => part.name);
    const values = model.parameters
      .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
      .join(", ");
    return `${partList(names)} ${names.length === 1 ? "uses" : "use"} the generic depletion MOS model ${carriedModelName(parts, model)} (BSIM4, ${values})`;
  });
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_DEPLETION_MOS_MODEL",
    `${uses.join(", ")}; set a model for a real device`,
    used.flatMap(({ parts }) =>
      namedParts(document, parts).map((part) => part.id),
    ),
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
    values: model.parameters,
    name: carriedModelName(parts, model),
    parts: namedParts(document, parts),
  }));
  const uses = named.map(({ name, values, parts }) => {
    const parameters = values
      .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
      .join(", ");
    return `${partList(parts.map((part) => part.name))} ${parts.length === 1 ? "uses" : "use"} the generic bipolar model ${name} (${parameters})`;
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

/**
 * Which junction FETs run on the generic cards, one finding for the Cell as
 * for its bipolar transistors: information, since the netlist runs, but on
 * stand-in transistors, not on devices anyone chose.
 */
export function reportGenericJfets(
  document: SchematicDocument,
  used: ReadonlyArray<{
    model: DesignNetlistModel;
    parts: readonly DesignNetlistInstance[];
  }>,
  diagnostics: NetlistDiagnostic[],
): void {
  const uses = used.map(({ model, parts }) => {
    const names = namedParts(document, parts).map((part) => part.name);
    const values = model.parameters
      .map((parameter) => `${parameter.name}=${parameter.rawValue}`)
      .join(", ");
    return `${partList(names)} ${names.length === 1 ? "uses" : "use"} the generic JFET model ${carriedModelName(parts, model)} (${values})`;
  });
  diagnostic(
    diagnostics,
    document.id,
    "GENERIC_JFET_MODEL",
    `${uses.join(", ")}; set a model for a real device`,
    used.flatMap(({ parts }) =>
      namedParts(document, parts).map((part) => part.id),
    ),
    "info",
  );
}
