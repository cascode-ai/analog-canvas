/**
 * The files a file input was just given, as a list of their own, the input
 * cleared: choosing the same file again is then a new choice that fires
 * `change` (#2154). Chromium empties the input's own FileList when it is
 * cleared, so the files are copied out first.
 */
export function takeChosenFiles(
  input: Pick<HTMLInputElement, "files" | "value">,
): File[] {
  const files = [...(input.files ?? [])];
  input.value = "";
  return files;
}
