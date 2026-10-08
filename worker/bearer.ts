/** Whether the request's bearer equals `expected`, compared in constant time. */
export function bearerMatches(
  request: Request,
  expected: string | undefined,
): boolean {
  const supplied = request.headers
    .get("Authorization")
    ?.replace(/^Bearer /, "");
  let difference = 0;
  if (expected && supplied?.length === expected.length) {
    for (let i = 0; i < expected.length; i++)
      difference |= expected.charCodeAt(i) ^ supplied.charCodeAt(i);
  } else difference = 1;
  return difference === 0;
}
