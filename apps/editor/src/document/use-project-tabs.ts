import { useEffect, useRef, useState } from "react";
import { createId } from "@icm/model";

/** The tab that takes over when `id` leaves, with any others `leaving`:
 * the nearest one left before it, else the first after it; undefined when
 * no other tab remains. */
export function tabAfterLeaving(
  ids: readonly string[],
  id: string,
  leaving: ReadonlySet<string> = new Set([id]),
): string | undefined {
  const at = ids.indexOf(id);
  const stays = (candidate: string) => !leaving.has(candidate);
  return (
    ids.slice(0, at).reverse().find(stays) ?? ids.slice(at + 1).find(stays)
  );
}

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
    galleryId: string | null;
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
  /**
   * Close several tabs at once, as Close Others and Close All do. When the
   * active tab closes, tabAfterLeaving takes over, else a new tab from
   * `createEmpty`.
   */
  const closeMany = async (
    closing: readonly string[],
    createEmpty: () => Session,
  ) => {
    if (transitioning.current) return;
    const gone = new Set(closing);
    const drop = (remaining: string[]) => {
      for (const id of gone) sessions.current.delete(id);
      liveIds.current = remaining;
      setIds(remaining);
    };
    if (!gone.has(active.current)) {
      drop(liveIds.current.filter((id) => !gone.has(id)));
      return;
    }
    await transition(() => {
      const before = liveIds.current;
      const remaining = before.filter((id) => !gone.has(id));
      const next = tabAfterLeaving(before, active.current, gone);
      if (next) activate(next);
      else {
        const emptyId = createId("tab");
        sessions.current.set(emptyId, createEmpty());
        remaining.push(emptyId);
        activate(emptyId);
      }
      drop(remaining);
    });
  };
  return {
    activeId,
    busy,
    tabs: ids.map((id) => ({ id, ...describe(id) })),
    hasUnsafeTabs: ids.some((id) => describe(id).unsafe),
    select,
    entries: () =>
      liveIds.current.map((id) => ({
        id,
        session:
          id === active.current
            ? current.current.capture()
            : sessions.current.get(id)!,
      })),
    changed: () => {
      setIds((previous) => [...previous]);
      persistenceRef.current(false);
    },
    open: (
      create: () => Session,
      cloudId?: string | null,
      galleryId?: string | null,
    ) => {
      const existing = ids.find(
        (id) =>
          (cloudId && describe(id).cloudId === cloudId) ||
          (galleryId && describe(id).galleryId === galleryId),
      );
      if (existing) return select(existing);
      return transition(() => {
        const id = createId("tab");
        sessions.current.set(id, create());
        setIds((previous) => [...previous, id]);
        activate(id);
      });
    },
    openBackground: (create: () => Session, cloudId?: string | null) => {
      if (transitioning.current) return false;
      const existing = cloudId
        ? liveIds.current.find((id) => describe(id).cloudId === cloudId)
        : undefined;
      if (existing) return true;
      const id = createId("tab");
      sessions.current.set(id, create());
      liveIds.current = [...liveIds.current, id];
      setIds(liveIds.current);
      persistenceRef.current(false);
      return true;
    },
    /**
     * Bring a closed window's tabs into this one (#1250). They follow the
     * open tabs, the one that was active there becomes active, a tab for an
     * already open Cloud Project is not doubled, and an untouched blank
     * placeholder gives way to them.
     */
    adopt: (
      incoming: {
        session: Session;
        cloudId: string | null;
        active: boolean;
      }[],
      replaceActive: boolean,
    ) =>
      transition(() => {
        const added = incoming
          .filter(
            ({ cloudId }) =>
              !cloudId ||
              !liveIds.current.some((id) => describe(id).cloudId === cloudId),
          )
          .map(({ session, active: wasActive }) => {
            const id = createId("tab");
            sessions.current.set(id, session);
            return { id, wasActive };
          });
        if (!added.length) return;
        const outgoing = active.current;
        const next = [
          ...liveIds.current.filter((id) => !replaceActive || id !== outgoing),
          ...added.map(({ id }) => id),
        ];
        liveIds.current = next;
        setIds(next);
        activate((added.find(({ wasActive }) => wasActive) ?? added[0]!).id);
        if (replaceActive) sessions.current.delete(outgoing);
      }),
    /** Close one tab; the tab strip owns the user's decision first. */
    close: (id: string, createEmpty: () => Session) =>
      closeMany([id], createEmpty),
    closeMany,
    /**
     * Drop a tab whose edits the person chose not to keep (#1288). Unlike
     * close, nothing of it is captured, prepared or staged first, so its
     * content cannot come back with the window's saved tabs. The last tab
     * gives way to `createEmpty`. False while another tab change runs.
     */
    discard: (id: string, createEmpty: () => Session) => {
      if (transitioning.current) return false;
      const before = liveIds.current;
      const remaining = before.filter((candidate) => candidate !== id);
      if (id === active.current) {
        const next = tabAfterLeaving(before, id) ?? createId("tab");
        if (!remaining.length) {
          sessions.current.set(next, createEmpty());
          remaining.push(next);
        }
        activate(next);
      }
      sessions.current.delete(id);
      liveIds.current = remaining;
      setIds(remaining);
      return true;
    },
  };
}
