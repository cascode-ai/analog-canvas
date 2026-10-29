import {
  buildStandalonePackages,
  verifyPackageBuild,
} from "./lib/ci-package-build.mjs";

export default function setup(project) {
  const build = () => {
    // One topologically ordered build before test-module collection, even when
    // selecting only the analyzer. Existence checks could reuse stale dist.
    if (process.env.ICM_CI_PACKAGE_BUILD === "1")
      verifyPackageBuild(project.config.root);
    else buildStandalonePackages(project.config.root);
  };
  build();
  project.onTestsRerun(build);
}
