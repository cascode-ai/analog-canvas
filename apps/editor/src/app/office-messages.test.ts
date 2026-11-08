import { existsSync, readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { parseProject } from "@icm/project-protocol";
import { describe, expect, it } from "vitest";
import {
  createChunkReceiver,
  sendChunked,
  type OfficeMessage,
} from "./office-messages";

const OFFICE = new URL("../../public/office/", import.meta.url);
const SITE = "https://analog-canvas.tokenzhang.com";

/** The add-in's task pane script, run without a PowerPoint to start it. */
function taskPane() {
  const context = createContext({
    crypto,
    Office: { onReady() {} },
  });
  runInContext(readFileSync(new URL("taskpane.js", OFFICE), "utf8"), context);
  return {
    examples: runInContext("EXAMPLES", context) as [string, string][],
    sendChunked: runInContext("sendChunked", context) as typeof sendChunked,
    createChunkReceiver: runInContext(
      "createChunkReceiver",
      context,
    ) as typeof createChunkReceiver,
  };
}

function save(size: number): OfficeMessage {
  return {
    type: "save",
    requestId: "r1",
    name: "OTA",
    project: "p".repeat(size),
    documentId: "main",
    svg: "<svg/>",
  };
}

describe("PowerPoint add-in messages", () => {
  it("join across the pane and the editor in any order", () => {
    const pane = taskPane();
    for (const [send, receiver] of [
      [sendChunked, pane.createChunkReceiver],
      [pane.sendChunked, createChunkReceiver],
    ] as const) {
      const chunks: string[] = [];
      send((text) => chunks.push(text), save(100_000));
      expect(chunks.length).toBeGreaterThan(3);
      const received: OfficeMessage[] = [];
      const receive = receiver((message) => received.push(message));
      receive("not a chunk");
      for (const chunk of chunks.reverse()) receive(chunk);
      expect(received).toEqual([save(100_000)]);
    }
  });

  it("offer examples the editor opens", () => {
    for (const [file] of taskPane().examples) {
      const text = readFileSync(new URL(`examples/${file}`, OFFICE), "utf8");
      expect(() => parseProject(text), file).not.toThrow();
    }
  });

  it("load only from the site, from files it serves", () => {
    const manifest = readFileSync(new URL("manifest.xml", OFFICE), "utf8");
    const urls = [...manifest.matchAll(/DefaultValue="(https:[^"]+)"/g)].map(
      (match) => match[1]!,
    );
    expect(urls.length).toBeGreaterThan(5);
    for (const url of urls) {
      expect(url.startsWith(`${SITE}/office/`), url).toBe(true);
      const file = url.slice(`${SITE}/office/`.length) || "index.html";
      expect(existsSync(new URL(file, OFFICE)), url).toBe(true);
    }
  });
});
