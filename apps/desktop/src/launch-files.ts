import { isAbsolute } from "node:path";

/** Only OS command-line ingress supplies paths; renderer requests use opaque ids. */
export function createLaunchFileQueue() {
  const paths: string[] = [];
  return {
    enqueue(argv: readonly string[]) {
      const index = argv.indexOf("--open-project");
      // Chromium reorders switches before positional arguments when forwarding
      // a second instance on Windows; the file need not follow the marker.
      const path =
        index < 0
          ? undefined
          : argv
              .slice(1)
              .find(
                (value) =>
                  isAbsolute(value) && /\.icproj(?:\.json)?$/iu.test(value),
              );
      if (!path || !isAbsolute(path) || !/\.icproj(?:\.json)?$/iu.test(path))
        return false;
      if (paths.length >= 20) return false;
      if (!paths.some((item) => item.toLowerCase() === path.toLowerCase()))
        paths.push(path);
      return true;
    },
    take() {
      return paths.shift() ?? null;
    },
  };
}
