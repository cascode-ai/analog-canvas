import { App, type AppProps } from "../app/App";
import { createWebEditorServices } from "../services/web-editor-services";

// Loaded with the editor route, never eagerly for an unpaired Gallery visitor.
// One stable service set is shared by every tab and its background commands.
const services = createWebEditorServices();

export function WebEditorApp(props: Omit<AppProps, "services">) {
  return <App {...props} services={services} />;
}
