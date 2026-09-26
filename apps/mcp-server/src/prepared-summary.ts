import type { Prepared } from "@icm/simulation-service/contract";

/** Same projection for a standalone preparation and every batch item. */
export function preparedSummary(value: Prepared) {
  const {
    vectors,
    signalNames,
    signalTargets,
    outputs,
    deviceOperatingPoints,
    measurements,
    ...prepared
  } = value;
  const detailsArtifact = prepared.artifacts.find(
    (a) => a.name === "preparation.json",
  );
  // Never hide mappings on older Editors without a retrievable details file.
  if (!detailsArtifact) return value;
  return {
    ...prepared,
    projection: "summary",
    detailsArtifact,
    acquisition:
      "Mappings describe available vectors, not captured data. Native source controls save/write; check collected dataset signals.",
    counts: {
      vectors: vectors.length,
      signalNames: Object.keys(signalNames ?? {}).length,
      signalTargets: Object.keys(signalTargets ?? {}).length,
      outputs: outputs.length,
      deviceOperatingPoints: deviceOperatingPoints.length,
      measurements: measurements?.length ?? 0,
    },
  };
}
