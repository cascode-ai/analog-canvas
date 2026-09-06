import { createEmptyDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import {
  logicalNetChoiceForNet,
  logicalNetChoices,
} from "./logical-net-choices";

describe("logical Net UI choices", () => {
  it("folds repeated Ground Base Nets into one selectable electrical Net", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      { id: "net-ground-a", terminals: [] },
      { id: "net-ground-b", terminals: [] },
    );
    document.connectivityEvidence.push(
      {
        id: "ground-a",
        kind: "name-claim",
        netId: "net-ground-a",
        owner: { kind: "power-marker", objectId: "GND1" },
        name: "0",
        scope: "global",
        powerDomain: "ground",
      },
      {
        id: "ground-b",
        kind: "name-claim",
        netId: "net-ground-b",
        owner: { kind: "power-marker", objectId: "GND2" },
        name: "0",
        scope: "global",
        powerDomain: "ground",
      },
    );

    const choices = logicalNetChoices(document);

    expect(choices).toEqual([
      {
        netId: "net-ground-a",
        label: "0",
        baseNetIds: ["net-ground-a", "net-ground-b"],
      },
    ]);
    expect(logicalNetChoiceForNet(choices, "net-ground-b")?.netId).toBe(
      "net-ground-a",
    );
  });

  it("disambiguates distinct local and global Nets with the same spelling", () => {
    const document = createEmptyDocument("main", "Main");
    document.nets.push(
      { id: "net-global", terminals: [] },
      { id: "net-local", terminals: [] },
    );
    document.connectivityEvidence.push(
      {
        id: "global-name",
        kind: "name-claim",
        netId: "net-global",
        owner: { kind: "net-label", annotationId: "global-label" },
        name: "BIAS",
        scope: "global",
      },
      {
        id: "local-name",
        kind: "name-claim",
        netId: "net-local",
        owner: { kind: "net-label", annotationId: "local-label" },
        name: "BIAS",
        scope: "local",
      },
    );

    expect(logicalNetChoices(document).map((choice) => choice.label)).toEqual([
      "BIAS · global",
      "BIAS · local",
    ]);
  });
});
