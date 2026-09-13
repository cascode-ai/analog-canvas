import {
  compileWireDraft,
  type WireCornerOrder,
  type WireDraftStep,
  type WireEndpointGeometry,
  type WireRoutingMode,
} from "@icm/edit-engine";

interface WireCornerShape {
  routingMode: WireRoutingMode;
  cornerOrder: WireCornerOrder;
  label: string;
}

/** Auto is the first orthogonal posture, not an extra stop before both axes. */
export function nextWireCornerShape(
  routingMode: WireRoutingMode,
  cornerOrder: WireCornerOrder,
  source: WireEndpointGeometry | null,
  steps: readonly WireDraftStep[],
): WireCornerShape {
  if (routingMode === "free") {
    return { routingMode: "orthogonal", cornerOrder: "auto", label: "auto" };
  }
  if (routingMode === "octilinear") {
    return { routingMode: "free", cornerOrder: "auto", label: "any angle" };
  }
  if (cornerOrder === "horizontal-first" || cornerOrder === "vertical-first") {
    return {
      routingMode: "octilinear",
      cornerOrder: "diagonal-first",
      label: "45° diagonal",
    };
  }

  // Auto carries the incoming authored leg; a fresh wire starts horizontally.
  // Compile the fixed prefix with the same planner instead of guessing from
  // the last pair of clicks (an implicit elbow may lie between them).
  let horizontalFirst = true;
  const lastStep = steps.at(-1);
  if (source && lastStep) {
    const { points } = compileWireDraft(
      source,
      {
        connection: {
          contactPoint: lastStep.point,
          gridLanding: lastStep.point,
          escapePath: [],
          outward: null,
        },
      },
      steps,
    );
    const last = points.at(-1);
    const previous = points.at(-2);
    if (previous && last) horizontalFirst = previous.y === last.y;
  }
  return horizontalFirst
    ? {
        routingMode: "orthogonal",
        cornerOrder: "vertical-first",
        label: "vertical first",
      }
    : {
        routingMode: "orthogonal",
        cornerOrder: "horizontal-first",
        label: "horizontal first",
      };
}
