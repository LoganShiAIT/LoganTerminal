import { create } from "zustand";

export const MIN_FONT_SIZE = 9;
export const MAX_FONT_SIZE = 28;
export const DEFAULT_FONT_SIZE = 13;

const FONT_SIZE_KEY = "logan.fontSize";

function loadFontSize(): number {
  const raw = localStorage.getItem(FONT_SIZE_KEY);
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n)
    ? Math.max(MIN_FONT_SIZE, Math.min(MAX_FONT_SIZE, n))
    : DEFAULT_FONT_SIZE;
}

interface SettingsStore {
  fontSize: number;
  bumpFontSize: (delta: number) => void;
  resetFontSize: () => void;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  fontSize: loadFontSize(),
  bumpFontSize: (delta) => {
    const next = Math.max(
      MIN_FONT_SIZE,
      Math.min(MAX_FONT_SIZE, get().fontSize + delta),
    );
    localStorage.setItem(FONT_SIZE_KEY, String(next));
    set({ fontSize: next });
  },
  resetFontSize: () => {
    localStorage.setItem(FONT_SIZE_KEY, String(DEFAULT_FONT_SIZE));
    set({ fontSize: DEFAULT_FONT_SIZE });
  },
}));
