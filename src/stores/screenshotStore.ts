import { create } from "zustand";

export interface ScreenshotItem {
  id: string;
  timestamp: number;
  path: string;
  thumbnail: string;
}

interface ScreenshotStore {
  items: ScreenshotItem[];
  setItems: (items: ScreenshotItem[]) => void;
  prepend: (item: ScreenshotItem) => void;
  remove: (id: string) => void;
}

export const useScreenshotStore = create<ScreenshotStore>((set) => ({
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
