import type { LogicValue } from "./contract.js";

export function logicNot(value: LogicValue): LogicValue {
  if (value === "0") return "1";
  if (value === "1") return "0";
  return "X";
}

function asInput(value: LogicValue): LogicValue {
  return value === "Z" ? "X" : value;
}

export function logicAnd(values: readonly LogicValue[]): LogicValue {
  const inputs = values.map(asInput);
  if (inputs.includes("0")) return "0";
  return inputs.every((value) => value === "1") ? "1" : "X";
}

export function logicOr(values: readonly LogicValue[]): LogicValue {
  const inputs = values.map(asInput);
  if (inputs.includes("1")) return "1";
  return inputs.every((value) => value === "0") ? "0" : "X";
}

export function logicXor(values: readonly LogicValue[]): LogicValue {
  const inputs = values.map(asInput);
  if (inputs.some((value) => value === "X")) return "X";
  return inputs.filter((value) => value === "1").length % 2 === 0 ? "0" : "1";
}

export function resolveDrivers(values: Iterable<LogicValue>): LogicValue {
  const driven = [...values].filter((value) => value !== "Z");
  if (driven.length === 0) return "Z";
  if (driven.includes("X")) return "X";
  return new Set(driven).size === 1 ? driven[0]! : "X";
}
