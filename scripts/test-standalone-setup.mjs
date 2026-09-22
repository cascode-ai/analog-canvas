import { execSync } from "node:child_process";

export default function setup(project) {
  const build = () => {
    // One topologically ordered build before test-module collection, even when
    // selecting only the analyzer. Existence checks could reuse stale dist.
    execSync(
      "pnpm --filter @icm/agent-adapter... --filter @icm/exporters... --filter @icm/simulation-service... build",
      { cwd: project.config.root, stdio: "inherit", timeout: 180000 },
    );
  };
  build();
  project.onTestsRerun(build);
}
