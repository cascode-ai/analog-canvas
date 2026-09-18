import { SourceSpanSchema, StableIdSchema } from "@icm/model";
import { z } from "zod";

export const SpiceDialectIdSchema = z.string().min(1);
export const CircuitPortIRSchema = z.strictObject({
  name: z.string().min(1),
  position: z.number().int().nonnegative(),
  netId: StableIdSchema,
  sourceRef: SourceSpanSchema.optional(),
});
export const CircuitNetIRSchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().min(1),
  scope: z.enum(["local", "global"]),
});
export const CircuitTerminalIRSchema = z.strictObject({
  position: z.number().int().nonnegative(),
  name: z.string().min(1).optional(),
  netId: StableIdSchema,
});
export const CircuitInstanceTargetIRSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("primitive"), family: z.string().min(1) }),
  z.strictObject({ kind: z.literal("model"), modelName: z.string().min(1) }),
  z.strictObject({
    kind: z.literal("subcircuit"),
    cellName: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("external-subcircuit"),
    masterName: z.string().min(1),
  }),
  z.strictObject({ kind: z.literal("opaque"), sourceName: z.string().min(1) }),
]);
export const CircuitParameterIRSchema = z.strictObject({
  rawText: z.string(),
  normalizedName: z.string().min(1),
});
export const CircuitParameterDeclarationIRSchema = z.strictObject({
  name: z.string().min(1),
  rawText: z.string(),
  sourceRef: SourceSpanSchema,
});
export const CircuitInstanceIRSchema = z.strictObject({
  id: StableIdSchema,
  name: z.string().min(1),
  target: CircuitInstanceTargetIRSchema,
  terminals: z.array(CircuitTerminalIRSchema),
  parameters: z.record(z.string(), CircuitParameterIRSchema),
  sourceRef: SourceSpanSchema,
});
export const CircuitCellIRSchema = z
  .strictObject({
    id: StableIdSchema,
    name: z.string().min(1),
    ports: z.array(CircuitPortIRSchema),
    nets: z.array(CircuitNetIRSchema),
    instances: z.array(CircuitInstanceIRSchema),
    parameters: z.array(CircuitParameterDeclarationIRSchema),
    sourceRef: SourceSpanSchema,
  })
  .superRefine((cell, context) => {
    const netIds = new Set(cell.nets.map((net) => net.id));
    const instanceIds = new Set<string>();
    for (const [instanceIndex, instance] of cell.instances.entries()) {
      if (instanceIds.has(instance.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate instance ID: ${instance.id}`,
          path: ["instances", instanceIndex, "id"],
        });
      }
      instanceIds.add(instance.id);
    }
    const positions = cell.ports
      .map((port) => port.position)
      .sort((left, right) => left - right);
    if (positions.some((position, index) => position !== index)) {
      context.addIssue({
        code: "custom",
        message: "Cell port positions must be contiguous and zero-based",
        path: ["ports"],
      });
    }
    for (const [portIndex, port] of cell.ports.entries()) {
      if (!netIds.has(port.netId)) {
        context.addIssue({
          code: "custom",
          message: `Unknown port net: ${port.netId}`,
          path: ["ports", portIndex, "netId"],
        });
      }
    }
    for (const [instanceIndex, instance] of cell.instances.entries()) {
      const terminalPositions = instance.terminals
        .map((terminal) => terminal.position)
        .sort((left, right) => left - right);
      if (terminalPositions.some((position, index) => position !== index)) {
        context.addIssue({
          code: "custom",
          message:
            "Instance terminal positions must be contiguous and zero-based",
          path: ["instances", instanceIndex, "terminals"],
        });
      }
      for (const [terminalIndex, terminal] of instance.terminals.entries()) {
        if (!netIds.has(terminal.netId)) {
          context.addIssue({
            code: "custom",
            message: `Unknown terminal net: ${terminal.netId}`,
            path: [
              "instances",
              instanceIndex,
              "terminals",
              terminalIndex,
              "netId",
            ],
          });
        }
      }
    }
  });
export const ModelDeclarationIRSchema = z.strictObject({
  name: z.string().min(1),
  modelType: z.string().min(1),
  rawParameters: z.string(),
  sourceRef: SourceSpanSchema,
});
export const OpaqueStatementSchema = z.strictObject({
  kind: z.literal("opaque"),
  rawText: z.string(),
  sourceRef: SourceSpanSchema,
  probableType: z.enum(["element", "directive", "control"]).optional(),
});
export const PreservedStatementIRSchema = z.strictObject({
  kind: z.enum(["directive", "control", "conditional", "function", "library"]),
  name: z.string().min(1),
  rawText: z.string(),
  sourceRef: SourceSpanSchema,
});
export const CircuitIRSchema = z
  .strictObject({
    dialect: SpiceDialectIdSchema,
    topCells: z.array(z.string().min(1)),
    cells: z.array(CircuitCellIRSchema),
    parameters: z.array(CircuitParameterDeclarationIRSchema),
    models: z.array(ModelDeclarationIRSchema),
    preservedStatements: z.array(PreservedStatementIRSchema),
    unresolvedStatements: z.array(OpaqueStatementSchema),
  })
  .superRefine((ir, context) => {
    const cellNames = new Set<string>();
    for (const [cellIndex, cell] of ir.cells.entries()) {
      const normalized = cell.name.toLowerCase();
      if (cellNames.has(normalized)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate cell name: ${cell.name}`,
          path: ["cells", cellIndex, "name"],
        });
      }
      cellNames.add(normalized);
    }
    for (const [topIndex, topCell] of ir.topCells.entries()) {
      if (!cellNames.has(topCell.toLowerCase())) {
        context.addIssue({
          code: "custom",
          message: `Unknown top cell: ${topCell}`,
          path: ["topCells", topIndex],
        });
      }
    }
  });

export type SpiceDialectId = z.infer<typeof SpiceDialectIdSchema>;
export type CircuitPortIR = z.infer<typeof CircuitPortIRSchema>;
export type CircuitNetIR = z.infer<typeof CircuitNetIRSchema>;
export type CircuitTerminalIR = z.infer<typeof CircuitTerminalIRSchema>;
export type CircuitInstanceIR = z.infer<typeof CircuitInstanceIRSchema>;
export type CircuitCellIR = z.infer<typeof CircuitCellIRSchema>;
export type CircuitParameterDeclarationIR = z.infer<
  typeof CircuitParameterDeclarationIRSchema
>;
export type ModelDeclarationIR = z.infer<typeof ModelDeclarationIRSchema>;
export type OpaqueStatement = z.infer<typeof OpaqueStatementSchema>;
export type PreservedStatementIR = z.infer<typeof PreservedStatementIRSchema>;
export type CircuitIR = z.infer<typeof CircuitIRSchema>;
