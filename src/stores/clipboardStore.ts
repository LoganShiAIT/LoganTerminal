import { create } from "zustand";

export type ClipboardKind = "text" | "image";

export interface ClipboardItem {
  id: string;
  timestamp: number;
  kind: ClipboardKind;
  preview: string;
  full_text: string | null;
  image_path: string | null;
}

interface ClipboardStore {
  items: ClipboardItem[];
  setItems: (items: ClipboardItem[]) => void;
  prepend: (item: ClipboardItem) => void;
  remove: (id: string) => void;
}

export const useClipboardStore = create<ClipboardStore>((set) => ({
  items: [],
  setItems: (items) => set({ items }),
  prepend: (item) =>
    set((state) => ({
      items: [item, ...state.items.filter((i) => i.id !== item.id)].slice(
        0,
        20,
      ),
    })),
  remove: (id) =>
    set((state) => ({ items: state.items.filter((i) => i.id !== id) })),
}));
