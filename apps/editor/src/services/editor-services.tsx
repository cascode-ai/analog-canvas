import { createContext, useContext, type ReactNode } from "react";
import type { CircuitProject } from "@icm/model";
import type { SessionUser } from "../components/account";
import type {
  CloudProjectBinding,
  CloudProjectListOutcome,
  CloudProjectOpenOutcome,
  CloudProjectSaveOutcome,
  deleteCloudProject,
} from "../features/editor-shell/cloud-projects";
import type { EditorExportDelivery } from "../hosts/export-delivery";

/** Current Cloud contract, including revisions/conflicts; not a native store. */
export interface CloudProjectStore {
  readonly kind: "cloud";
  readonly limit: number;
  list(): Promise<CloudProjectListOutcome>;
  open(projectId: string): Promise<CloudProjectOpenOutcome>;
  save(
    project: CircuitProject,
    binding: CloudProjectBinding | null,
    galleryEntryId?: string,
  ): Promise<CloudProjectSaveOutcome>;
  delete(projectId: string): ReturnType<typeof deleteCloudProject>;
}

/** First composition seam. Other online features still own their dependencies. */
export interface EditorServices {
  readonly identity: { getSessionUser(): Promise<SessionUser | null> } | null;
  readonly projectStore: CloudProjectStore | null;
  readonly capabilities: {
    readonly community: boolean;
    readonly agent: boolean;
    readonly simulation: boolean;
    readonly externalLinks: boolean;
  };
  readonly exportDelivery: EditorExportDelivery;
}

const EditorServicesContext = createContext<EditorServices | null>(null);

export function EditorServicesProvider({
  services,
  children,
}: {
  services: EditorServices;
  children: ReactNode;
}) {
  return (
    <EditorServicesContext.Provider value={services}>
      {children}
    </EditorServicesContext.Provider>
  );
}

export function useEditorServices(): EditorServices {
  const services = useContext(EditorServicesContext);
  if (!services)
    throw new Error("Editor services must be supplied by the host");
  return services;
}
