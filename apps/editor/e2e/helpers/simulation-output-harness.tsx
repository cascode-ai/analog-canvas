import type { ComponentProps } from "react";
import { createRoot } from "react-dom/client";

import { SimulationOutputResults } from "../../src/features/simulation/simulation-output-results";

export function mountSimulationOutputHarness(
  host: HTMLElement,
  props: ComponentProps<typeof SimulationOutputResults>,
) {
  createRoot(host).render(<SimulationOutputResults {...props} />);
}
