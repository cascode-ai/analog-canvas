import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { installReviewSkill } from "./install-skill.js";

const released = new URL(
  "../../../fixtures/agent-skills/canvas-review-0.17.97/",
  import.meta.url,
);
let home: string;
const bundle = (guidance: string) => ({
  "SKILL.md": Buffer.from(guidance),
  "agents/openai.yaml": Buffer.from(
    "policy:\n  allow_implicit_invocation: false\n",
  ),
});
const skillPath = (profile: string) =>
  join(home, profile, "skills", "canvas-review");

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "canvas-skill-"));
});
afterEach(async () => {
  await rm(home, { recursive: true, force: true });
});

it("installs for each host and updates only an unedited copy it wrote", async () => {
  for (const [host, profile] of [
    ["codex", ".agents"],
    ["config", ".claude"],
  ] as const) {
    const path = skillPath(profile);
    await expect(
      installReviewSkill(home, host, bundle("First guidance\n")),
    ).resolves.toEqual({ path, status: "installed" });
    await expect(
      installReviewSkill(home, host, bundle("First guidance\n")),
    ).resolves.toEqual({ path, status: "already-current" });
    await expect(
      installReviewSkill(home, host, bundle("Newer guidance\n")),
    ).resolves.toEqual({ path, status: "updated" });
    expect(await readFile(join(path, "SKILL.md"), "utf8")).toBe(
      "Newer guidance\n",
    );
    // Staged copies never stay beside the host's Skills.
    expect(
      (await readdir(join(home, profile))).filter((name) =>
        name.startsWith("."),
      ),
    ).toEqual([]);
  }
});

it("updates the unmarked copy an earlier release installed", async () => {
  const path = skillPath(".agents");
  await mkdir(join(path, "agents"), { recursive: true });
  for (const file of ["SKILL.md", "agents/openai.yaml"])
    await writeFile(join(path, file), await readFile(new URL(file, released)));
  await expect(
    installReviewSkill(home, "codex", bundle("Newer guidance\n")),
  ).resolves.toEqual({ path, status: "updated" });
  expect(await readFile(join(path, "SKILL.md"), "utf8")).toBe(
    "Newer guidance\n",
  );
});

it("leaves an edited copy, another Skill of that name or another entry alone", async () => {
  const path = skillPath(".agents");
  const occupied = {
    diagnostic: { stage: "skill-config", code: "SKILL_PATH_OCCUPIED" },
  };
  await installReviewSkill(home, "codex", bundle("First guidance\n"));
  await writeFile(join(path, "SKILL.md"), "My review guidance\n");
  await expect(
    installReviewSkill(home, "codex", bundle("Newer guidance\n")),
  ).rejects.toMatchObject(occupied);
  expect(await readFile(join(path, "SKILL.md"), "utf8")).toBe(
    "My review guidance\n",
  );

  await rm(path, { recursive: true });
  await mkdir(path);
  await writeFile(join(path, "SKILL.md"), "Someone else's canvas-review\n");
  await expect(
    installReviewSkill(home, "codex", bundle("Newer guidance\n")),
  ).rejects.toMatchObject(occupied);
  expect(await readFile(join(path, "SKILL.md"), "utf8")).toBe(
    "Someone else's canvas-review\n",
  );

  await rm(path, { recursive: true });
  await writeFile(path, "not a directory");
  await expect(
    installReviewSkill(home, "codex", bundle("Newer guidance\n")),
  ).rejects.toMatchObject(occupied);
});
