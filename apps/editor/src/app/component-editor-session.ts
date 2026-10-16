// The shared-component editor session the editor opens, and its target.
import type {
  ComponentDefinition,
  Instance,
  ComponentAuthoringDraft,
} from "@icm/model";
import type { SharedComponent } from "../features/user-components/component-library-contract";
import type { prepareComponentVariant } from "@icm/edit-engine";

export interface ComponentEditorSession {
  key: string;
  projectSessionId: string;
  definition: ComponentDefinition;
  mode: "new" | "instance" | "library";
  entry?: SharedComponent;
  publicationIntent?: "new" | "update";
  draft?: ComponentAuthoringDraft;
  externalSourceId?: string | undefined;
  externalDefinitionId?: string | undefined;
  variant?: ReturnType<typeof prepareComponentVariant> & {
    baseRevision: number;
  };
  variantArtworkText?: string | undefined;
  target?: { projectSessionId: string; documentId: string; instance: Instance };
}
