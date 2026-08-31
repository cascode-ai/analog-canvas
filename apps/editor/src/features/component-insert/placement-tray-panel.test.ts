import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { placementTrayIdentity } from "./placement-tray-panel";

describe("placement tray panel", () => {
  it("uses formal Cell Pin identity without inventing a Reference", () => {
    const document = createEmptyDocument("cell", "Cell");
    const instance = {
      id: "pin-instance",
      symbolId: "port",
      placement: {
        position: { x: 0, y: 0 },
        rotation: 0 as const,
        mirror: "none" as const,
      },
    };
    document.instances.push(instance);
    document.netlist = {
      name: "Cell",
      terminals: [
        {
          id: "terminal",
          name: "VIN",
          netId: "net",
          direction: "input",
          interfaceInstanceIds: [instance.id],
        },
      ],
      formalParameters: [],
    };

    expect(placementTrayIdentity(document, instance)).toBe("VIN · port");
  });
});
