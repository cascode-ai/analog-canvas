import { createEmptyDocument } from "@icm/model";
import type { Instance, SchematicDocument } from "@icm/model";
import { describe, expect, it } from "vitest";

import { simulateDigitalDocument } from "./engine.js";

function instance(
  id: string,
  symbolId: string,
  parameters: Record<string, string> = {},
): Instance {
  return {
    id,
    symbolId,
    placement: { position: { x: 0, y: 0 }, rotation: 0, mirror: "none" },
    netlist: {
      reference: id,
      parameters,
    },
  };
}

function connect(
  document: SchematicDocument,
  netId: string,
  terminals: Array<{ instanceId: string; pinName: string }>,
): void {
  document.nets.push({ id: netId, terminals });
}

function pulseParameters(): Record<string, string> {
  return {
    low: "0",
    high: "1",
    delay: "1ns",
    rise: "1ps",
    fall: "1ps",
    width: "5ns",
    period: "10ns",
  };
}

describe("digital event simulation", () => {
  it("runs a Digital Clock from Period, Duty cycle, and Initial level", () => {
    const document = createEmptyDocument("doc", "Digital clock");
    document.instances.push(
      instance("CLK", "pulse-voltage-source", {
        period: "8ns",
        dutyCycle: "25",
        initial: "0",
      }),
      instance("GND", "ground"),
    );
    connect(document, "clock", [{ instanceId: "CLK", pinName: "+" }]);
    connect(document, "ground", [
      { instanceId: "CLK", pinName: "-" },
      { instanceId: "GND", pinName: "0" },
    ]);

    const result = simulateDigitalDocument({
      document,
      profile: { stopTimePs: 16_000, savedNetIds: ["clock"] },
    });

    expect(result.completed).toBe(true);
    expect(result.traces[0]?.transitions).toEqual([
      { timePs: 0, value: "0" },
      { timePs: 6_000, value: "1" },
      { timePs: 8_000, value: "0" },
      { timePs: 14_000, value: "1" },
      { timePs: 16_000, value: "0" },
    ]);
  });

  it("honors a high Initial level without exposing phase or delay", () => {
    const document = createEmptyDocument("doc", "High-first clock");
    document.instances.push(
      instance("CLK", "pulse-voltage-source", {
        period: "8ns",
        dutyCycle: "25",
        initial: "1",
      }),
      instance("GND", "ground"),
    );
    connect(document, "clock", [{ instanceId: "CLK", pinName: "+" }]);
    connect(document, "ground", [
      { instanceId: "CLK", pinName: "-" },
      { instanceId: "GND", pinName: "0" },
    ]);

    const result = simulateDigitalDocument({
      document,
      profile: { stopTimePs: 10_000, savedNetIds: ["clock"] },
    });

    expect(result.traces[0]?.transitions).toEqual([
      { timePs: 0, value: "1" },
      { timePs: 2_000, value: "0" },
      { timePs: 8_000, value: "1" },
      { timePs: 10_000, value: "0" },
    ]);
  });

  it("propagates a Pulse Source through a combinational gate", () => {
    const document = createEmptyDocument("doc", "Pulse inverter");
    document.instances.push(
      instance("VCLK", "pulse-voltage-source", pulseParameters()),
      instance("INV", "inverter"),
      instance("GND", "ground"),
    );
    connect(document, "clock", [
      { instanceId: "VCLK", pinName: "+" },
      { instanceId: "INV", pinName: "A" },
    ]);
    connect(document, "clock-bar", [{ instanceId: "INV", pinName: "Y" }]);
    connect(document, "ground", [
      { instanceId: "VCLK", pinName: "-" },
      { instanceId: "GND", pinName: "0" },
    ]);

    const result = simulateDigitalDocument({
      document,
      profile: { stopTimePs: 16_000, savedNetIds: ["clock", "clock-bar"] },
    });

    expect(result.completed).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(result.traces).toEqual([
      {
        netId: "clock",
        baseNetIds: ["clock"],
        name: "clock",
        transitions: [
          { timePs: 0, value: "0" },
          { timePs: 1_000, value: "1" },
          { timePs: 6_000, value: "0" },
          { timePs: 11_000, value: "1" },
          { timePs: 16_000, value: "0" },
        ],
      },
      {
        netId: "clock-bar",
        baseNetIds: ["clock-bar"],
        name: "clock-bar",
        transitions: [
          { timePs: 0, value: "1" },
          { timePs: 1_000, value: "0" },
          { timePs: 6_000, value: "1" },
          { timePs: 11_000, value: "0" },
          { timePs: 16_000, value: "1" },
        ],
      },
    ]);
  });

  it("captures D on rising edges and produces a divide-by-two waveform", () => {
    const document = createEmptyDocument("doc", "DFF divider");
    document.instances.push(
      instance("VCLK", "pulse-voltage-source", pulseParameters()),
      instance("FF", "d-flip-flop"),
      instance("GND", "ground"),
    );
    connect(document, "clock", [
      { instanceId: "VCLK", pinName: "+" },
      { instanceId: "FF", pinName: "CK" },
    ]);
    connect(document, "q", [{ instanceId: "FF", pinName: "Q" }]);
    connect(document, "qbar", [
      { instanceId: "FF", pinName: "QBAR" },
      { instanceId: "FF", pinName: "D" },
    ]);
    connect(document, "ground", [
      { instanceId: "VCLK", pinName: "-" },
      { instanceId: "GND", pinName: "0" },
    ]);

    const result = simulateDigitalDocument({
      document,
      profile: {
        stopTimePs: 31_000,
        savedNetIds: ["clock", "q", "qbar"],
        initialStateByInstanceId: { FF: "0" },
      },
    });

    expect(result.completed).toBe(true);
    expect(
      result.traces.find((trace) => trace.netId === "q")?.transitions,
    ).toEqual([
      { timePs: 0, value: "0" },
      { timePs: 1_000, value: "1" },
      { timePs: 11_000, value: "0" },
      { timePs: 21_000, value: "1" },
      { timePs: 31_000, value: "0" },
    ]);
    expect(
      result.traces.find((trace) => trace.netId === "qbar")?.transitions,
    ).toEqual([
      { timePs: 0, value: "1" },
      { timePs: 1_000, value: "0" },
      { timePs: 11_000, value: "1" },
      { timePs: 21_000, value: "0" },
      { timePs: 31_000, value: "1" },
    ]);
  });

  it("allows the unused QBAR output to remain unconnected", () => {
    const document = createEmptyDocument("doc", "DFF with unused QBAR");
    document.instances.push(
      instance("VCLK", "pulse-voltage-source", pulseParameters()),
      instance("FF", "d-flip-flop"),
      instance("GND", "ground"),
    );
    connect(document, "clock-and-data", [
      { instanceId: "VCLK", pinName: "+" },
      { instanceId: "FF", pinName: "CK" },
      { instanceId: "FF", pinName: "D" },
    ]);
    connect(document, "q", [{ instanceId: "FF", pinName: "Q" }]);
    connect(document, "ground", [
      { instanceId: "VCLK", pinName: "-" },
      { instanceId: "GND", pinName: "0" },
    ]);

    const result = simulateDigitalDocument({
      document,
      profile: {
        stopTimePs: 11_000,
        savedNetIds: ["clock-and-data", "q"],
        initialStateByInstanceId: { FF: "0" },
      },
    });

    expect(result.completed).toBe(true);
    expect(result.diagnostics).toEqual([]);
    expect(
      result.traces.find((trace) => trace.netId === "q")?.transitions,
    ).toEqual([
      { timePs: 0, value: "0" },
      { timePs: 1_000, value: "1" },
    ]);
  });

  it("folds saved Base Nets through explicit logical equivalence", () => {
    const document = createEmptyDocument("doc", "Equivalent probes");
    document.nets.push(
      { id: "left", terminals: [] },
      { id: "right", terminals: [] },
    );
    document.connectivityEvidence.push({
      id: "same-signal",
      kind: "explicit-equivalence",
      memberNetIds: ["left", "right"],
    });

    const result = simulateDigitalDocument({
      document,
      profile: { stopTimePs: 1_000, savedNetIds: ["right", "left"] },
    });

    expect(result.traces).toEqual([
      {
        netId: "left",
        baseNetIds: ["left", "right"],
        name: "left",
        transitions: [{ timePs: 0, value: "Z" }],
      },
    ]);
  });
});
