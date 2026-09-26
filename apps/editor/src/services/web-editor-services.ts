import { fetchSessionUser } from "../components/account";
import {
  CLOUD_PROJECT_LIMIT,
  deleteCloudProject,
  listCloudProjects,
  openCloudProject,
  saveCloudProject,
} from "../features/editor-shell/cloud-projects";
import { browserExportDelivery } from "../hosts/browser-export-delivery";
import type { EditorServices } from "./editor-services";

/** Creating the Web services does not start requests or subscriptions. */
export function createWebEditorServices(
  fetchLike?: typeof fetch,
): EditorServices {
  return {
    identity: { getSessionUser: () => fetchSessionUser(fetchLike) },
    projectStore: {
      kind: "cloud",
      limit: CLOUD_PROJECT_LIMIT,
      list: () => listCloudProjects(fetchLike),
      open: (id) => openCloudProject(id, fetchLike),
      save: (project, binding, galleryEntryId) =>
        saveCloudProject(project, binding, fetchLike, galleryEntryId),
      delete: (id) => deleteCloudProject(id, fetchLike),
    },
    exportDelivery: browserExportDelivery,
  };
}
