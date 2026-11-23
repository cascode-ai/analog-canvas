import type { SimulationEnvironmentMetadata } from "@icm/spice-run";
import type { NgspiceBatchOutput, NgspiceBatchRequest } from "./ngspice-batch";

/** One run, sent from the page to the simulator's Worker. */
export interface BrowserNgspiceWorkerRequest {
  id: number;
  request: NgspiceBatchRequest;
}

/**
 * The Worker's answers for a run: `started` once the measured simulator is
 * about to run the deck (the deadline starts here), then `finished` or
 * `failed`; `not-ready` instead when the simulator cannot be loaded or does
 * not match its Profile.
 */
export type BrowserNgspiceWorkerReply =
  | { id: number; kind: "started"; environment: SimulationEnvironmentMetadata }
  | { id: number; kind: "finished"; output: NgspiceBatchOutput }
  | { id: number; kind: "failed"; message: string }
  | { id: number; kind: "not-ready"; message: string };
