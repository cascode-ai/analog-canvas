import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";

import { SimulationSpecResults } from "../../src/features/simulation/simulation-spec-results";

export function mountSimulationOutputHarness(
  host: HTMLElement,
  props: ComponentProps<typeof SimulationSpecResults>,
) {
  createRoot(host).render(<SimulationSpecResults {...props} />);
}
