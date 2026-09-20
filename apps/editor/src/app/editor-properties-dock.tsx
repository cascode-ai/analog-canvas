import { lazy, Suspense, type ComponentProps, type RefObject } from "react";

import { ToolIcon } from "../features/editor-shell/tool-icon";
import { PlacementTrayPanel } from "../features/component-insert/placement-tray-panel";
import { CellSymbolLayoutProperties } from "../features/properties/component-structure-properties";
import { ComponentIdentityProperties } from "../features/properties/component-identity-properties";
import { NetNameProperties } from "../features/properties/net-name-properties";
import { PortLabelFormatProperties } from "../features/properties/port-label-format-properties";
import {
  AnnotationActionsSection,
  EndpointActionsSection,
  GroupPropertiesSection,
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

// Load selection-only editors when their Properties section is opened.
const ComponentPropertyCodeEditor = lazy(() =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.ComponentPropertyCodeEditor,
  })),
);
const AnnotationColorProperties = lazy(() =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.AnnotationColorProperties,
  })),
);
const DraftingPropertiesPanel = lazy(() =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.DraftingPropertiesPanel,
  })),
);
const DocumentSettingsSection = lazy(() =>
  import("../features/properties/property-editors").then((module) => ({
    default: module.DocumentSettingsSection,
  })),
);

interface ComponentPropertiesModel {
  code: ComponentProps<typeof ComponentPropertyCodeEditor>;
  cellSymbolLayout: ComponentProps<typeof CellSymbolLayoutProperties> | null;
  identity: ComponentProps<typeof ComponentIdentityProperties>;
  signalFlow: boolean;
  parameters: NonNullable<
    ComponentProps<typeof ComponentPropertyCodeEditor>["details"]
  >["parameters"];
}

export interface EditorPropertiesDockProps {
  open: boolean;
  shelfRef: RefObject<HTMLButtonElement | null>;
  onToggle: () => void;
  summary: string;
  hasInspectableSelection: boolean;
  agentIndicator: { status: string; terminal: boolean } | null;
  documentSettings: ComponentProps<typeof DocumentSettingsSection> | null;
  portLabelFormat: ComponentProps<typeof PortLabelFormatProperties>;
  mosBulk: ComponentProps<typeof MosBulkConnectionSection>;
  routingGuidance: ComponentProps<typeof RoutingGuidanceSection>;
  groupProperties: ComponentProps<typeof GroupPropertiesSection>;
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
  portLabelFormat,
  mosBulk,
  routingGuidance,
  groupProperties,
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
          <>
            {documentSettings ? (
              <Suspense fallback={<p role="status">Loading properties…</p>}>
                <DocumentSettingsSection {...documentSettings} />
              </Suspense>
            ) : null}
            <PortLabelFormatProperties
              key={portLabelFormat.documentId}
              {...portLabelFormat}
            />
            <MosBulkConnectionSection {...mosBulk} />
            <RoutingGuidanceSection {...routingGuidance} />
            {!hasInspectableSelection ? (
              <p className="inspect-empty">Select an object to inspect.</p>
            ) : null}
            <GroupPropertiesSection {...groupProperties} />
            {component ? (
              <section
                className="property-section component-properties"
                aria-label="Component properties"
              >
                <Suspense fallback={<p role="status">Loading properties…</p>}>
                  <ComponentPropertyCodeEditor
                    key={component.code.instance.id}
                    {...component.code}
                    details={{
                      parameters: component.parameters,
                      ...(component.identity.modelTarget
                        ? { modelTarget: component.identity.modelTarget }
                        : {}),
                      signalFlow: component.signalFlow,
                    }}
                  />
                </Suspense>
                {component.cellSymbolLayout ? (
                  <CellSymbolLayoutProperties {...component.cellSymbolLayout} />
                ) : null}
                {component.identity.propertyTerminal ? (
                  <ComponentIdentityProperties
                    {...component.identity}
                    fieldsMovedToCode
                  />
                ) : null}
              </section>
            ) : null}
            {!groupProperties.active && annotationText ? (
              <Suspense fallback={<p role="status">Loading properties…</p>}>
                <AnnotationColorProperties
                  key={annotationText.annotation.id}
                  {...annotationText}
                />
              </Suspense>
            ) : null}
            {!groupProperties.active && netName ? (
              <NetNameProperties {...netName} />
            ) : null}
            {!groupProperties.active && drafting ? (
              <Suspense fallback={<p role="status">Loading properties…</p>}>
                <DraftingPropertiesPanel
                  key={drafting.object.id}
                  {...drafting}
                />
              </Suspense>
            ) : null}
            <PlacementTrayPanel {...placementTray} />
            {!groupProperties.active ? (
              <>
                <RouteActionsSection {...routeActions} />
                <EndpointActionsSection {...endpointActions} />
                <AnnotationActionsSection {...annotationActions} />
              </>
            ) : null}
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
          </>
        </div>
      </section>
    </aside>
  );
}
