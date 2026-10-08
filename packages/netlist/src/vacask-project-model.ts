import type { ProjectModelSource, SourceSpan } from "@icm/model";
import {
  inspectSimulationSource,
  type SubcircuitStartStatement,
} from "@icm/spice";
import type { DesignNetlistCell, DesignNetlistInstance } from "./ir.js";
import type {
  PrintedProjectModelSource,
  ProjectModelSourceLocation,
} from "./project-model-source.js";
import type { SimulationSourceDiagnostic } from "./source-file-graph.js";
import {
  printVacaskWithLocations,
  vacaskIdentifier,
  vacaskProjectValue,
} from "./vacask-printer.js";
import { inspectVacaskSource } from "./vacask-source.js";
import { inspectModelSourceFile } from "./model-source-syntax.js";
import { parseNgspiceSourceParameters } from "./simulation-ngspice-source-parameters.js";
import { normalizeIndependentSource } from "./source-waveform.js";

/** A bounded, execution-only projection. Native ownership is never replaced by
 * imported schematic geometry or a relabelled opaque library. */
export function projectVacaskModel(
  source: ProjectModelSource,
  expanded: PrintedProjectModelSource,
  reservedNames: Iterable<string> = [],
  nativeEntries: readonly SubcircuitStartStatement[] = [],
):
  | { ok: true; rendered: PrintedProjectModelSource }
  | { ok: false; diagnostics: SimulationSourceDiagnostic[] } {
  const parsed = inspectSimulationSource(
    {
      id: source.entry,
      path: source.entry,
      text: expanded.text,
      hash: "",
      encoding: "utf-8",
    },
    false,
  );
  const diagnostics: SimulationSourceDiagnostic[] = [];
  const nativeFiles = new Map(
    source.files.map((file) => [
      file.path,
      inspectModelSourceFile(source.language, file.path, file.text).statements,
    ]),
  );
  const location = (span: SourceSpan) => {
    const segment = expanded.segments.find(
      (s) =>
        span.start.offset >= s.startOffset && span.start.offset < s.endOffset,
    );
    if (!segment)
      return {
        sourceId: source.id,
        revision: source.revision,
        path: source.entry,
        sourceOffset: 0,
        sourceLength: source.files.find((f) => f.path === source.entry)!.text
          .length,
      };
    return {
      sourceId: source.id,
      revision: source.revision,
      path: segment.path,
      sourceOffset: segment.derived
        ? segment.sourceOffset
        : segment.sourceOffset + span.start.offset - segment.startOffset,
      sourceLength: segment.derived
        ? (segment.sourceLength ?? 0)
        : span.end.offset - span.start.offset,
    };
  };
  const fail = (
    message: string,
    span: SourceSpan,
    nativeOwner?: ReturnType<typeof location>,
  ) => {
    const owner = nativeOwner ?? location(span);
    const text = source.files.find((f) => f.path === owner.path)!.text;
    const prefix = text.slice(0, owner.sourceOffset);
    const start = {
      offset: owner.sourceOffset,
      line: prefix.split("\n").length,
      column: owner.sourceOffset - prefix.lastIndexOf("\n"),
    };
    diagnostics.push({
      code: "MODEL_SOURCE_DIALECT",
      severity: "error",
      message,
      path: owner.path,
      sourceRef: { fileId: owner.path, start, end: start },
      modelSource: { sourceId: source.id, revision: source.revision },
    });
  };
  const nativeSpectre = (span: SourceSpan) => {
    if (source.language !== "spectre") return false;
    const owner = location(span);
    const native = nativeFiles
      .get(owner.path)
      ?.find(
        (s) =>
          owner.sourceOffset >= s.sourceRef.start.offset &&
          owner.sourceOffset < s.sourceRef.end.offset,
      );
    return native?.sourceLanguage !== "spice";
  };
  for (const diagnostic of parsed.diagnostics)
    if (diagnostic.severity === "error")
      fail(diagnostic.message, diagnostic.sourceRef!);
  const declarations = new Map(
    parsed.statements.flatMap((s) =>
      s.kind === "subckt_start" ? [[s.name.toLowerCase(), s] as const] : [],
    ),
  );
  const names = new Set<string>();
  for (const statement of parsed.statements)
    if (statement.kind === "subckt_start") {
      if (names.has(statement.name.toLowerCase()))
        fail(
          `Subcircuit ${statement.name} collides after SPICE projection`,
          statement.sourceRef,
        );
      names.add(statement.name.toLowerCase());
    }
  const cells: DesignNetlistCell[] = [];
  const spans = new Map<string, SourceSpan>();
  const parameterOwners = new Map<string, ReturnType<typeof location>>();
  let current: DesignNetlistCell | undefined;
  for (const statement of parsed.statements) {
    if (statement.kind === "subckt_start") {
      current = {
        id: statement.name,
        name: statement.name,
        ports: statement.ports.map((name) => ({
          id: name,
          name,
          netName: name,
        })),
        nets: [],
        instances: [],
        formalParameters: statement.parameters.map((p) => ({
          name: p.name,
          defaultValue: p.rawText,
        })),
      };
      cells.push(current);
      spans.set(current.id, statement.sourceRef);
      // Spectre defaults reside on separate native statements even though the
      // strict SPICE bridge folds them into a subcircuit header.
      const owner = location(statement.sourceRef);
      const native = nativeEntries.find(
        (entry) => entry.name === statement.name,
      );
      if (native) {
        for (const p of native.parameters)
          parameterOwners.set(
            JSON.stringify([current.id, p.name.toLowerCase()]),
            {
              ...owner,
              path: p.sourceRef.fileId,
              sourceOffset: p.sourceRef.start.offset,
              sourceLength: p.sourceRef.end.offset - p.sourceRef.start.offset,
            },
          );
      }
      if (
        statement.parameters.some((p) =>
          ["m", "$mfactor"].includes(p.name.toLowerCase()),
        )
      )
        fail(
          "External formal m needs an explicit native multiplicity contract",
          statement.sourceRef,
        );
    } else if (statement.kind === "subckt_end") current = undefined;
    else if (statement.kind === "instance" && current) {
      const supported = [
        "resistor",
        "capacitor",
        "inductor",
        "voltage-source",
        "current-source",
        "vcvs",
        "vccs",
        "cccs",
        "ccvs",
        "subcircuit",
      ];
      if (!supported.includes(statement.family)) {
        fail(
          `External ${statement.family} needs a qualified native VACASK mapping`,
          statement.sourceRef,
        );
        continue;
      }
      const target = statement.master
        ? declarations.get(statement.master.toLowerCase())
        : undefined;
      if (statement.family === "subcircuit" && !target) {
        fail(
          `External call ${statement.master} is not defined in this owned closure`,
          statement.sourceRef,
        );
        continue;
      }
      if (
        target &&
        nativeSpectre(statement.sourceRef) &&
        statement.master !== target.name
      ) {
        fail(
          `Native Spectre master ${statement.master} does not match ${target.name}`,
          statement.sourceRef,
        );
        continue;
      }
      const allowed =
        statement.family === "subcircuit"
          ? target!.parameters.map((p) => p.name.toLowerCase())
          : ["voltage-source", "current-source"].includes(statement.family)
            ? ["value", "dc", "m"]
            : ["vcvs", "vccs", "cccs", "ccvs"].includes(statement.family)
              ? ["gain", "m"]
              : ["value", "m"];
      if (target && statement.nodes.length !== target.ports.length) {
        fail(
          `External call ${statement.name} has ${statement.nodes.length} nodes, but ${target.name} declares ${target.ports.length} ports`,
          statement.sourceRef,
        );
        continue;
      }
      if (
        statement.parameters.some(
          (p) =>
            !allowed.includes(p.name.toLowerCase()) ||
            (target &&
              nativeSpectre(statement.sourceRef) &&
              !target.parameters.some((formal) => formal.name === p.name)),
        )
      ) {
        fail(
          `Unqualified external parameters on ${statement.name}`,
          statement.sourceRef,
        );
        continue;
      }
      const node = (name: string) =>
        current!.ports.find((p) => p.name.toLowerCase() === name.toLowerCase())
          ?.name ?? name.toLowerCase();
      const card: DesignNetlistInstance = {
        id: statement.name,
        reference: statement.name,
        invocationKind:
          statement.family === "subcircuit" ? "subcircuit" : "primitive",
        deviceClass:
          statement.family === "subcircuit"
            ? "hierarchical"
            : (statement.family as DesignNetlistInstance["deviceClass"]),
        target: target?.name ?? null,
        nodes: statement.nodes.map((n, i) => ({
          pinName: String(i),
          netName: node(n),
        })),
        parameters: statement.parameters.map((p) => ({
          name:
            statement.family === "vccs" && p.name.toLowerCase() === "gain"
              ? "gm"
              : statement.family === "ccvs" && p.name.toLowerCase() === "gain"
                ? "rm"
                : p.name,
          rawValue: p.rawText,
        })),
        ...(statement.controlSource
          ? { controlSourceReference: statement.controlSource }
          : {}),
      };
      if (["voltage-source", "current-source"].includes(card.deviceClass)) {
        const body = statement.parameters
          .filter((p) => p.name.toLowerCase() !== "m")
          .map((p) =>
            p.name.toLowerCase() === "dc" &&
            !/^(PULSE|SIN|PWL)\s*\(/iu.test(p.rawText)
              ? `DC ${p.rawText}`
              : p.rawText,
          )
          .join(" ");
        const parsedSource = parseNgspiceSourceParameters(body, {
          requireDc: false,
        });
        if (!parsedSource.ok) {
          fail(parsedSource.message, statement.sourceRef);
          continue;
        }
        card.parameters = [
          ...Object.entries(parsedSource.parameters).map(
            ([name, rawValue]) => ({ name, rawValue }),
          ),
          ...card.parameters.filter((p) => p.name.toLowerCase() === "m"),
        ];
      }
      current.instances.push(card);
      spans.set(JSON.stringify([current.id, card.id]), statement.sourceRef);
    } else {
      fail(
        `External ${statement.kind} is not supported by the bounded VACASK projection`,
        statement.sourceRef,
      );
    }
  }
  for (const cell of cells) {
    const declaration = spans.get(cell.id)!;
    const parameterNames = new Map(
      (cell.formalParameters ?? []).map((p) => [p.name.toLowerCase(), p.name]),
    );
    const checkScalar = (
      raw: string,
      span: SourceSpan,
      owner?: ReturnType<typeof location>,
    ) => {
      try {
        const value = vacaskProjectValue(raw);
        const tokens =
          inspectVacaskSource("scalar", value, false).statements[0]?.tokens ??
          [];
        for (const [index, token] of tokens.entries())
          if (
            token.kind === "word" &&
            /^[A-Za-z_$]/u.test(token.value) &&
            tokens[index + 1]?.value !== "("
          ) {
            const declared = parameterNames.get(token.value.toLowerCase());
            if (!declared || (nativeSpectre(span) && token.value !== declared))
              fail(
                `Parameter ${token.value} is not declared in this native scope`,
                span,
                owner,
              );
          }
      } catch (error) {
        fail(
          error instanceof Error ? error.message : String(error),
          span,
          owner,
        );
      }
    };
    for (const p of cell.formalParameters ?? [])
      if (p.defaultValue !== undefined)
        checkScalar(
          p.defaultValue,
          declaration,
          parameterOwners.get(JSON.stringify([cell.id, p.name.toLowerCase()])),
        );
    const seen = new Set<string>();
    for (const card of cell.instances) {
      const span = spans.get(JSON.stringify([cell.id, card.id]))!;
      for (const p of card.parameters) {
        if (p.name === "waveform") continue;
        if (p.name === "pwlPoints") {
          const waveform = normalizeIndependentSource(
            card.parameters,
          ).transient;
          if (waveform.kind === "pwl")
            for (const point of waveform.points) {
              checkScalar(point.time, span);
              checkScalar(point.value, span);
            }
        } else checkScalar(p.rawValue, span);
      }
      if (["voltage-source", "current-source"].includes(card.deviceClass)) {
        const source = normalizeIndependentSource(card.parameters);
        if (source.dc !== undefined && source.transient.kind !== "dc") {
          const transient = source.transient;
          try {
            const bias =
              transient.kind === "sin"
                ? vacaskProjectValue(transient.phase) === "0"
                  ? transient.offset
                  : undefined
                : transient.kind === "pulse"
                  ? transient.low
                  : transient.points[0]?.time &&
                      vacaskProjectValue(transient.points[0].time) === "0"
                    ? transient.points[0]?.value
                    : undefined;
            if (
              bias === undefined ||
              vacaskProjectValue(source.dc) !== vacaskProjectValue(bias)
            )
              fail(
                "Independent DC bias differs from native waveform bias; use ngspice or explicit native bias control",
                span,
              );
          } catch (error) {
            fail(error instanceof Error ? error.message : String(error), span);
          }
        }
      }
      if (seen.has(card.reference.toLowerCase()))
        fail(`Duplicate external instance ${card.reference}`, span);
      seen.add(card.reference.toLowerCase());
      if (card.controlSourceReference) {
        const control = cell.instances.find(
          (i) =>
            i.reference.toLowerCase() ===
              card.controlSourceReference!.toLowerCase() &&
            i.deviceClass === "voltage-source",
        );
        if (
          !control ||
          (nativeSpectre(span) &&
            control.reference !== card.controlSourceReference)
        )
          fail(
            `Unresolved controlling voltage source ${card.controlSourceReference}`,
            span,
          );
        else card.controlSourceReference = control.reference;
      }
    }
  }
  if (!cells.length && !diagnostics.length) {
    const point = { offset: 0, line: 1, column: 1 };
    fail("External model has no subcircuit implementation", {
      fileId: source.entry,
      start: point,
      end: point,
    });
  }
  if (diagnostics.length) return { ok: false, diagnostics };
  const printed = printVacaskWithLocations(
    {
      topCellId: cells[0]!.id,
      cells,
      globals: [],
      externalMasters: cells.map((c) => ({
        id: c.id,
        name: c.name,
        terminals: [],
        formalParameters: c.formalParameters ?? [],
      })),
    },
    false,
    { reservedNames },
  );
  if (!printed.ok) {
    for (const d of printed.diagnostics)
      fail(
        d.message,
        spans.get(
          d.objectIds.length
            ? JSON.stringify([d.documentId, d.objectIds[0]])
            : d.documentId,
        )!,
      );
    return { ok: false, diagnostics };
  }
  const segments: ProjectModelSourceLocation[] = [];
  // Cell headers/defaults map to their declaration, cards to their native owner.
  // All converted spans are navigation-only: never reverse-write native bytes.
  for (const [index, cell] of cells.entries()) {
    const start = printed.text.indexOf(
      `subckt ${vacaskIdentifier(cell.name)} (`,
    );
    const end =
      index + 1 < cells.length
        ? printed.text.indexOf(
            `subckt ${vacaskIdentifier(cells[index + 1]!.name)} (`,
          )
        : printed.text.length;
    const cards = printed.instances.filter((i) => i.documentId === cell.id);
    let offset = start;
    const append = (
      from: number,
      to: number,
      span: SourceSpan,
      owner?: ReturnType<typeof location>,
    ) => {
      if (from < to)
        segments.push({
          ...(owner ?? location(span)),
          startOffset: from,
          endOffset: to,
          derived: true,
        });
    };
    for (const p of cell.formalParameters ?? []) {
      const parameterStart = printed.text.indexOf(
        `parameters ${vacaskIdentifier(p.name)}=`,
        offset,
      );
      if (parameterStart < offset || parameterStart >= end) continue;
      const parameterEnd = printed.text.indexOf("\n", parameterStart) + 1;
      append(offset, parameterStart, spans.get(cell.id)!);
      append(
        parameterStart,
        parameterEnd,
        spans.get(cell.id)!,
        parameterOwners.get(JSON.stringify([cell.id, p.name.toLowerCase()])),
      );
      offset = parameterEnd;
    }
    for (const card of cards) {
      append(offset, card.startOffset, spans.get(cell.id)!);
      append(
        card.startOffset,
        card.endOffset,
        spans.get(JSON.stringify([cell.id, card.instanceId]))!,
      );
      offset = card.endOffset;
    }
    append(offset, end, spans.get(cell.id)!);
  }
  return { ok: true, rendered: { text: printed.text, segments } };
}
