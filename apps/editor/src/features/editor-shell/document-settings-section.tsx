import type { SchematicDocument, StyleOverrides } from "@icm/model";
import { resolveDocumentLogicalNets } from "@icm/derived";

import {
  STYLE_KNOBS,
  STYLE_SCALE_OPTIONS,
  normalizedStyleOverrides,
  styleOverrideDraft,
} from "./style-knobs";

export interface DocumentSettingsSectionProps {
  document: SchematicDocument;
  onApplyStyle: (overrides: StyleOverrides | null) => void;
  onChangeBulkDefault: (kind: "nmos" | "pmos", netId: string | null) => void;
}

/**
 * Document-wide settings, docked beside the canvas rather than shown in a
 * modal: every knob here rescales what the canvas is drawing, so the result
 * has to stay visible while it is being adjusted.
 *
 * The MOS bulk defaults live here for the same reason they do not belong on a
 * transistor: one Net answers for every NMOS or PMOS in the Document.
 */
export function DocumentSettingsSection({
  document,
  onApplyStyle,
  onChangeBulkDefault,
}: DocumentSettingsSectionProps) {
  const draft = styleOverrideDraft(document.presentation.styleOverrides);
  const untouched = normalizedStyleOverrides(draft) === null;
  const logicalNets = resolveDocumentLogicalNets(document);

  return (
    <section className="context-actions" aria-label="Document settings">
      <h2>Document</h2>
      {STYLE_KNOBS.map((knob) => (
        <label key={knob.key}>
          {knob.label}
          <select
            aria-label={knob.label}
            value={String(draft[knob.key])}
            data-changed={draft[knob.key] === 1 ? undefined : "true"}
            onChange={(event) =>
              onApplyStyle(
                normalizedStyleOverrides({
                  ...draft,
                  [knob.key]: Number(event.currentTarget.value),
                }),
              )
            }
          >
            {STYLE_SCALE_OPTIONS.map((option) => (
              <option key={option} value={String(option)}>
                {option === 1 ? "Default (1×)" : `${option}×`}
              </option>
            ))}
          </select>
        </label>
      ))}
      <button
        type="button"
        data-testid="document-style-reset"
        onClick={() => onApplyStyle(null)}
        disabled={untouched}
      >
        Reset style to profile defaults
      </button>

      <label>
        Default NMOS bulk Net
        <select
          aria-label="Default NMOS bulk Net"
          value={document.mosBulkDefaults?.nmosNetId ?? ""}
          onChange={(event) =>
            onChangeBulkDefault("nmos", event.currentTarget.value || null)
          }
        >
          <option value="">None</option>
          {document.nets.map((net) => (
            <option key={net.id} value={net.id}>
              {logicalNets.byBaseNetId.get(net.id)?.name ?? net.id}
            </option>
          ))}
        </select>
      </label>
      <label>
        Default PMOS bulk Net
        <select
          aria-label="Default PMOS bulk Net"
          value={document.mosBulkDefaults?.pmosNetId ?? ""}
          onChange={(event) =>
            onChangeBulkDefault("pmos", event.currentTarget.value || null)
          }
        >
          <option value="">None</option>
          {document.nets.map((net) => (
            <option key={net.id} value={net.id}>
              {logicalNets.byBaseNetId.get(net.id)?.name ?? net.id}
            </option>
          ))}
        </select>
      </label>
    </section>
  );
}
