export type NativeExternalTarget = "owner" | "repository" | "source" | "rnl";
export async function openNativeExternalLink(target: NativeExternalTarget) {
  const response = await fetch("/desktop/external", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ target }),
  });
  if (!response.ok) throw Error("The system browser could not open this link.");
}
