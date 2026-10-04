import { create } from "zustand";
export type WorkspaceEntry =
  | { id: string; kind: "terminal"; companionId: string | null; ratio: number }
  | { id: string; kind: "document" };
export type WorkspaceFocus =
  | { kind: "terminal"; tabId: string; paneId?: string }
  | {
      kind: "document";
      documentId: string;
      placement: "main" | "companion";
      tabId?: string;
    };
interface WorkspaceStore {
  entries: WorkspaceEntry[];
  activeId: string | null;
  focus: WorkspaceFocus | null;
  notice: string | null;
  syncTerminals: (ids: string[], activeId?: string | null) => void;
  focusTerminal: (id: string, paneId?: string) => void;
  openDocument: (id: string, beside?: string | null) => void;
  focusDocument: (id: string, tabId?: string) => void;
  remove: (id: string) => void;
  detach: (tabId: string) => void;
  setRatio: (tabId: string, ratio: number) => void;
  move: (from: number, to: number) => void;
  setNotice: (notice: string | null) => void;
}
const terminalEntry = (id: string): WorkspaceEntry => ({
  id,
  kind: "terminal",
  companionId: null,
  ratio: 0.45,
});
export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  entries: [],
  activeId: null,
  focus: null,
  notice: null,
  syncTerminals: (ids, activeId) => {
    const previous = get();
    const entries = previous.entries.filter(
      (e) => e.kind !== "terminal" || ids.includes(e.id),
    );
    ids.forEach((id) => {
      if (!entries.some((e) => e.id === id)) entries.push(terminalEntry(id));
    });
    const changed =
      entries.length !== previous.entries.length ||
      entries.some((e, i) => e !== previous.entries[i]);
    if (changed) set({ entries });
    if (activeId && entries.some((e) => e.id === activeId))
      get().focusTerminal(activeId);
    else if (!entries.some((e) => e.id === get().activeId)) {
      const entry =
        entries[
          Math.min(
            Math.max(
              0,
              previous.entries.findIndex((e) => e.id === previous.activeId),
            ),
            entries.length - 1,
          )
        ];
      set({
        activeId: entry?.id ?? null,
        focus: entry
          ? entry.kind === "terminal"
            ? { kind: "terminal", tabId: entry.id }
            : { kind: "document", documentId: entry.id, placement: "main" }
          : null,
      });
    }
  },
  focusTerminal: (id, paneId) => {
    if (!get().entries.some((e) => e.id === id && e.kind === "terminal"))
      return;
    const current = get();
    if (
      current.activeId === id &&
      current.focus?.kind === "terminal" &&
      current.focus.tabId === id &&
      current.focus.paneId === paneId
    )
      return;
    set({ activeId: id, focus: { kind: "terminal", tabId: id, paneId } });
  },
  openDocument: (id, beside) => {
    if (!get().entries.some((e) => e.id === id))
      set((s) => ({ entries: [...s.entries, { id, kind: "document" }] }));
    if (
      beside &&
      get().entries.some((e) => e.id === beside && e.kind === "terminal")
    ) {
      set((s) => ({
        entries: s.entries.map((e) =>
          e.id === beside && e.kind === "terminal"
            ? { ...e, companionId: id }
            : e,
        ),
      }));
      get().focusDocument(id, beside);
    } else get().focusDocument(id);
  },
  focusDocument: (id, tabId) => {
    const current = get();
    const placement = tabId ? "companion" : "main";
    if (
      current.activeId === (tabId || id) &&
      current.focus?.kind === "document" &&
      current.focus.documentId === id &&
      current.focus.placement === placement &&
      current.focus.tabId === tabId
    )
      return;
    set({
      activeId: tabId || id,
      focus: { kind: "document", documentId: id, placement, tabId },
    });
  },
  remove: (id) => {
    const s = get();
    const index = s.entries.findIndex((e) => e.id === id);
    const entries = s.entries
      .filter((e) => e.id !== id)
      .map((e) =>
        e.kind === "terminal" && e.companionId === id
          ? { ...e, companionId: null }
          : e,
      );
    const next = entries[index] ?? entries[index - 1];
    const activeId = s.activeId === id ? (next?.id ?? null) : s.activeId;
    let focus = s.focus;
    if (
      (focus?.kind === "document" && focus.documentId === id) ||
      s.activeId === id
    ) {
      const entry = entries.find((e) => e.id === activeId);
      focus = entry
        ? entry.kind === "terminal"
          ? { kind: "terminal", tabId: entry.id }
          : { kind: "document", documentId: entry.id, placement: "main" }
        : null;
    }
    set({ entries, activeId, focus });
  },
  detach: (tabId) => {
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === tabId && e.kind === "terminal"
          ? { ...e, companionId: null }
          : e,
      ),
    }));
    get().focusTerminal(tabId);
  },
  setRatio: (id, ratio) =>
    set((s) => ({
      entries: s.entries.map((e) =>
        e.id === id && e.kind === "terminal"
          ? { ...e, ratio: Math.max(0.25, Math.min(0.65, ratio)) }
          : e,
      ),
    })),
  move: (from, to) =>
    set((s) => {
      if (
        from < 0 ||
        to < 0 ||
        from >= s.entries.length ||
        to >= s.entries.length
      )
        return s;
      const entries = [...s.entries];
      const [entry] = entries.splice(from, 1);
      entries.splice(to, 0, entry);
      return { entries };
    }),
  setNotice: (notice) => set({ notice }),
}));
