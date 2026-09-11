import type { SchematicEdit } from "@icm/edit-engine";
import type { SchematicDocument } from "@icm/model";

import { snapCoordinate } from "../../snap/engine";
import type { ComponentPropertyCodeValue } from "./component-property-code";

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
  if (instance.placement && value.placement) {
    const position = {
      x: snapCoordinate(value.placement.at[0], document.presentation.grid),
      y: snapCoordinate(value.placement.at[1], document.presentation.grid),
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
    ...(value.appearance.foreground === "auto"
      ? {}
      : { foreground: value.appearance.foreground }),
    ...(value.appearance.background === "auto"
      ? {}
      : { background: value.appearance.background }),
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
