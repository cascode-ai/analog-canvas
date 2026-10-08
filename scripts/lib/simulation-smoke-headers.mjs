/**
 * Headers for a hosted `/api/simulate` check. Running a simulation there
 * needs a signed-in account; the Production deploy instead makes a one-off
 * SIMULATION_SMOKE_TOKEN for its own checks and passes it in the environment.
 */
export function simulationSmokeHeaders(env = process.env) {
  return {
    "content-type": "application/json",
    ...(env.SIMULATION_SMOKE_TOKEN
      ? { authorization: `Bearer ${env.SIMULATION_SMOKE_TOKEN}` }
      : {}),
  };
}
