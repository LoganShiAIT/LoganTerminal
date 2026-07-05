import { create } from "zustand";

/**
 * Reusable prompt snippets for feeding agents — managed in Settings,
 * inserted from the command palette via the terminal paste channel
 * (bracketed-paste safe, so a multi-line prompt never auto-executes).
 */
export interface PromptSnippet {
  id: string;
  title: string;
  text: string;
}

const STORAGE_KEY = "logan.prompts";
const MAX_PROMPTS = 50;

function load(): PromptSnippet[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is PromptSnippet =>
          p !== null &&
          typeof p === "object" &&
          typeof p.id === "string" &&
          typeof p.title === "string" &&
          typeof p.text === "string",
      )
      .slice(0, MAX_PROMPTS);
  } catch {
    return [];
  }
}

function save(prompts: PromptSnippet[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prompts));
  } catch {
    // localStorage unavailable or full — prompts become session-only.
  }
}

interface PromptStore {
  prompts: PromptSnippet[];
  addPrompt: (title: string, text: string) => void;
  removePrompt: (id: string) => void;
}

export const usePromptStore = create<PromptStore>((set) => ({
  prompts: load(),

  addPrompt: (title, text) =>
    set((s) => {
      const trimmedTitle = title.trim();
      const body = text.replace(/\r\n/g, "\n");
      if (!trimmedTitle || !body.trim()) return s;
      const prompts = [
        { id: crypto.randomUUID(), title: trimmedTitle, text: body },
        ...s.prompts,
      ].slice(0, MAX_PROMPTS);
      return { prompts };
    }),

  removePrompt: (id) =>
    set((s) => ({ prompts: s.prompts.filter((p) => p.id !== id) })),
}));

usePromptStore.subscribe((state, prev) => {
  if (state.prompts !== prev.prompts) save(state.prompts);
});
