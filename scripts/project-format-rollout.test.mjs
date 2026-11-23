import { expect, it } from "vitest";
import {
  checkProjectFormatRollout,
  guardPublishedFormat,
} from "./project-format-rollout.mjs";

it("keeps ordinary releases independent and requires two installed readers for a new writer", async () => {
  const old = { read: 86, write: 86 };
  const reader = { read: 87, write: 86 };
  const writer = { read: 87, write: 87 };
  const offline = () => {
    throw new Error("domestic reader offline");
  };
  await checkProjectFormatRollout(old, reader, offline);
  await expect(
    checkProjectFormatRollout(old, writer, async () => old),
  ).rejects.toThrow(/overseas reader/i);
  await expect(
    checkProjectFormatRollout(reader, writer, async () => old),
  ).rejects.toThrow(/domestic reader/i);
  await expect(
    checkProjectFormatRollout(reader, writer, offline),
  ).rejects.toThrow(/offline/);
  await checkProjectFormatRollout(reader, writer, async () => reader);
  await expect(
    checkProjectFormatRollout(writer, old, async () => writer),
  ).rejects.toThrow(/downgrade/i);
  await checkProjectFormatRollout(writer, writer, offline);
});

it("requires proof of the serving attempt even when an earlier one verified the same commit", async () => {
  const commit = "a".repeat(40);
  const pointer = {
    commit,
    manifest: `/regional-release/${commit}/release.json`,
    sha256: "b".repeat(64),
    attempt: "201-2",
  };
  const reader = { read: 87, write: 86 };
  const writer = { read: 87, write: 87 };
  const receipts = {
    schemaVersion: 1,
    commit,
    sha256: pointer.sha256,
    verified: true,
  };
  const run = (attempt, changed = false) => {
    let seen = false;
    return guardPublishedFormat(writer, {
      formatAt: () => reader,
      get: async (url) => {
        if (url.endsWith("/current.json")) {
          if (seen && changed) return { ...pointer, attempt: "202-1" };
          seen = true;
          return pointer;
        }
        if (url.includes("/verification/")) {
          expect(url.endsWith("/201-2")).toBe(true);
          return { ...receipts, attempt };
        }
        return reader;
      },
    });
  };
  await expect(run("201-1")).rejects.toThrow(/receipt/i);
  await expect(run("201-2", true)).rejects.toThrow(/changed/i);
  await run("201-2");
});
