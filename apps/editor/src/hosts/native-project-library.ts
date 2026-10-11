/** Desktop-only project management bridge. Paths returned here are display metadata. */
import { nativeProjectRequest } from "./native-project-request";
import { z } from "zod";
export interface LibraryProject {
  id: string;
  name: string;
  path: string;
  modified: number;
  error?: string | undefined;
  warning?: string | undefined;
  favorite: boolean;
  recycled: boolean;
}
export interface ProjectLibraryListing {
  root: string;
  projects: LibraryProject[];
  recentProjects: {
    id: string;
    name: string;
    path: string;
    error?: string | undefined;
  }[];
}
export interface ProjectHistoryListing {
  currentText: string;
  versions: { id: string; savedAt: number; text: string }[];
}
const libraryListing = z.object({
  status: z.literal("listed"),
  root: z.string(),
  recentProjects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      error: z.string().optional(),
    }),
  ),
  projects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      path: z.string(),
      modified: z.number(),
      error: z.string().optional(),
      warning: z.string().optional(),
      favorite: z.boolean(),
      recycled: z.boolean(),
    }),
  ),
});
const historyListing = z.object({
  status: z.literal("listed"),
  currentText: z.string(),
  versions: z.array(
    z.object({ id: z.string(), savedAt: z.number(), text: z.string() }),
  ),
});
export function libraryCommand(
  route: "library",
  body?: unknown,
): Promise<ProjectLibraryListing>;
export function libraryCommand(
  route: "history",
  body: unknown,
): Promise<ProjectHistoryListing>;
export function libraryCommand(
  route: "saved-copy",
  body: unknown,
): Promise<{ name: string; text: string }>;
export function libraryCommand(
  route:
    | "library-action"
    | "library-directory"
    | "reveal"
    | "copy-to-library"
    | "forget",
  body?: unknown,
): Promise<void>;
export async function libraryCommand(
  route: string,
  body?: unknown,
): Promise<
  | ProjectLibraryListing
  | ProjectHistoryListing
  | { name: string; text: string }
  | void
> {
  const result = await nativeProjectRequest(route, body);
  if (result.status === "failed" || result.status === "conflict")
    throw new Error(
      typeof result.message === "string"
        ? result.message
        : "Project library unavailable",
    );
  if (route === "library") return libraryListing.parse(result);
  if (route === "history") return historyListing.parse(result);
  if (route === "saved-copy")
    return z
      .object({ status: z.literal("read"), name: z.string(), text: z.string() })
      .parse(result);
  if (!["done", "listed", "cancelled"].includes(String(result.status)))
    throw new Error("Invalid project library response");
}
