/** Character ranges in generated circuit source; independent of simulator syntax. */
export interface PrintedNetlistInstance {
  documentId: string;
  instanceId: string;
  startOffset: number;
  endOffset: number;
}

export interface PrintedNetlistParameter extends PrintedNetlistInstance {
  parameter: string;
  /** The exact generated value at this range, not the original project spelling. */
  rawValue: string;
}
