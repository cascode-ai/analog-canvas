import { ProjectFormatError } from "./diagnostics.js";
import { rejectClosedBodyGeometry } from "./closed-body-envelope.js";
import {
  rejectDraftingArcs,
  rejectKeptDocumentStyle,
  rejectMemberNoConnect,
  rejectModelSelection,
  rejectOrderedSignals,
  rejectSignalMembers,
} from "./owned-project-file.js";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Whether any Cell symbol presentation in the file carries `field`. */
function hasCellSymbolField(
  project: Record<string, unknown>,
  field: "bodyBounds" | "artwork",
): boolean {
  const items = (value: unknown): Record<string, unknown>[] =>
    Array.isArray(value) ? value.filter(isRecord) : [];
  const presentationHasBody = (value: unknown) =>
    isRecord(value) && Object.hasOwn(value, field);
  const artworkHasBody = (value: unknown) =>
    isRecord(value) &&
    isRecord(value.generatedFrom) &&
    presentationHasBody(value.generatedFrom.presentation);
  return (
    items(project.documents).some(
      (document) =>
        isRecord(document.presentation) &&
        presentationHasBody(document.presentation.cellSymbol),
    ) ||
    items(project.externalSubcircuitDefinitions).some((definition) =>
      presentationHasBody(definition.presentation),
    ) ||
    items(project.componentDefinitions).some(artworkHasBody) ||
    items(project.modelSources).some(
      (source) =>
        isRecord(source.draft) &&
        items(source.draft.authoring).some(
          (candidate) =>
            presentationHasBody(candidate.presentation) ||
            artworkHasBody(candidate.lastValidArtwork) ||
            (isRecord(candidate.legacyRepair) &&
              artworkHasBody(candidate.legacyRepair.baseline)),
        ),
    )
  );
}

interface SchemaFeatureGate {
  readonly minVersion: number;
  readonly check: (parsed: Record<string, unknown>) => void;
}

/**
 * Declarative feature gates for older Project file schema versions.
 * Preserves historical check order and diagnostics while allowing files at the
 * latest gated schema version to bypass all legacy checks in a single branch.
 */
const LEGACY_SCHEMA_FEATURE_GATES: readonly SchemaFeatureGate[] = [
  {
    minVersion: 82,
    check: (parsed) => rejectClosedBodyGeometry(parsed),
  },
  {
    minVersion: 81,
    check: (parsed) => {
      if (!Array.isArray(parsed.documents)) return;
      for (const [index, item] of parsed.documents.entries()) {
        if (!isRecord(item)) continue;
        if (Object.hasOwn(item, "drawingOrder"))
          throw new ProjectFormatError([
            {
              code: "INVALID_PROJECT",
              message: "A drawing order requires Project schema 81",
              path: ["documents", index, "drawingOrder"],
            },
          ]);
        if (Array.isArray(item.instances))
          for (const [instanceIndex, instance] of item.instances.entries())
            if (isRecord(instance) && Object.hasOwn(instance, "bodyFill"))
              throw new ProjectFormatError([
                {
                  code: "INVALID_PROJECT",
                  message: "A symbol body fill requires Project schema 81",
                  path: [
                    "documents",
                    index,
                    "instances",
                    instanceIndex,
                    "bodyFill",
                  ],
                },
              ]);
      }
    },
  },
  {
    minVersion: 75,
    check: (parsed) => rejectSignalMembers(parsed),
  },
  {
    minVersion: 76,
    check: (parsed) => rejectOrderedSignals(parsed),
  },
  {
    minVersion: 77,
    check: (parsed) => rejectMemberNoConnect(parsed),
  },
  {
    minVersion: 78,
    check: (parsed) => {
      if (
        Array.isArray(parsed.documents) &&
        parsed.documents.some(
          (document: unknown) =>
            isRecord(document) &&
            isRecord(document.presentation) &&
            Object.hasOwn(document.presentation, "crossingStyle"),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "Wire hops require Project schema 78",
            path: ["documents"],
          },
        ]);
    },
  },
  {
    minVersion: 74,
    check: (parsed) => {
      if (hasCellSymbolField(parsed, "bodyBounds"))
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "An explicit Cell symbol body requires Project schema 74",
            path: ["schemaVersion"],
          },
        ]);
    },
  },
  {
    minVersion: 80,
    check: (parsed) => {
      if (hasCellSymbolField(parsed, "artwork"))
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message:
              "A Cell's custom symbol artwork requires Project schema 80",
            path: ["schemaVersion"],
          },
        ]);
    },
  },
  {
    minVersion: 73,
    check: (parsed) => {
      if (
        Array.isArray(parsed.documents) &&
        parsed.documents.some(
          (document: unknown) =>
            isRecord(document) &&
            Array.isArray(document.junctions) &&
            document.junctions.some(
              (junction: unknown) =>
                isRecord(junction) &&
                (Object.hasOwn(junction, "styleOverride") ||
                  Object.hasOwn(junction, "contactAnchor") ||
                  junction.role === "style-anchor"),
            ),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            path: ["documents"],
            message: "Junction colors require Project schema 73",
          },
        ]);
    },
  },
  {
    minVersion: 72,
    check: (parsed) => {
      if (
        Array.isArray(parsed.documents) &&
        parsed.documents.some(
          (document: unknown) =>
            isRecord(document) &&
            isRecord(document.presentation) &&
            Object.hasOwn(document.presentation, "textFace"),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "A Document font requires Project schema 72",
            path: ["documents"],
          },
        ]);
    },
  },
  {
    minVersion: 79,
    check: (parsed) => {
      if (
        Array.isArray(parsed.documents) &&
        parsed.documents.some(
          (document: unknown) =>
            isRecord(document) &&
            isRecord(document.presentation) &&
            Object.hasOwn(document.presentation, "textFace") &&
            document.presentation.textFace !== "serif",
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message:
              "A Document font other than the serif requires Project schema 79",
            path: ["documents"],
          },
        ]);
    },
  },
  {
    minVersion: 71,
    check: (parsed) => {
      if (
        Array.isArray(parsed.modelSources) &&
        parsed.modelSources.some(
          (source) =>
            isRecord(source) &&
            isRecord(source.draft) &&
            Array.isArray(source.draft.authoring) &&
            source.draft.authoring.some(
              (candidate) =>
                isRecord(candidate) &&
                Object.hasOwn(candidate, "artworkInitialized"),
            ),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "Custom artwork initialization requires Project schema 71",
            path: ["modelSources"],
          },
        ]);
    },
  },
  {
    minVersion: 68,
    check: (parsed) => {
      if (
        Object.hasOwn(parsed, "componentAuthoringDrafts") ||
        (Array.isArray(parsed.modelSources) &&
          parsed.modelSources.some(
            (source) =>
              isRecord(source) &&
              isRecord(source.draft) &&
              Object.hasOwn(source.draft, "authoring"),
          ))
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "Component authoring drafts require Project schema 68",
            path: ["schemaVersion"],
          },
        ]);
    },
  },
  {
    minVersion: 67,
    check: (parsed) => {
      if (
        Array.isArray(parsed.modelSources) &&
        parsed.modelSources.some(
          (s: unknown) =>
            isRecord(s) &&
            (s.language === "spectre" ||
              (isRecord(s.draft) && Object.hasOwn(s.draft, "language"))),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "Native model languages require Project schema 67",
            path: ["modelSources"],
          },
        ]);
    },
  },
  {
    minVersion: 66,
    check: (parsed) => {
      if (
        Object.hasOwn(parsed, "modelSources") ||
        (Array.isArray(parsed.externalSubcircuitDefinitions) &&
          parsed.externalSubcircuitDefinitions.some(
            (d: unknown) => isRecord(d) && Object.hasOwn(d, "implementation"),
          ))
      ) {
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message:
              "Project model source ownership requires Project schema 66",
            path: ["modelSources"],
          },
        ]);
      }
    },
  },
  {
    minVersion: 69,
    check: (parsed) => {
      if (
        [
          parsed.componentDefinitions,
          parsed.externalSubcircuitDefinitions,
        ].some(
          (definitions) =>
            Array.isArray(definitions) &&
            definitions.some(
              (definition: unknown) =>
                isRecord(definition) &&
                Object.hasOwn(definition, "libraryOrigin"),
            ),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "Component library provenance requires Project schema 69",
            path: ["componentDefinitions"],
          },
        ]);
    },
  },
  {
    minVersion: 70,
    check: (parsed) => {
      if (
        Array.isArray(parsed.documents) &&
        parsed.documents.some(
          (document: unknown) =>
            isRecord(document) && Object.hasOwn(document, "inductorCouplings"),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "Inductor couplings require Project schema 70",
            path: ["documents"],
          },
        ]);
    },
  },
  {
    minVersion: 64,
    check: (parsed) => rejectKeptDocumentStyle(parsed),
  },
  {
    minVersion: 84,
    check: (parsed) => {
      if (
        Array.isArray(parsed.documents) &&
        parsed.documents.some(
          (document) =>
            isRecord(document) && document.instanceGroups !== undefined,
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            message: "Instance groups require Project schema 84",
            path: ["documents"],
          },
        ]);
    },
  },
  {
    minVersion: 85,
    check: (parsed) => rejectModelSelection(parsed),
  },
  {
    minVersion: 86,
    check: (parsed) => {
      if (
        Array.isArray(parsed.documents) &&
        parsed.documents.some(
          (document) =>
            isRecord(document) &&
            Array.isArray(document.instanceGroups) &&
            document.instanceGroups.some(
              (group: unknown) =>
                isRecord(group) && Object.hasOwn(group, "referencePrefix"),
            ),
        )
      )
        throw new ProjectFormatError([
          {
            code: "INVALID_PROJECT",
            path: ["documents"],
            message: "An array reference prefix requires Project schema 86",
          },
        ]);
    },
  },
  {
    minVersion: 87,
    check: (parsed) => rejectDraftingArcs(parsed),
  },
];

const MAX_GATED_SCHEMA_VERSION = LEGACY_SCHEMA_FEATURE_GATES.reduce(
  (highest, gate) => (gate.minVersion > highest ? gate.minVersion : highest),
  0,
);

export function enforceLegacySchemaFeatureGates(
  parsed: Record<string, unknown>,
  sourceSchemaVersion: number,
): void {
  if (sourceSchemaVersion >= MAX_GATED_SCHEMA_VERSION) return;
  for (const gate of LEGACY_SCHEMA_FEATURE_GATES) {
    if (sourceSchemaVersion < gate.minVersion) gate.check(parsed);
  }
}
