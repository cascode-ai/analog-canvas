// The shared-component editor session the editor opens, and its target.
import type { ComponentDefinition, Instance } from "@icm/model";
import type { SharedComponent } from "../features/user-components/component-library-contract";

export interface ComponentEditorSession {
  key: string;
  projectSessionId: string;
  definition: ComponentDefinition;
  mode: "new" | "instance" | "library";
  entry?: SharedComponent;
  externalDefinitionId?: string;
  target?: { projectSessionId: string; documentId: string; instance: Instance };
}
