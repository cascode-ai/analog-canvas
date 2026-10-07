import { z } from "zod";
import {
  CellSymbolSideSchema,
  PointSchema,
  StableIdSchema,
  RichTextDocumentSchema,
  PlacementSchema,
  InstancePlacementRequestSchema,
  InstanceNetlistDataSchema,
  SignalFlowParametersSchema,
} from "@icm/model";

/** Small server-planned conveniences; results still commit as existing edits. */
export const AgentPinAnchorSchema = z
  .strictObject({
    pinName: z.string().min(1),
    position: PointSchema,
  })
  .describe(
    "Exact routing grid landing, not artwork contact. Unreachable positions are rejected with the nearest reachable landing.",
  );
const OptionalPinAnchorSchema = AgentPinAnchorSchema.optional().describe(
  "When supplied, solves the origin instead of using placement.position; keeps orientation.",
);
// Reuse schema identities so the full HTTP contract emits one definition per
// shared field shape; runtime constraints are unchanged.
const NameSchema = z.string().min(1).max(128);
const SelectedIdsSchema = z.array(StableIdSchema).max(256).default([]);
const NonemptyIdsSchema = z.array(StableIdSchema).min(1).max(256);
const SelectionSchema = z.strictObject({
  instanceIds: SelectedIdsSchema,
  routeIds: SelectedIdsSchema,
  junctionIds: SelectedIdsSchema,
  annotationIds: SelectedIdsSchema,
  draftingIds: SelectedIdsSchema,
});
const RouteNetCommandSchema = z.strictObject({
  kind: z.literal("route-net"),
  target: z
    .discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("net"), net: z.string().min(1) }),
      z.strictObject({
        kind: z.literal("member"),
        instanceId: StableIdSchema,
        pinName: z.string().min(1),
      }),
      z.strictObject({
        kind: z.literal("pins"),
        pins: z
          .array(
            z.strictObject({
              instanceId: StableIdSchema,
              pinName: z.string().min(1),
            }),
          )
          .min(2)
          .max(64),
      }),
      z.strictObject({
        kind: z.literal("import-net"),
        sourceNetId: StableIdSchema,
      }),
    ])
    .describe(
      "Current Net ID/name, member pin, explicit pins to join, or an original import-reference Net. Routes only missing visible connections.",
    ),
  trunk: z
    .strictObject({ start: PointSchema, end: PointSchema })
    .optional()
    .describe(
      "Straight horizontal/vertical trunk; otherwise use MST guidance. Atomic, not an obstacle autorouter.",
    ),
});
const TextInputSchema = z.union([
  z.string().min(1).max(256),
  RichTextDocumentSchema,
]);
const SelectionSchemaWithNoConnects = SelectionSchema.extend({
  noConnectIds: SelectedIdsSchema,
});
const BatchItemSchema = z.discriminatedUnion("kind", [
  z
    .strictObject({
      kind: z.literal("set-properties"),
      instanceId: StableIdSchema,
      reference: NameSchema.optional().describe(
        "The part's Reference; for a Cell Pin, the Pin's name.",
      ),
      parameters: z
        .strictObject({
          set: z
            .record(z.string().min(1), z.string().min(1).max(1024))
            .optional(),
          unset: z.array(z.string().min(1)).max(64).optional(),
        })
        .optional(),
      signalFlow: z
        .strictObject({
          formula: z.string().min(1).max(256).nullable().optional(),
          coefficient: z.string().min(1).max(64).nullable().optional(),
          bodyWidth: SignalFlowParametersSchema.shape.bodyWidth
            .unwrap()
            .nullable()
            .optional(),
          bodyHeight: SignalFlowParametersSchema.shape.bodyHeight
            .unwrap()
            .nullable()
            .optional(),
        })
        .optional()
        .describe("A formula block's drawing; null clears a field."),
      supplies: z
        .strictObject({
          VDD: StableIdSchema.nullable().optional(),
          VSS: StableIdSchema.nullable().optional(),
        })
        .optional()
        .describe("A block's supply Net by ID; null returns it to Auto."),
      control: InstanceNetlistDataSchema.shape.control
        .unwrap()
        .nullable()
        .optional()
        .describe("A controlled source's control; null clears it."),
      placement: z
        .strictObject({
          position: PointSchema.optional(),
          pinAnchor: AgentPinAnchorSchema.optional(),
          rotation: PlacementSchema.shape.rotation.optional(),
          mirror: PlacementSchema.shape.mirror.optional(),
          reflect: z
            .enum(["x", "y"])
            .optional()
            .describe("Reflect in place: y flips left-right, x top-bottom."),
        })
        .optional(),
    })
    .describe(
      "Change one part as Apply in Properties does, through the same planner: a moved part joins a pin it lands on, as a drag does.",
    ),
  z.strictObject({
    kind: z.literal("set-text"),
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("annotation"), id: StableIdSchema }),
      z.strictObject({ kind: z.literal("drafting"), id: StableIdSchema }),
    ]),
    text: TextInputSchema,
  }),
  z.strictObject({
    kind: z.literal("add-text"),
    id: StableIdSchema,
    position: PointSchema,
    text: TextInputSchema,
    alignment: z.enum(["start", "middle", "end"]).optional(),
    rotation: z
      .union([z.literal(0), z.literal(90), z.literal(180), z.literal(270)])
      .optional(),
  }),
  z
    .strictObject({
      kind: z.literal("arrange-instances"),
      instanceIds: z.array(StableIdSchema).min(2).max(256),
      axis: z.enum(["x", "y"]),
      coordinate: z.number().int().optional(),
    })
    .describe(
      "Line up part origins on one coordinate (the first part's when left out).",
    ),
  z
    .strictObject({
      kind: z.literal("disconnect-pin"),
      instanceId: StableIdSchema,
      pinName: z.string().min(1).max(128),
    })
    .describe(
      "Free one pin from its Net, as its menu does: Delete connection where wires end on it, Disconnect endpoint where none does.",
    ),
  z
    .strictObject({
      kind: z.literal("delete-selection"),
      selection: SelectionSchemaWithNoConnects,
    })
    .describe(
      "Explicit selection. Includes owned displays and formal interface declarations, and, as in the GUI, a wire that only tapped a deleted part into other wiring. Select all object IDs for complete Cell deletion.",
    ),
  // Several Cell instances place in one call and one undo, as place-components
  // places several built-in parts (#1231).
  z.strictObject({
    kind: z.literal("place-cell"),
    childDocumentId: StableIdSchema,
    instanceId: StableIdSchema,
    reference: NameSchema.optional().describe(
      "X and a number; omit it for the next free one, as the GUI names a Cell instance.",
    ),
    placement: PlacementSchema,
    pinAnchor: OptionalPinAnchorSchema,
  }),
  RouteNetCommandSchema,
  z
    .strictObject({
      kind: z.literal("move-junction"),
      junctionId: StableIdSchema,
      position: PointSchema,
    })
    .describe(
      "Move an existing Junction and reshape every incident Route atomically; preserve connectivity and respect protected geometry.",
    ),
  z.strictObject({
    kind: z.literal("set-port-direction"),
    target: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("terminal"), id: StableIdSchema }),
      z.strictObject({ kind: z.literal("port"), id: StableIdSchema }),
      z.strictObject({ kind: z.literal("port-name"), name: z.string().min(1) }),
    ]),
    direction: z.enum(["input", "output", "inout", "passive"]),
  }),
  z.strictObject({
    kind: z.literal("set-vdd-mode"),
    instanceId: StableIdSchema,
    mode: z.enum(["cell-pin", "global"]),
  }),
  z.strictObject({
    kind: z.literal("remove-cell-terminal"),
    terminalId: StableIdSchema,
  }),
  z
    .strictObject({
      kind: z.literal("set-display-alias"),
      instanceId: StableIdSchema,
      text: z.string().trim().min(1).max(128).nullable(),
    })
    .describe(
      "Show text on a part's name label while the part keeps its own Reference (or Pin name) in the netlist, e.g. an op-amp X1 drawn A1; null shows its own name again. Survives Project Code and Copy as the label's text.",
    ),
  z.strictObject({
    kind: z.literal("set-instance-display"),
    instanceIds: z.array(StableIdSchema).min(1).max(64),
    showReference: z.boolean().optional(),
    showValue: z.boolean().optional(),
    showParameters: z
      .strictObject({
        k: z.boolean().optional(),
        lp: z.boolean().optional(),
        ls: z.boolean().optional(),
        l1: z.boolean().optional(),
        l2: z.boolean().optional(),
        cb: z.boolean().optional(),
        // A MOS or BJT's multiplier, drawn "×8" with its name.
        m: z.boolean().optional(),
      })
      .optional(),
  }),
  z.strictObject({
    kind: z.literal("set-net-label"),
    annotationId: StableIdSchema,
    netId: StableIdSchema,
    text: RichTextDocumentSchema,
    position: PointSchema.optional(),
  }),
  z.strictObject({
    kind: z.literal("set-model"),
    instanceId: StableIdSchema,
    model: z.string().max(128),
  }),
  z
    .strictObject({
      kind: z.literal("move-annotation"),
      annotationId: StableIdSchema,
      position: PointSchema,
      alignment: z
        .enum(["start", "middle", "end"])
        .optional()
        .describe(
          "Which end of the text stands at position: start (text to its right), middle or end; omitted keeps the label's.",
        ),
    })
    .describe(
      "Absolute drawing position; preserve electrical binding and object ownership.",
    ),
]);
export function isBatchableAuthoringCommand(command: {
  kind: string;
}): command is z.infer<typeof BatchItemSchema> {
  return BatchItemSchema.options.some(
    (option) => option.shape.kind.value === command.kind,
  );
}
export const AgentAuthoringCommandSchema = z.discriminatedUnion("kind", [
  ...BatchItemSchema.options,
  z
    .strictObject({
      kind: z.literal("arrange-labels"),
      instanceIds: NonemptyIdsSchema,
      compact: z.boolean().optional(),
      avoidCollisions: z.boolean().optional(),
      referenceStyle: z.enum(["preserve", "first-letter-subscript"]).optional(),
      includeManual: z
        .boolean()
        .optional()
        .describe("Also re-place labels moved by hand."),
    })
    .describe(
      "Opt-in, bounded one-pass placement of visible default Instance labels. Compact/collision avoidance default true. Preserve manually positioned (unless includeManual), locked and custom-styled labels, bindings and electrical names, and name those left in place (LABELS_LEFT_IN_PLACE); unresolved clashes remain observations.",
    ),
  // One preset today; the enum leaves room for more (#1350).
  z
    .strictObject({
      kind: z.literal("apply-label-preset"),
      preset: z
        .enum(["textbook"])
        .describe(
          "textbook: MOS W/L hidden, other values left as they are, names in their role look (R_L, I_SS, M_1) and labels arranged as arrange-labels arranges them.",
        ),
      instanceIds: NonemptyIdsSchema.optional().describe(
        "Left out: every placed part of the Cell.",
      ),
    })
    .describe(
      "A figure's label convention in one step and one undo. Nothing hidden is shown; labels arrange-labels leaves alone keep their place and look.",
    ),
  z.strictObject({
    kind: z.literal("batch"),
    commands: z
      .array(BatchItemSchema)
      .min(1)
      .max(64)
      .describe(
        "Ordered atomic route-net, label, model, display, annotation move, direction, VDD mode or terminal removal commands; one undo, no partial commit. Total expanded edit limit still applies.",
      ),
  }),
  z.strictObject({
    kind: z.literal("place-components"),
    instances: z
      .array(InstancePlacementRequestSchema)
      .min(1)
      .max(64)
      .describe(
        "A part without a reference takes the next free name, as a GUI insert does.",
      ),
    pinAnchors: z
      .record(StableIdSchema, AgentPinAnchorSchema)
      .optional()
      .describe(
        "By new Instance ID. Solves placement.position from this pin; preserves rotation/mirror. No implicit connection.",
      ),
    terminalDirections: z
      .record(StableIdSchema, z.enum(["input", "output", "inout", "passive"]))
      .optional(),
    displays: z
      .record(
        StableIdSchema,
        z.strictObject({
          showReference: z.boolean().optional(),
          showValue: z.boolean().optional(),
        }),
      )
      .optional()
      .describe(
        "By new device Instance ID: its labels from the start. Left out, the name shows alone; showValue:true shows the value given, else the catalog default (#1435).",
      ),
  }),
  z.strictObject({
    kind: z.literal("add-power-rail"),
    start: PointSchema,
    end: PointSchema,
    netId: StableIdSchema.optional(),
    name: NameSchema.optional(),
    scope: z
      .enum(["local", "global"])
      .optional()
      .describe(
        "Defaults to the existing Net scope, otherwise local; global must be intentional.",
      ),
  }),
  z
    .strictObject({
      kind: z.literal("extend-power-rail"),
      routeId: StableIdSchema.describe("Any segment of the rail."),
      start: PointSchema,
      end: PointSchema,
    })
    .describe(
      "Set a straight Power Rail's two ends on its own line. Taps and the one label stay; no pin is joined.",
    ),
  z.strictObject({
    kind: z.literal("place-existing"),
    instanceId: StableIdSchema,
    placement: PlacementSchema.optional().describe(
      "Origin and orientation. With pinAnchor only the orientation is read; left out, the part goes upright and unmirrored.",
    ),
    pinAnchor: OptionalPinAnchorSchema,
  }),
  z.strictObject({
    kind: z.literal("transform"),
    selection: SelectionSchema,
    transform: z.discriminatedUnion("kind", [
      z.strictObject({ kind: z.literal("translate"), delta: PointSchema }),
      z.strictObject({
        kind: z.literal("rotate"),
        degrees: z.union([
          z.literal(45),
          z.literal(90),
          z.literal(135),
          z.literal(180),
          z.literal(225),
          z.literal(270),
          z.literal(315),
        ]),
        center: PointSchema.optional(),
      }),
      z.strictObject({
        kind: z.literal("mirror"),
        axis: z.enum(["x", "y"]),
        center: PointSchema.optional(),
      }),
    ]),
  }),
  z.strictObject({
    kind: z.literal("copy"),
    selection: SelectionSchema,
    offset: PointSchema,
  }),
  z.strictObject({
    kind: z.literal("align"),
    selection: SelectionSchema,
    mode: z.enum(["left", "right", "top", "bottom", "center-x", "center-y"]),
  }),
  z.strictObject({
    kind: z.literal("detach-move"),
    instanceIds: NonemptyIdsSchema,
    delta: PointSchema,
  }),
  z.strictObject({
    kind: z.literal("unplace"),
    instanceIds: NonemptyIdsSchema,
  }),
  z.strictObject({
    kind: z.literal("reset-cell"),
    mode: z.enum(["clear-drawing", "reset-placement", "reset-body"]),
  }),
  z.strictObject({
    kind: z.literal("create-cell"),
    id: StableIdSchema,
    name: NameSchema,
  }),
  z.strictObject({
    kind: z.literal("rename-cell"),
    id: StableIdSchema,
    name: NameSchema,
  }),
  z.strictObject({ kind: z.literal("delete-cell"), id: StableIdSchema }),
  z.strictObject({
    kind: z.literal("bind-cell-parameter"),
    instanceId: StableIdSchema,
    field: NameSchema,
    name: NameSchema,
    defaultValue: z.string().min(1).max(1024).optional(),
  }),
  z.strictObject({
    kind: z.literal("rename-cell-parameter"),
    oldName: NameSchema,
    newName: NameSchema,
  }),
  z.strictObject({
    kind: z.literal("set-cell-parameter-default"),
    name: NameSchema,
    defaultValue: z.string().min(1).max(1024),
  }),
  z.strictObject({
    kind: z.literal("remove-cell-parameter"),
    name: NameSchema,
  }),
  z.strictObject({
    kind: z.literal("rename-cell-terminal"),
    terminalId: StableIdSchema,
    name: NameSchema,
    mergeExistingPort: z.boolean().optional(),
  }),
  z
    .strictObject({
      kind: z.literal("set-cell-symbol-pins"),
      pins: z
        .array(
          z.strictObject({
            name: NameSchema,
            side: CellSymbolSideSchema,
            offset: z
              .number()
              .int()
              .optional()
              .describe(
                "From the side's middle, a multiple of 10. Left out: a Pin keeping its side stays put, one changing side takes the first free slot (0, -20, 20, …).",
              ),
          }),
        )
        .min(1)
        .max(256),
    })
    .describe(
      "Arrange this Cell's block Pins by name. Pins not named keep their place; callers keep their Nets and their wiring is redrawn.",
    ),
]);
export type AgentAuthoringCommand = z.infer<typeof AgentAuthoringCommandSchema>;
