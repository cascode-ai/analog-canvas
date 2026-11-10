/** CI alone writes these receipts, using the protected production credential. */
export type RegionalReleaseEnv = {
  REGIONAL_RELEASES?: {
    get(key: string): Promise<{ text(): Promise<string> } | null>;
  };
};

export async function routeRegionalRelease(
  request: Request,
  env: RegionalReleaseEnv,
): Promise<Response | null> {
  const path = new URL(request.url).pathname;
  if (!path.startsWith("/api/regional-release/")) return null;
  const headers = { "cache-control": "no-store" };
  if (request.method !== "GET")
    return new Response(null, {
      status: 405,
      headers: { ...headers, allow: "GET" },
    });
  const match =
    /^\/api\/regional-release\/verification\/([0-9a-f]{40}\/[0-9a-f]{64}\/[1-9][0-9]*-[1-9][0-9]*)$/.exec(
      path,
    );
  const receipt =
    match && (await env.REGIONAL_RELEASES?.get(`${match[1]}.json`));
  if (!receipt) return new Response(null, { status: 404, headers });
  return new Response(await receipt.text(), {
    headers: { ...headers, "content-type": "application/json" },
  });
}
