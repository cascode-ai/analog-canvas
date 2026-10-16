import {
  ComponentAuthoringCandidateSchema,
  type ComponentAuthoringCandidate,
  type ComponentAuthoringSnapshot,
  type ComponentAuthoringTarget,
  type NativeComponentCandidate,
} from "@icm/agent-adapter/component-resource";

/** Editing artwork records intent even when its new raw text is deliberately empty. */
export function nativeCandidateEdit(
  previous: NativeComponentCandidate,
  next: NativeComponentCandidate,
): NativeComponentCandidate {
  return previous.artworkInitialized ||
    next.artworkInitialized ||
    next.artworkText !== previous.artworkText ||
    (next.symbolMode === "custom" && previous.symbolMode !== "custom")
    ? { ...next, artworkInitialized: true }
    : next;
}

/** One raw document, shared by the input controls and the Agent adapter. */
export class AuthoringDocument<T> {
  private current: T;
  private checkpoint: string;
  private savedText: string | undefined;
  private appliedText?: string;
  private savedRemoved = false;
  private past: T[] = [];
  private future: T[] = [];
  private listeners = new Set<() => void>();
  private state: { value: T; dirty: boolean; revision: number };
  constructor(
    initial: T,
    private readonly changed: () => void = () => {},
    baseline: "untouched" | "saved" | "applied" = "untouched",
  ) {
    this.current = structuredClone(initial);
    this.checkpoint = JSON.stringify(initial);
    if (baseline === "saved") this.savedText = this.checkpoint;
    if (baseline === "applied") this.appliedText = this.checkpoint;
    this.state = { value: this.current, dirty: false, revision: 0 };
  }
  read = (): T => this.current;
  snapshot = () => this.state;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  get dirty() {
    return (
      this.savedRemoved || JSON.stringify(this.current) !== this.checkpoint
    );
  }
  clearHistory() {
    this.past = [];
    this.future = [];
  }
  get checkpoints() {
    const text = JSON.stringify(this.current);
    return {
      saved: this.savedText !== undefined,
      applied: this.appliedText !== undefined,
      matchesSaved: text === this.savedText,
      matchesApplied: text === this.appliedText,
    };
  }
  private notify() {
    this.state = {
      value: this.current,
      dirty: this.dirty,
      revision: this.state.revision + 1,
    };
    this.changed();
    for (const listener of this.listeners) listener();
  }
  set(next: T) {
    if (JSON.stringify(next) === JSON.stringify(this.current)) return;
    this.past.push(this.current);
    // Undo is bounded by both count and source size.
    let size = this.past.reduce(
      (sum, value) => sum + JSON.stringify(value).length * 2,
      0,
    );
    while (this.past.length > 100 || size > 8 * 1024 * 1024) {
      const removed = this.past.shift()!;
      size -= JSON.stringify(removed).length * 2;
    }
    this.future = [];
    this.current = structuredClone(next);
    this.notify();
  }
  markSaved(value: T = this.current) {
    this.savedRemoved = false;
    this.checkpoint = JSON.stringify(value);
    this.savedText = this.checkpoint;
    this.notify();
  }
  markApplied() {
    this.savedRemoved = false;
    this.checkpoint = JSON.stringify(this.current);
    this.appliedText = this.checkpoint;
    this.notify();
  }
  discard() {
    this.current = JSON.parse(this.checkpoint) as T;
    this.clearHistory();
    this.notify();
  }
  forgetSaved() {
    if (this.savedText === undefined) return;
    this.savedText = undefined;
    if (this.appliedText !== undefined) this.checkpoint = this.appliedText;
    this.savedRemoved = this.appliedText === undefined;
    this.notify();
  }
  undo() {
    const value = this.past.pop();
    if (value === undefined) return false;
    this.future.push(this.current);
    this.current = value;
    this.notify();
    return true;
  }
  redo() {
    const value = this.future.pop();
    if (value === undefined) return false;
    this.past.push(this.current);
    this.current = value;
    this.notify();
    return true;
  }
}

export class ComponentAuthoringError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export interface ComponentAuthoringCommands {
  diagnostics: string[];
  canApply: boolean;
  readOnly?: boolean;
  context?: ComponentAuthoringSnapshot["context"];
  publication?: ComponentAuthoringSnapshot["publication"];
  apply(dryRun: boolean): string | null;
  save(): string | null;
}
type Kind = ComponentAuthoringCandidate["kind"];
type Value<K extends Kind> = K extends "circuit"
  ? NativeComponentCandidate
  : string;

/** A window-local workspace. Its epoch prevents handles surviving close/reopen. */
export class ComponentAuthoringWorkspace {
  readonly target: ComponentAuthoringTarget;
  private revision = 0;
  private active: Kind = "circuit";
  private circuit?: AuthoringDocument<NativeComponentCandidate>;
  private definition?: AuthoringDocument<string>;
  private commands = new Map<
    Kind,
    { revision: number; value: ComponentAuthoringCommands }
  >();
  private composing = false;
  private pending = false;
  get operationPending() {
    return this.pending;
  }
  get storageIdentity() {
    // Storage ownership remains valid while candidate validation is pending.
    return {
      draftId: this.target.draftId,
      ...this.commands.get(this.active)?.value.context,
    };
  }
  private managedCheckpoint?: {
    sourceId: string;
    before: string;
    value: string;
  };
  acceptsManagedCheckpoint(sourceId: string, before: string, current: string) {
    return (
      this.managedCheckpoint?.sourceId === sourceId &&
      this.managedCheckpoint.before === before &&
      this.managedCheckpoint.value === current
    );
  }
  acknowledgeSourceCheckpoint(checkpoint: {
    sourceId: string;
    before: string;
    value: string;
  }) {
    this.managedCheckpoint = checkpoint;
    this.invalidate();
  }
  setOperationPending(value: boolean) {
    if (this.pending !== value) {
      this.pending = value;
      this.invalidate();
    }
  }
  private listeners = new Set<() => void>();
  getRevision = () => this.revision;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  invalidate = () => {
    this.revision++;
    for (const listener of this.listeners) listener();
  };
  private changed = () => {
    this.invalidate();
  };
  constructor(
    target: Omit<ComponentAuthoringTarget, "sessionId">,
    readonly scope: ComponentAuthoringSnapshot["scope"],
    readonly noteAgentEdit: () => void = () => {},
  ) {
    this.target = { ...target, sessionId: crypto.randomUUID() };
  }
  document<K extends Kind>(
    kind: K,
    initial: Value<K>,
    baseline: "untouched" | "saved" | "applied" = "untouched",
  ): AuthoringDocument<Value<K>> {
    if (kind === "circuit") {
      this.circuit ??= new AuthoringDocument(
        initial as NativeComponentCandidate,
        this.changed,
        baseline,
      );
      return this.circuit as AuthoringDocument<Value<K>>;
    }
    this.definition ??= new AuthoringDocument(
      initial as string,
      this.changed,
      baseline,
    );
    return this.definition as AuthoringDocument<Value<K>>;
  }
  activate(kind: Kind) {
    if (this.active !== kind) {
      this.active = kind;
      this.changed();
    }
  }
  discardCurrent() {
    if (this.active === "circuit") this.circuit?.discard();
    else this.definition?.discard();
  }
  forgetSaved() {
    this.circuit?.forgetSaved();
    this.definition?.forgetSaved();
    this.invalidate();
  }
  setComposing(value: boolean) {
    this.composing = value;
  }
  bindCommands(
    kind: Kind,
    commands: ComponentAuthoringCommands,
    revision = this.revision,
  ) {
    if (revision === this.revision)
      this.commands.set(kind, { revision, value: commands });
  }
  snapshot(): ComponentAuthoringSnapshot | null {
    const document = this.active === "circuit" ? this.circuit : this.definition;
    if (!document) return null;
    const commands = this.commands.get(this.active);
    const ready = commands?.revision === this.revision;
    return {
      target: this.target,
      candidateRevision: this.revision,
      scope: this.scope,
      candidate:
        this.active === "circuit"
          ? { kind: "circuit", value: structuredClone(this.circuit!.read()) }
          : { kind: "definition", text: this.definition!.read() },
      dirty: document.dirty,
      readOnly: commands?.value.readOnly ?? false,
      checkpoints: document.checkpoints,
      canApply: Boolean(!this.pending && ready && commands?.value.canApply),
      diagnostics: this.pending
        ? ["Wait for publication to finish before saving or applying."]
        : ready
          ? [...commands!.value.diagnostics]
          : [
              "Candidate validation is pending; reread after the Editor updates.",
            ],
      ...(ready && commands?.value.context
        ? { context: commands.value.context }
        : {}),
      ...(commands?.value.publication
        ? { publication: commands.value.publication }
        : {}),
    };
  }
  private expect(target: ComponentAuthoringTarget, revision: number) {
    if (
      Object.keys(this.target).some(
        (key) =>
          this.target[key as keyof ComponentAuthoringTarget] !==
          target[key as keyof ComponentAuthoringTarget],
      )
    )
      throw new ComponentAuthoringError(
        "AUTHORING_TARGET_CLOSED",
        "This authoring target is no longer open. Read the current workspace.",
      );
    if (revision !== this.revision)
      throw new ComponentAuthoringError(
        "AUTHORING_REVISION_CONFLICT",
        "The candidate changed. Read it again before editing.",
      );
    if (this.composing)
      throw new ComponentAuthoringError(
        "AUTHORING_INPUT_BUSY",
        "The user is composing text. Retry after input completes.",
      );
    if (this.pending)
      throw new ComponentAuthoringError(
        "AUTHORING_OPERATION_BUSY",
        "Wait for publication to finish, then read the candidate again.",
      );
    if (this.commands.get(this.active)?.value.readOnly)
      throw new ComponentAuthoringError(
        "AUTHORING_READ_ONLY",
        "Open an editable candidate before changing it.",
      );
  }
  update(
    target: ComponentAuthoringTarget,
    revision: number,
    candidate: ComponentAuthoringCandidate,
  ) {
    this.expect(target, revision);
    const parsed = ComponentAuthoringCandidateSchema.parse(candidate);
    if (parsed.kind !== this.active)
      throw new ComponentAuthoringError(
        "AUTHORING_KIND_CHANGED",
        "Use the current candidate kind; changing the component type requires the Editor.",
      );
    if (parsed.kind === "circuit")
      this.circuit!.set(
        nativeCandidateEdit(this.circuit!.read(), parsed.value),
      );
    else this.definition!.set(parsed.text);
    return this.snapshot()!;
  }
  run(
    target: ComponentAuthoringTarget,
    revision: number,
    action: "save" | "apply",
    dryRun = false,
  ) {
    this.expect(target, revision);
    const commands = this.commands.get(this.active);
    if (commands?.revision !== this.revision)
      throw new ComponentAuthoringError(
        "AUTHORING_VALIDATION_PENDING",
        "Wait for candidate validation and read the workspace again.",
      );
    const error =
      action === "save" ? commands.value.save() : commands.value.apply(dryRun);
    if (error) throw new ComponentAuthoringError("AUTHORING_INVALID", error);
    return this.snapshot()!;
  }
}

const openWorkspaces = new Map<string, ComponentAuthoringWorkspace>();
export function registerComponentAuthoring(
  workspace: ComponentAuthoringWorkspace,
) {
  const key = workspace.target.projectSessionId;
  openWorkspaces.set(key, workspace);
  return () => {
    if (openWorkspaces.get(key) === workspace) openWorkspaces.delete(key);
  };
}
export function currentComponentAuthoring(projectSessionId: string) {
  return openWorkspaces.get(projectSessionId);
}
