import type { Executor } from "@icm/simulation-service";
import hostedProfile from "../../../../../containers/ngspice/hosted-sky130-profile.json" with { type: "json" };

/** The Profiles whose runs the editor can keep on this computer. */
const BROWSER_PROFILE_IDS: readonly string[] = [hostedProfile.id];

/**
 * Whether this build runs those Profiles in the browser: on unless the build
 * says `VITE_ICM_BROWSER_SIMULATION=disabled`, as the browser-test editor
 * does so its specs answer every run themselves.
 */
export const BROWSER_SIMULATION_ENABLED =
  import.meta.env.VITE_ICM_BROWSER_SIMULATION !== "disabled";

export interface SimulationExecutorOptions {
  fetch?: typeof fetch;
  /** Explicit deployment composition; never inferred after a start fails. */
  transport?: "direct" | "managed";
  /**
   * Run the Profiles the editor can simulate itself (the hosted SKY130
   * ngspice Profile) on this computer, in the browser. Every other Profile
   * stays on the deployment's executor. Agents leave it off.
   */
  browserExecution?: boolean;
}

/**
 * One session's Executor, made on first use: the deployment's (managed or
 * direct), with the in-browser Profiles routed to this computer when asked.
 * A failed load is not remembered, so the next operation tries again.
 */
export function simulationExecutor(
  options: SimulationExecutorOptions,
): () => Promise<Executor> {
  let executor: Promise<Executor> | undefined;
  return () =>
    (executor ??= (async () => {
      const service = await import("@icm/simulation-service");
      const fetcher =
        options.fetch ??
        ((...args: Parameters<typeof fetch>) => globalThis.fetch(...args));
      const hosted =
        options.transport === "managed"
          ? service.createManagedHostedExecutor({ fetch: fetcher })
          : service.createHostedExecutor(fetcher);
      if (!options.browserExecution) return hosted;
      const browser =
        await import("./browser-ngspice/browser-ngspice-executor");
      return service.createProfileRoutedExecutor(
        {
          profileIds: BROWSER_PROFILE_IDS,
          executor: browser.createBrowserNgspiceExecutor(),
        },
        hosted,
      );
    })().catch((error: unknown) => {
      executor = undefined;
      throw error;
    }));
}

/** Whether a Profile's runs stay on this computer under these options. */
export function runsInBrowser(
  options: Pick<SimulationExecutorOptions, "browserExecution">,
  profileId: string | undefined,
): boolean {
  return (
    !!options.browserExecution &&
    profileId !== undefined &&
    BROWSER_PROFILE_IDS.includes(profileId)
  );
}
