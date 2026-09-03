import { Container } from "@cloudflare/containers";

/**
 * The Durable Object that owns one ngspice container (ADR 0055).
 *
 * The container's harness listens on 8080 (containers/ngspice/entrypoint.mjs)
 * and every run is self-contained, so the class adds nothing beyond the port
 * and how long an idle container stays warm. Ten minutes covers a person
 * iterating on a testbench; a container that sleeps wakes with a fresh disk.
 *
 * The routing module reads the binding as an optional `NGSPICE` namespace:
 * a deployment without the binding answers "not configured" instead of
 * failing, which is how production behaves until a release carries this.
 */
export class NgspiceContainer extends Container {
  override defaultPort = 8080;
  override sleepAfter = "10m";
}
