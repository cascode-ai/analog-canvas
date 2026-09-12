import type { SchematicDocument } from "@icm/model";

import { ToolIcon } from "../editor-shell/tool-icon";
import { PropertyDisclosure } from "./property-disclosure";

type Instance = SchematicDocument["instances"][number];

export function ComponentPlacementProperties({
  instance,
  x,
  y,
  rotation,
  draftChanged,
  onXChange,
  onYChange,
  onRotate,
  onMirror,
  onReturnToTray,
  onSwapOutputs,
  onSwapContactStyle,
  onSwapInputs,
  onDiscard,
  geometryControls = true,
}: {
  instance: Instance;
  x: string;
  y: string;
  rotation: string;
  draftChanged: boolean;
  onXChange: (value: string) => void;
  onYChange: (value: string) => void;
  onRotate: () => void;
  onMirror: (direction: "left-right" | "top-bottom") => void;
  onReturnToTray: () => void;
  onSwapOutputs?: () => void;
  onSwapContactStyle?: { label: string; run: () => void };
  onSwapInputs?: () => void;
  onDiscard: () => void;
  /** The composed dock edits coordinates and orientation as property code. */
  geometryControls?: boolean;
}) {
  return (
    <>
      {instance.importProvenance ? (
        <div className="property-card" aria-label="Imported source evidence">
          <div className="property-section-heading">
            Imported source evidence
          </div>
          <small>
            {instance.importProvenance.kind}:{" "}
            {instance.importProvenance.sourceTarget}
          </small>
        </div>
      ) : null}
      {instance.placement ? (
        <PropertyDisclosure
          title={geometryControls ? "Placement" : "Actions"}
          className="property-placement-card"
          ariaLabel={
            geometryControls ? "Component placement" : "Component actions"
          }
          defaultOpen
        >
          {geometryControls ? (
            <div
              className="component-geometry-row property-placement-controls"
              aria-label="Component geometry"
            >
              <label className="property-coordinate-field">
                <span>X</span>
                <input
                  aria-label="Component X position"
                  inputMode="decimal"
                  value={x}
                  onChange={(event) => onXChange(event.currentTarget.value)}
                />
              </label>
              <label className="property-coordinate-field">
                <span>Y</span>
                <input
                  aria-label="Component Y position"
                  inputMode="decimal"
                  value={y}
                  onChange={(event) => onYChange(event.currentTarget.value)}
                />
              </label>
              <button
                type="button"
                className="property-placement-icon-button"
                aria-label={`Rotate component clockwise 45 degrees; current rotation ${rotation} degrees; shortcut R`}
                title={`Rotate 45° clockwise · current ${rotation}° (R)`}
                onClick={onRotate}
              >
                <ToolIcon name="rotate" />
              </button>
              <button
                type="button"
                className="property-placement-icon-button"
                aria-label="Mirror component left to right, Shift+R"
                title="Mirror left/right (Shift+R)"
                onClick={() => onMirror("left-right")}
              >
                <ToolIcon name="mirror-horizontal" />
              </button>
              <button
                type="button"
                className="property-placement-icon-button"
                aria-label="Mirror component top to bottom, Ctrl+R"
                title="Mirror top/bottom (Ctrl+R)"
                onClick={() => onMirror("top-bottom")}
              >
                <ToolIcon name="mirror-vertical" />
              </button>
            </div>
          ) : null}
          {instance.importProvenance ? (
            <button
              type="button"
              className="property-return-to-tray"
              aria-label="Return component to Placement Tray"
              onClick={onReturnToTray}
            >
              Return to tray
            </button>
          ) : null}
          {onSwapContactStyle ? (
            <div className="component-mirror-row" aria-label="Switch drawing">
              <button
                type="button"
                data-testid="swap-switch-contact-style"
                aria-label={onSwapContactStyle.label}
                title={onSwapContactStyle.label}
                onClick={onSwapContactStyle.run}
              >
                {onSwapContactStyle.label}
              </button>
            </div>
          ) : null}
          {onSwapOutputs || onSwapInputs ? (
            <div
              className="component-mirror-row property-amplifier-actions"
              aria-label="Amplifier placement actions"
            >
              {onSwapOutputs ? (
                <button
                  type="button"
                  data-testid="swap-differential-outputs"
                  aria-label="Swap the + and - outputs"
                  title="Swap the + and - outputs"
                  onClick={onSwapOutputs}
                >
                  Swap + / − outputs
                </button>
              ) : null}
              {onSwapInputs ? (
                <button
                  type="button"
                  data-testid="swap-differential-inputs"
                  aria-label="Swap the + and - inputs"
                  title="Swap + / - inputs (Ctrl+R)"
                  onClick={onSwapInputs}
                >
                  Swap + / − inputs
                </button>
              ) : null}
            </div>
          ) : null}
        </PropertyDisclosure>
      ) : null}
      {draftChanged ? (
        <button type="button" className="property-discard" onClick={onDiscard}>
          Discard changes
        </button>
      ) : null}
    </>
  );
}
