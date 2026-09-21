import { useEffect, useRef, useState } from "react";
import { createId } from "@icm/model";

/** Only the active editor renders. Inactive tabs retain their actual controller
 * and history; changing tabs is never a Project replace or an undo operation. */
export function useProjectTabs<Session>(options: {
  initial?: {
    activeId: string;
    tabs: { id: string; session: Session }[];
  } | null;
  persist?(
    workspace: { activeId: string; tabs: { id: string; session: Session }[] },
    final: boolean,
  ): void;
  capture(): Session;
  restore(session: Session): void;
  describe(session: Session): {
    name: string;
    dirty: boolean;
    unsafe: boolean;
    cloudId: string | null;
  };
  prepare(): Promise<boolean>;
  onError(message: string): void;
}) {
  const current = useRef(options);
  current.current = options;
  const [activated, setActivated] = useState(!options.initial);
  const activatedRef = useRef(activated);
  activatedRef.current = activated;
  const [activeId, setActiveId] = useState(
    () => options.initial?.activeId ?? createId("tab"),
  );
  const active = useRef(activeId);
  const sessions = useRef(
    new Map<string, Session>(
      options.initial?.tabs.map((tab) => [tab.id, tab.session]),
    ),
  );
  const [ids, setIds] = useState(
    options.initial?.tabs.map((tab) => tab.id) ?? [activeId],
  );
  const [busy, setBusy] = useState(false);
  const transitioning = useRef(false);
  const live = options.capture();
  const liveIds = useRef(ids);
  liveIds.current = ids;
  useEffect(() => {
    if (options.initial) {
      current.current.restore(sessions.current.get(active.current)!);
      setActivated(true);
    }
  }, []);
  const persist = (final: boolean) => {
    if (!current.current.persist || !activatedRef.current) return;
    current.current.persist(
      {
        activeId: active.current,
        tabs: liveIds.current.map((id) => ({
          id,
          session:
            id === active.current
              ? current.current.capture()
              : sessions.current.get(id)!,
        })),
      },
      final,
    );
  };
  const persistenceRef = useRef(persist);
  persistenceRef.current = persist;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // First-change scheduling cannot be starved by continuous edits or dragging.
  useEffect(() => {
    if (timer.current === null && options.persist)
      timer.current = setTimeout(() => {
        timer.current = null;
        persistenceRef.current(false);
      }, 150);
  });
  useEffect(() => {
    const final = () => persistenceRef.current(true);
    const hidden = () => {
      if (document.visibilityState === "hidden") final();
    };
    window.addEventListener("pagehide", final);
    window.addEventListener("beforeunload", final);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      // A render crash unmounts this hook before pagehide. The controller still
      // holds acknowledged edits; journal them before removing the listeners.
      final();
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      window.removeEventListener("pagehide", final);
      window.removeEventListener("beforeunload", final);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);
  const describe = (id: string) =>
    options.describe(id === activeId ? live : sessions.current.get(id)!);
  const transition = async (operation: () => void) => {
    if (transitioning.current) return false;
    transitioning.current = true;
    setBusy(true);
    try {
      if (!(await current.current.prepare())) return false;
      sessions.current.set(active.current, current.current.capture());
      operation();
      return true;
    } catch (error) {
      current.current.onError(
        error instanceof Error ? error.message : String(error),
      );
      return false;
    } finally {
      transitioning.current = false;
      setBusy(false);
    }
  };
  const activate = (id: string) => {
    current.current.restore(sessions.current.get(id)!);
    active.current = id;
    setActiveId(id);
  };
  const select = (id: string) =>
    id === active.current
      ? Promise.resolve(true)
      : transition(() => activate(id));
  return {
    activeId,
    busy,
    tabs: ids.map((id) => ({ id, ...describe(id) })),
    hasUnsafeTabs: ids.some((id) => describe(id).unsafe),
    select,
    open: (create: () => Session, cloudId?: string | null) => {
      const existing = cloudId
        ? ids.find((id) => describe(id).cloudId === cloudId)
        : undefined;
      if (existing) return select(existing);
      return transition(() => {
        const id = createId("tab");
        sessions.current.set(id, create());
        setIds((previous) => [...previous, id]);
        activate(id);
      });
    },
    close: async (id: string, createEmpty: () => Session) => {
      if (transitioning.current) return;
      const description = describe(id);
      if (
        description.dirty &&
        !window.confirm(
          `Close “${description.name}” without saving? Its browser recovery copy is retained.`,
        )
      )
        return;
      if (id !== active.current) {
        sessions.current.delete(id);
        setIds((previous) => previous.filter((candidate) => candidate !== id));
        return;
      }
      await transition(() => {
        const remaining = ids.filter((candidate) => candidate !== id);
        if (id === active.current) {
          if (remaining.length)
            activate(remaining[Math.max(0, ids.indexOf(id) - 1)]!);
          else {
            const emptyId = createId("tab");
            sessions.current.set(emptyId, createEmpty());
            remaining.push(emptyId);
            activate(emptyId);
          }
        }
        sessions.current.delete(id);
        setIds(remaining);
      });
    },
  };
}
