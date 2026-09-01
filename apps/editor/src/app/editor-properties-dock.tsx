import { Suspense, type ComponentProps, type RefObject } from "react";

import { ToolIcon } from "../features/editor-shell/tool-icon";
import { DocumentSettingsSection } from "../features/editor-shell/document-settings-section";
import { PlacementTrayPanel } from "../features/component-insert/placement-tray-panel";
import {
  CellSymbolLayoutProperties,
  FormalPortProperties,
} from "../features/properties/component-structure-properties";
import { ComponentIdentityProperties } from "../features/properties/component-identity-properties";
import { ComponentElectricalProperties } from "../features/properties/component-electrical-properties";
import { ComponentSignalFlowProperties } from "../features/properties/component-signal-flow-properties";
import { ComponentPlacementProperties } from "../features/properties/component-placement-properties";
import { ComponentStyleProperties } from "../features/properties/component-style-properties";
import { AnnotationColorProperties } from "../features/properties/annotation-color-properties";
import { NetNameProperties } from "../features/properties/net-name-properties";
import { DraftingPropertiesPanel } from "../features/drafting/drafting-properties-panel";
import {
  AnnotationActionsSection,
  EndpointActionsSection,
  GroupDisplayToggles,
  MosBulkConnectionSection,
  RouteActionsSection,
  RoutingGuidanceSection,
} from "../features/selection/selection-context-actions";
import {
  NetTraceSection,
  ProjectDiagnosticsSection,
  SelectionInspectorDetails,
} from "../features/selection/selection-inspector-details";
import { LazyAgentPropertiesSection } from "./lazy-editor-dialogs";

interface ComponentPropertiesModel {
  formalPort: ComponentProps<typeof FormalPortProperties> | null;
  cellSymbolLayout: ComponentProps<typeof CellSymbolLayoutProperties> | null;
  identity: ComponentProps<typeof ComponentIdentityProperties>;
  signalFlow: ComponentProps<typeof ComponentSignalFlowProperties> | null;
  electrical: ComponentProps<typeof ComponentElectricalProperties>;
  style: ComponentProps<typeof ComponentStyleProperties>;
  placement: ComponentProps<typeof ComponentPlacementProperties>;
}

export interface EditorPropertiesDockProps {
  open: boolean;
  shelfRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  summary: string;
  hasInspectableSelection: boolean;
  agentIndicator: { status: string; terminal: boolean } | null;
  documentSettings: ComponentProps<typeof DocumentSettingsSection> | null;
  mosBulk: ComponentProps<typeof MosBulkConnectionSection>;
  routingGuidance: ComponentProps<typeof RoutingGuidanceSection>;
  groupDisplay: ComponentProps<typeof GroupDisplayToggles>;
  component: ComponentPropertiesModel | null;
  annotationText: ComponentProps<typeof AnnotationColorProperties> | null;
  netName: ComponentProps<typeof NetNameProperties> | null;
  drafting: ComponentProps<typeof DraftingPropertiesPanel> | null;
  placementTray: ComponentProps<typeof PlacementTrayPanel>;
  routeActions: ComponentProps<typeof RouteActionsSection>;
  endpointActions: ComponentProps<typeof EndpointActionsSection>;
  annotationActions: ComponentProps<typeof AnnotationActionsSection>;
  diagnostics: ComponentProps<typeof ProjectDiagnosticsSection>;
  netTrace: ComponentProps<typeof NetTraceSection> | null;
  importReview: ComponentProps<typeof SelectionInspectorDetails> | null;
  agent: ComponentProps<typeof LazyAgentPropertiesSection> | null;
}

/** Persistent Properties shelf and its cross-domain inspector sections. */
export function EditorPropertiesDock({
  open,
  shelfRef,
  onToggle,
  summary,
  hasInspectableSelection,
  agentIndicator,
  documentSettings,
  mosBulk,
  routingGuidance,
  groupDisplay,
  component,
  annotationText,
  netName,
  drafting,
  placementTray,
  routeActions,
  endpointActions,
  annotationActions,
  diagnostics,
  netTrace,
  importReview,
  agent,
}: EditorPropertiesDockProps) {
  return (
    <aside
      className={open ? "selection-dock open" : "selection-dock"}
      // Fit View insets the camera by the docks that float over the
      // canvas, so the drawing lands where it can be seen.
      data-canvas-overlay="true"
      aria-label="Properties"
      role="complementary"
    >
      <section className="selection-shelf" aria-label="Selection">
        <button
          type="button"
          ref={shelfRef}
          className="selection-shelf-header"
          data-testid="selection-shelf"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="selection-shelf-title">
            <ToolIcon name="inspect" />
            <span>Properties</span>
            {agentIndicator ? (
              <span
                className={`agent-shelf-indicator ${agentIndicator.terminal ? "terminal" : ""}`}
                title={`Agent: ${agentIndicator.status}`}
                aria-label={`Agent: ${agentIndicator.status}`}
              />
            ) : null}
          </span>
          <span className="selection-shelf-summary">
            {summary}
            {hasInspectableSelection ? (
              <span className="selection-shelf-indicator" aria-hidden="true" />
            ) : null}
          </span>
        </button>
        <div className="selection-panel" hidden={!open}>
          {documentSettings ? (
            <DocumentSettingsSection {...documentSettings} />
          ) : null}
          <MosBulkConnectionSection {...mosBulk} />
          <RoutingGuidanceSection {...routingGuidance} />
          {!hasInspectableSelection ? (
            <p className="inspect-empty">Select an object to inspect.</p>
          ) : null}
          <GroupDisplayToggles {...groupDisplay} />
          {component ? (
            <section
              className="property-section component-properties"
              aria-label="Component properties"
            >
              {component.formalPort ? (
                <FormalPortProperties {...component.formalPort} />
              ) : null}
              {component.cellSymbolLayout ? (
                <CellSymbolLayoutProperties {...component.cellSymbolLayout} />
              ) : null}
              <ComponentIdentityProperties {...component.identity} />
              {component.signalFlow ? (
                <ComponentSignalFlowProperties {...component.signalFlow} />
              ) : null}
              <ComponentElectricalProperties {...component.electrical} />
              <ComponentStyleProperties
                key={component.style.instance.id}
                {...component.style}
              />
              <ComponentPlacementProperties {...component.placement} />
            </section>
          ) : null}
          {annotationText ? (
            <AnnotationColorProperties
              key={annotationText.annotation.id}
              {...annotationText}
            />
          ) : null}
          {netName ? <NetNameProperties {...netName} /> : null}
          {drafting ? (
            <DraftingPropertiesPanel key={drafting.object.id} {...drafting} />
          ) : null}
          <PlacementTrayPanel {...placementTray} />
          <RouteActionsSection {...routeActions} />
          <EndpointActionsSection {...endpointActions} />
          <AnnotationActionsSection {...annotationActions} />
          <ProjectDiagnosticsSection {...diagnostics} />
          {netTrace ? <NetTraceSection {...netTrace} /> : null}
          {importReview ? (
            <section className="import-review" aria-label="Import Review">
              <h2>Import Review</h2>
              <SelectionInspectorDetails {...importReview} />
            </section>
          ) : null}
          <Suspense fallback={null}>
            {agent ? <LazyAgentPropertiesSection {...agent} /> : null}
          </Suspense>
        </div>
      </section>
    </aside>
  );
}
