import { create } from "zustand";
import { basename } from "../lib/paths";

export type ReviewKind = "file" | "directory";

export interface ReviewAttachment {
  id: string;
  path: string;
  name: string;
  kind: ReviewKind;
  addedAt: number;
  expanded: boolean;
}

interface ReviewStore {
  attachments: ReviewAttachment[];
  selectedPath: string | null;
  addAttachment: (path: string, kind: ReviewKind, name?: string) => void;
  addAttachments: (
    items: Array<{ path: string; kind: ReviewKind; name?: string }>,
  ) => void;
  removeAttachment: (id: string) => void;
  toggleExpanded: (id: string) => void;
  selectPath: (path: string | null) => void;
}

function makeAttachment(
  path: string,
  kind: ReviewKind,
  name = basename(path),
): ReviewAttachment {
  return {
    id: crypto.randomUUID(),
    path,
    name,
    kind,
    addedAt: Date.now(),
    expanded: kind === "directory",
  };
}

export const useReviewStore = create<ReviewStore>((set) => ({
  attachments: [],
  selectedPath: null,
  addAttachment: (path, kind, name) =>
    set((s) => {
      const existing = s.attachments.find((a) => a.path === path);
      if (existing) return { selectedPath: path };
      return {
        attachments: [...s.attachments, makeAttachment(path, kind, name)],
        selectedPath: path,
      };
    }),
  addAttachments: (items) =>
    set((s) => {
      let selectedPath = s.selectedPath;
      const attachments = [...s.attachments];
      for (const item of items) {
        selectedPath = item.path;
        if (attachments.some((a) => a.path === item.path)) continue;
        attachments.push(makeAttachment(item.path, item.kind, item.name));
      }
      return {
        attachments,
        selectedPath,
      };
    }),
  removeAttachment: (id) =>
    set((s) => {
      const removed = s.attachments.find((a) => a.id === id);
      const attachments = s.attachments.filter((a) => a.id !== id);
      const selectedPath =
        removed && s.selectedPath === removed.path
          ? (attachments[attachments.length - 1]?.path ?? null)
          : s.selectedPath;
      return { attachments, selectedPath };
    }),
  toggleExpanded: (id) =>
    set((s) => ({
      attachments: s.attachments.map((a) =>
        a.id === id ? { ...a, expanded: !a.expanded } : a,
      ),
    })),
  selectPath: (selectedPath) => set({ selectedPath }),
}));
