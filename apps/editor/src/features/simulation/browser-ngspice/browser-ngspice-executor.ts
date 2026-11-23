/**
 * The Executor for Profiles the editor runs on this computer: the Worker's
 * ngspice route (deck composition, Profile checks, run evaluation) in the
 * page, in front of ngspice in a Web Worker instead of the container.
 */
import { createHostedExecutor, type Executor } from "@icm/simulation-service";
import { routeNgspiceSimulationRequest } from "../../../../../../worker/simulation-ngspice";
import {
  createBrowserNgspiceRunner,
  type NgspiceWorker,
} from "./browser-ngspice-runner";

export function createBrowserNgspiceExecutor(
  createWorker: () => NgspiceWorker = () =>
    new Worker(new URL("./ngspice.worker.ts", import.meta.url), {
      type: "module",
      name: "ngspice",
    }) as unknown as NgspiceWorker,
): Executor {
  const runner = createBrowserNgspiceRunner(createWorker);
  return createHostedExecutor(
    (async (input, init) =>
      (await routeNgspiceSimulationRequest(
        new Request(new URL(String(input), "http://browser-ngspice"), init),
        { NGSPICE: { getByName: () => runner } },
      )) ??
      Response.json({ error: "not-found" }, { status: 404 })) as typeof fetch,
  );
}
