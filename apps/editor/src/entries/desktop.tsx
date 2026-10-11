import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../app/App";
import { EditorErrorBoundary } from "../components/editor-error-boundary";
import { createPreviewEditorServices } from "../services/preview-editor-services";
import { workspaceWindowId } from "../document/project-workspace";
import "../styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Editor root element is missing");
// The single-instance desktop window keeps one workspace across launches.
// The browser continues to allocate a separate identity for each window.
workspaceWindowId("desktop-main");
// Fixed product links use explicit private host commands. Other links provide
// feedback; the main process independently refuses all external navigation.
document.addEventListener(
  "click",
  (event) => {
    const target =
      event.target instanceof Element ? event.target.closest("a[href]") : null;
    if (!target) return;
    if (target.hasAttribute("data-native-external-link")) return;
    const url = new URL(target.getAttribute("href")!, window.location.href);
    if (url.protocol === "app:" && url.host === window.location.host) return;
    event.preventDefault();
    window.alert(
      "External links are unavailable in this offline preview. Use File → Save to keep your work.",
    );
  },
  true,
);

createRoot(root).render(
  <StrictMode>
    <EditorErrorBoundary>
      <App services={createPreviewEditorServices()} />
    </EditorErrorBoundary>
  </StrictMode>,
);
