import { resolveAnnotationName } from "@icm/derived";
import type { SchematicEdit } from "@icm/edit-engine";
import { semanticTextDocument, type SchematicDocument } from "@icm/model";

import { snapCoordinate } from "../../snap/engine";
import type { ComponentPropertyCodeValue } from "./component-property-code";
import { instanceLabelAnnotationFor } from "../instance-display/default-instance-display";
import {
  NO_INTERNAL_MARK,
  symbolForInputPolarity,
  symbolForInputsSwapped,
  symbolForInternalMark,
  symbolForOutputsSwapped,
} from "./component-visual-variants";

type Instance = SchematicDocument["instances"][number];

function sameStyle(
  left: Instance["styleOverride"] | null,
  right: Instance["styleOverride"] | null,
): boolean {
  return (
    (left?.foreground ?? null) === (right?.foreground ?? null) &&
    (left?.background ?? null) === (right?.background ?? null)
  );
}

/**
 * Translate presentation code into the existing typed edit contract. Display
 * annotations are appended by the caller because they need the live Symbol
 * resolver and annotation policy.
 */
export function planComponentPropertyCodeEdits(
  document: SchematicDocument,
  instance: Instance,
  value: ComponentPropertyCodeValue,
): SchematicEdit[] {
  const edits: SchematicEdit[] = [];
  if (value.displayName !== undefined) {
    const label = instanceLabelAnnotationFor(document, instance.id);
    if (
      label?.kind === "instance-label" &&
      resolveAnnotationName(document, label).trim() !== value.displayName
    ) {
      if (label.binding?.kind === "instance-reference") {
        if (
          value.netlistName !== undefined &&
          value.netlistName !== instance.reference &&
          value.netlistName !== value.displayName
        )
          throw new Error(
            "name and netlistName must agree while the label follows its netlist name",
          );
        edits.push({
          kind: "set_instance_reference",
          instanceId: instance.id,
          reference: value.displayName,
        });
      } else {
        const {
          binding: _binding,
          content: _content,
          formatOverride: _formatOverride,
          ...presentation
        } = label;
        edits.push({
          kind: "upsert_schematic_annotation",
          annotation: {
            ...presentation,
            content: semanticTextDocument(value.displayName, "instance-label"),
          },
        });
      }
    }
  }
  if (
    value.netlistName !== undefined &&
    value.netlistName !== instance.reference &&
    !edits.some((edit) => edit.kind === "set_instance_reference")
  )
    edits.push({
      kind: "set_instance_reference",
      instanceId: instance.id,
      reference: value.netlistName,
    });
  if (value.parameters && instance.netlist) {
    const set = Object.fromEntries(
      Object.entries(value.parameters).filter(
        ([key, raw]) =>
          raw.trim() !== "" && raw !== instance.netlist!.parameters[key],
      ),
    );
    const unset = Object.keys(instance.netlist.parameters).filter(
      (key) => !(value.parameters![key] ?? "").trim(),
    );
    if (Object.keys(set).length || unset.length)
      edits.push({
        kind: "patch_instance_netlist_parameters",
        instanceId: instance.id,
        ...(Object.keys(set).length ? { set } : {}),
        ...(unset.length ? { unset } : {}),
      });
  }
  let nextSymbolId = value.symbol ?? instance.symbolId;
  if (value.appearance.internalMark !== undefined)
    nextSymbolId =
      symbolForInternalMark(nextSymbolId, value.appearance.internalMark) ??
      nextSymbolId;
  if (value.appearance.inputPolarity !== undefined)
    nextSymbolId =
      symbolForInputPolarity(nextSymbolId, value.appearance.inputPolarity) ??
      nextSymbolId;
  if (value.appearance.inputsSwapped !== undefined)
    nextSymbolId =
      symbolForInputsSwapped(nextSymbolId, value.appearance.inputsSwapped) ??
      nextSymbolId;
  if (value.appearance.outputsSwapped !== undefined)
    nextSymbolId =
      symbolForOutputsSwapped(nextSymbolId, value.appearance.outputsSwapped) ??
      nextSymbolId;
  if (nextSymbolId !== instance.symbolId)
    edits.push({
      kind: "set_instance_symbol",
      instanceId: instance.id,
      symbolId: nextSymbolId,
    });

  let nextSignalFlow = value.signalFlow;
  if (value.appearance.internalMark !== undefined) {
    nextSignalFlow = { ...(instance.signalFlowParameters ?? {}) };
    if (
      value.appearance.internalMark === NO_INTERNAL_MARK ||
      value.appearance.internalMark === "A"
    )
      delete nextSignalFlow.formula;
    else nextSignalFlow.formula = value.appearance.internalMark;
  }
  if (
    nextSignalFlow &&
    JSON.stringify(nextSignalFlow) !==
      JSON.stringify(instance.signalFlowParameters ?? {})
  )
    edits.push({
      kind: "set_instance_signal_flow_parameters",
      instanceId: instance.id,
      parameters: Object.keys(nextSignalFlow).length ? nextSignalFlow : null,
    });
  if (instance.placement && value.placement) {
    const position = {
      x: snapCoordinate(
        value.placement.coordinate[0],
        document.presentation.grid,
      ),
      y: snapCoordinate(
        value.placement.coordinate[1],
        document.presentation.grid,
      ),
    };
    if (
      position.x !== instance.placement.position.x ||
      position.y !== instance.placement.position.y
    ) {
      edits.push({ kind: "move_instance", instanceId: instance.id, position });
    }
    if (value.placement.rotation !== instance.placement.rotation) {
      edits.push({
        kind: "rotate_instance",
        instanceId: instance.id,
        rotation: value.placement.rotation,
      });
    }
    if (value.placement.mirror !== instance.placement.mirror) {
      edits.push({
        kind: "mirror_instance",
        instanceId: instance.id,
        mirror: value.placement.mirror,
      });
    }
  }

  const styleOverride = {
    ...(value.appearance.color === "auto"
      ? {}
      : { foreground: value.appearance.color }),
  };
  const nextStyle = Object.keys(styleOverride).length ? styleOverride : null;
  if (!sameStyle(instance.styleOverride ?? null, nextStyle)) {
    edits.push({
      kind: "set_instance_style_override",
      instanceId: instance.id,
      styleOverride: nextStyle,
    });
  }
  return edits;
}
