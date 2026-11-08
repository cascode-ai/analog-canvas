import { resolvePublicUiFeatureEnabled } from "../../deployment/public-ui-feature";

/**
 * Controls the human-facing analog Simulation workspace and authoring entry
 * points. Persisted simulation data and HTTP APIs are separate contracts and
 * deliberately do not depend on this build flag.
 */
function resolvePublicSimulationUiEnabled(input: {
  production: boolean;
  configured?: string;
}): boolean {
  return resolvePublicUiFeatureEnabled(input);
}

/**
 * Hosted simulation is the team's debugging tool (#2074): over the managed
 * transport only a team account sees the Simulate entry. A direct transport
 * runs on an executor the user or developer provides, so it stays open.
 */
export function simulationEntryVisible(input: {
  requested: boolean;
  transport: "managed" | "direct";
  teamAccount: boolean;
}): boolean {
  return input.requested && (input.transport === "direct" || input.teamAccount);
}

export const PUBLIC_SIMULATION_UI_ENABLED = resolvePublicSimulationUiEnabled({
  production: import.meta.env.PROD,
  configured: import.meta.env.VITE_ICM_SIMULATION_UI,
});
