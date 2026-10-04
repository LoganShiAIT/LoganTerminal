import { usePtyStore, getActiveLeaf, activeLeafOf } from "../stores/ptyStore";
import { useDocumentStore, type SnapshotOrigin } from "../stores/documentStore";
import {
  useWorkspaceStore,
  type WorkspaceEntry,
} from "../stores/workspaceStore";
import {
  readWorkspaceSnapshot,
  WORKSPACE_KEY,
  type SavedEntry,
} from "../stores/workspaceSnapshot";
import { serializeNode, saveSnapshot } from "../stores/tabSnapshot";

export function getFocusedTerminalTarget() {
  const w = useWorkspaceStore.getState();
  if (w.focus?.kind !== "terminal" || w.activeId !== w.focus.tabId)
    return undefined;
  const tab = usePtyStore.getState().tabs.find((t) => t.id === w.focus!.tabId);
  return tab ? activeLeafOf(tab) : undefined;
}
export function workspaceCwd(): string | null {
  const focus = useWorkspaceStore.getState().focus;
  if (focus?.kind === "document") {
    const dir =
      useDocumentStore.getState().documents[focus.documentId]?.baseDir;
    if (dir) return dir;
  }
  const leaf = getActiveLeaf();
  return leaf?.cwd ?? leaf?.initialCwd ?? null;
}
export function activateWorkspace(id: string) {
  const entry = useWorkspaceStore.getState().entries.find((e) => e.id === id);
  if (entry?.kind === "terminal") usePtyStore.getState().setActiveTab(id);
  else if (entry) useWorkspaceStore.getState().focusDocument(id);
  restoreSurfaceFocus();
}
export function cycleWorkspace(dir: number) {
  const w = useWorkspaceStore.getState();
  if (w.entries.length)
    activateWorkspace(
      w.entries[
        (w.entries.findIndex((e) => e.id === w.activeId) +
          dir +
          w.entries.length) %
          w.entries.length
      ].id,
    );
}
export function closeWorkspace(id: string) {
  const w = useWorkspaceStore.getState();
  const entry = w.entries.find((e) => e.id === id);
  w.remove(id);
  if (entry?.kind === "terminal") usePtyStore.getState().closeTab(id);
  else useDocumentStore.getState().close(id);
  const next = useWorkspaceStore.getState().activeId;
  if (next) activateWorkspace(next);
}
export function closeFocusedSurface() {
  const w = useWorkspaceStore.getState();
  if (w.focus?.kind === "document") {
    if (w.focus.placement === "companion" && w.focus.tabId)
      w.detach(w.focus.tabId);
    else closeWorkspace(w.focus.documentId);
  } else if (getFocusedTerminalTarget())
    usePtyStore.getState().closeActivePane();
}
export function returnToTerminal() {
  const w = useWorkspaceStore.getState();
  const tabId = w.focus?.kind === "document" ? w.focus.tabId : null;
  const id = tabId || usePtyStore.getState().activeTabId;
  if (id) activateWorkspace(id);
}
export async function openDocumentFile(path: string, beside = false) {
  const tabId = beside ? usePtyStore.getState().activeTabId : null;
  const id = await useDocumentStore.getState().openFile(path);
  useWorkspaceStore.getState().openDocument(id, tabId);
  restoreSurfaceFocus();
  return id;
}
export function openDocumentSnapshot(
  source: string,
  origin: SnapshotOrigin,
  title: string,
  baseDir: string | null,
  beside = false,
  path?: string | null,
  paneId?: string,
) {
  try {
    const id = useDocumentStore
      .getState()
      .snapshot(source, origin, baseDir, title, path, paneId);
    useWorkspaceStore
      .getState()
      .openDocument(id, beside ? usePtyStore.getState().activeTabId : null);
    restoreSurfaceFocus();
    return id;
  } catch (error) {
    useWorkspaceStore.getState().setNotice(String(error));
    return null;
  }
}
export function restoreSurfaceFocus() {
  requestAnimationFrame(() => {
    const focus = useWorkspaceStore.getState().focus;
    if (focus?.kind === "document")
      document
        .querySelector<HTMLElement>(
          `[data-reader-id="${focus.documentId}"][data-placement="${focus.placement}"]`,
        )
        ?.focus({ preventScroll: true });
    else if (focus?.kind === "terminal")
      document
        .querySelector<HTMLElement>(
          `[data-pane-id="${getFocusedTerminalTarget()?.id}"] .xterm-helper-textarea`,
        )
        ?.focus({ preventScroll: true });
  });
}
export function saveWorkspace() {
  const w = useWorkspaceStore.getState();
  const docs = useDocumentStore.getState().documents;
  const tabs = usePtyStore.getState().tabs;
  const entries: SavedEntry[] = w.entries.flatMap((e): SavedEntry[] => {
    if (e.kind === "document") {
      const d = docs[e.id];
      return d?.kind === "file" && d.path
        ? [{ id: e.id, kind: "document", path: d.path, mode: d.mode }]
        : [];
    }
    const tab = tabs.find((t) => t.id === e.id);
    return tab
      ? [
          {
            id: e.id,
            kind: "terminal",
            layout: serializeNode(tab.root),
            ratio: e.ratio,
            companion:
              e.companionId && docs[e.companionId]?.kind === "file"
                ? e.companionId
                : undefined,
          },
        ]
      : [];
  });
  const activeIndex = w.entries.findIndex((e) => e.id === w.activeId);
  const activeId = entries.some((e) => e.id === w.activeId)
    ? w.activeId
    : (w.entries
        .slice(0, activeIndex)
        .reverse()
        .find((e) => entries.some((s) => s.id === e.id))?.id ??
      entries[0]?.id ??
      null);
  try {
    localStorage.setItem(
      WORKSPACE_KEY,
      JSON.stringify({ version: 1, entries, activeId }),
    );
    saveSnapshot(tabs);
  } catch {
    /* best-effort restore */
  }
}
let initialized = false;
export function initializeWorkspace() {
  if (initialized) return;
  initialized = true;
  const saved = readWorkspaceSnapshot();
  const pty = usePtyStore.getState();
  useWorkspaceStore.getState().syncTerminals(
    pty.tabs.map((t) => t.id),
    pty.activeTabId,
  );
  if (saved) {
    let terminalIndex = 0,
      documentCount = 0;
    const ids = new Map<string, string>();
    const entries = saved.entries.flatMap((e): WorkspaceEntry[] => {
      if (e.kind === "terminal") {
        const tab = pty.tabs[terminalIndex++];
        if (!tab || terminalIndex > 9) return [];
        ids.set(e.id, tab.id);
        return [
          {
            id: tab.id,
            kind: "terminal" as const,
            companionId: e.companion ?? null,
            ratio: Math.max(0.25, Math.min(0.65, e.ratio ?? 0.45)),
          },
        ];
      }
      if (++documentCount > 12) return [];
      const id = useDocumentStore.getState().restoreFile(e.path, e.mode);
      ids.set(e.id, id);
      return [{ id, kind: "document" as const }];
    });
    const unique = entries
      .filter((e, i) => entries.findIndex((a) => a.id === e.id) === i)
      .map((e) =>
        e.kind === "terminal"
          ? {
              ...e,
              companionId: e.companionId
                ? (ids.get(e.companionId) ?? null)
                : null,
            }
          : e,
      );
    useWorkspaceStore.setState({
      entries: unique,
      activeId: null,
      focus: null,
    });
    const id = ids.get(saved.activeId ?? "") ?? unique[0]?.id;
    if (id) activateWorkspace(id);
    Object.values(useDocumentStore.getState().documents).forEach(
      (d) => void useDocumentStore.getState().reload(d.id),
    );
  }
  usePtyStore.subscribe((s, prev) => {
    const ids = s.tabs.map((t) => t.id),
      oldIds = prev.tabs.map((t) => t.id);
    if (ids.join() !== oldIds.join())
      useWorkspaceStore
        .getState()
        .syncTerminals(
          ids,
          ids.includes(s.activeTabId ?? "") &&
            !oldIds.includes(s.activeTabId ?? "")
            ? s.activeTabId
            : undefined,
        );
    if (s.tabs !== prev.tabs) saveWorkspace();
  });
  useWorkspaceStore.subscribe((s, prev) => {
    if (s.entries !== prev.entries || s.activeId !== prev.activeId)
      saveWorkspace();
  });
  useDocumentStore.subscribe((s, prev) => {
    if (s.documents !== prev.documents) saveWorkspace();
  });
}
