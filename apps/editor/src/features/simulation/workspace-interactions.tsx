import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

export interface WorkspaceMenuItem {
  label: string;
  disabled?: boolean | undefined;
  run(): void;
}
interface NameRequest {
  kind: "folder" | "file";
  folderId?: string;
  path?: string;
  label: string;
  initial: string;
  validate?(name: string): string | undefined;
  template?: {
    value: string;
    options: string[];
    onChange(value: string): void;
  };
}
interface Confirmation {
  title: string;
  message: string;
  acceptLabel?: string;
}
interface Interactions {
  edit: (NameRequest & { requestId: number }) | undefined;
  name(request: NameRequest): Promise<string | null>;
  finishName(value: string | null, restoreFocus?: boolean): void;
  confirm(request: Confirmation): Promise<boolean>;
  menu(x: number, y: number, items: WorkspaceMenuItem[], label?: string): void;
  closeMenu(restore?: boolean): void;
}
const Context = createContext<Interactions | null>(null);
export function useWorkspaceInteractions() {
  const value = useContext(Context);
  if (!value) throw new Error("Workspace interactions require their provider");
  return value;
}

/** One transient interaction owner. Commands retain explicit resource targets. */
export function WorkspaceInteractions({ children }: { children: ReactNode }) {
  const [edit, setEdit] = useState<NameRequest & { requestId: number }>();
  const nameSequence = useRef(0);
  const nameResolver = useRef<((value: string | null) => void) | undefined>(
    undefined,
  );
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const confirmResolver = useRef<((value: boolean) => void) | undefined>(
    undefined,
  );
  const [menu, setMenu] = useState<{
    x: number;
    y: number;
    items: WorkspaceMenuItem[];
    label: string;
  }>();
  const origin = useRef<HTMLElement | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restore = () => {
    if (origin.current?.isConnected) origin.current.focus();
  };
  const closeMenu = (focus = false) => {
    setMenu(undefined);
    if (focus) restore();
  };
  const finishName = (value: string | null, restoreFocus = false) => {
    const resolve = nameResolver.current;
    nameResolver.current = undefined;
    setEdit(undefined);
    resolve?.(value);
    if (restoreFocus && edit)
      requestAnimationFrame(() => {
        const row =
          edit.kind === "folder"
            ? value
              ? document.querySelector<HTMLElement>(
                  `[aria-label="${CSS.escape(`Folder ${value}`)}"]`,
                )
              : document.querySelector<HTMLElement>(
                  `[data-folder-id="${CSS.escape(edit.folderId ?? "")}"][data-tree-row="folder"]`,
                )
            : document.querySelector<HTMLElement>(
                `[data-folder-id="${CSS.escape(edit.folderId ?? "")}"][data-file-path="${CSS.escape(value ?? edit.path ?? "")}"]`,
              );
        (
          row ??
          document.querySelector<HTMLElement>("[data-workspace-new-folder]")
        )?.focus();
      });
  };
  const finishConfirm = (value: boolean) => {
    confirmResolver.current?.(value);
    confirmResolver.current = undefined;
    setConfirmation(undefined);
    restore();
  };
  useEffect(
    () => () => {
      nameResolver.current?.(null);
      confirmResolver.current?.(false);
    },
    [],
  );
  useLayoutEffect(() => {
    if (!menu || !menuRef.current) return;
    const element = menuRef.current;
    const rect = element.getBoundingClientRect();
    element.style.left = `${Math.max(4, Math.min(menu.x, window.innerWidth - rect.width - 4))}px`;
    element.style.top = `${Math.max(4, Math.min(menu.y, window.innerHeight - rect.height - 4))}px`;
    element.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (!element.contains(event.target as Node)) closeMenu();
    };
    const dismiss = () => closeMenu();
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", dismiss);
    window.addEventListener("blur", dismiss);
    return () => {
      document.removeEventListener("pointerdown", outside, true);
      window.removeEventListener("resize", dismiss);
      window.removeEventListener("blur", dismiss);
    };
  }, [menu]);
  useEffect(() => {
    if (!confirmation) return;
    dialogRef.current?.showModal();
    dialogRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [confirmation]);
  return (
    <Context.Provider
      value={{
        edit,
        finishName,
        closeMenu,
        name: (request) => {
          finishName(null);
          closeMenu();
          setEdit({ ...request, requestId: ++nameSequence.current });
          return new Promise((resolve) => {
            nameResolver.current = resolve;
          });
        },
        confirm: (request) => {
          finishName(null);
          closeMenu();
          confirmResolver.current?.(false);
          origin.current = document.activeElement as HTMLElement;
          setConfirmation(request);
          return new Promise((resolve) => {
            confirmResolver.current = resolve;
          });
        },
        menu: (x, y, items, label = "Workspace actions") => {
          origin.current = document.activeElement as HTMLElement;
          setMenu({ x, y, items, label });
        },
      }}
    >
      {children}
      {menu
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={menu.label}
              data-workspace-interaction="true"
              className="workspace-context-menu"
              style={{ left: menu.x, top: menu.y }}
              onContextMenu={(event) => event.preventDefault()}
              onKeyDown={(event) => {
                event.stopPropagation();
                if (event.key === "Escape" || event.key === "Tab") {
                  event.preventDefault();
                  closeMenu(true);
                }
                if (
                  ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
                ) {
                  event.preventDefault();
                  const buttons = [
                    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                      "button:not(:disabled)",
                    ),
                  ];
                  const index = buttons.indexOf(
                    document.activeElement as HTMLButtonElement,
                  );
                  const next =
                    event.key === "Home"
                      ? 0
                      : event.key === "End"
                        ? buttons.length - 1
                        : (index +
                            (event.key === "ArrowDown" ? 1 : -1) +
                            buttons.length) %
                          buttons.length;
                  buttons[next]?.focus();
                }
              }}
            >
              {menu.items.map((item) => (
                <button
                  key={item.label}
                  type="button"
                  role="menuitem"
                  disabled={item.disabled}
                  onClick={() => {
                    closeMenu(true);
                    item.run();
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>,
            document.body,
          )
        : null}
      {confirmation
        ? createPortal(
            <dialog
              ref={dialogRef}
              className="workspace-confirm-dialog"
              data-workspace-interaction="true"
              aria-label={confirmation.title}
              onCancel={(event) => {
                event.preventDefault();
                finishConfirm(false);
              }}
              onClick={(event) => {
                if (event.target === event.currentTarget) finishConfirm(false);
              }}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <h3>{confirmation.title}</h3>
              <p>{confirmation.message}</p>
              <div>
                <button type="button" onClick={() => finishConfirm(false)}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="is-danger"
                  onClick={() => finishConfirm(true)}
                >
                  {confirmation.acceptLabel ?? "Delete"}
                </button>
              </div>
            </dialog>,
            document.body,
          )
        : null}
    </Context.Provider>
  );
}

/** Enter/blur share one commit latch; errors never trap focus or block the page. */
export function WorkspaceNameInput() {
  const ui = useWorkspaceInteractions();
  return ui.edit ? <NameInput key={ui.edit.requestId} /> : null;
}
function NameInput() {
  const interaction = useWorkspaceInteractions();
  const request = interaction.edit!;
  const [value, setValue] = useState(request.initial);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const finish = (cancel = false, restoreFocus = false) => {
    if (finished.current) return;
    const name = value.trim();
    const problem = !cancel && name ? request.validate?.(name) : undefined;
    if (problem) {
      setError(problem);
      return;
    }
    finished.current = true;
    interaction.finishName(cancel || !name ? null : name, restoreFocus);
  };
  return (
    <div
      className="workspace-inline-name"
      onContextMenu={(e) => e.stopPropagation()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) finish();
      }}
    >
      <input
        ref={input}
        aria-label={request.label}
        value={value}
        aria-invalid={Boolean(error)}
        onChange={(e) => {
          setValue(e.currentTarget.value);
          setError(undefined);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === "Enter" && !e.nativeEvent.isComposing) {
            e.preventDefault();
            finish(false, true);
          }
          if (e.key === "Escape") {
            e.preventDefault();
            finish(true, true);
          }
        }}
      />
      {request.template ? (
        <select
          aria-label="Folder template"
          defaultValue={request.template.value}
          onChange={(event) =>
            request.template?.onChange(event.currentTarget.value)
          }
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") finish(true);
          }}
        >
          {request.template.options.map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
      ) : null}
      {error ? <small role="status">{error}</small> : null}
    </div>
  );
}
