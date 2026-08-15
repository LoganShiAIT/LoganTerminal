import { create } from "zustand";
import {
  DEFAULT_LAUNCHERS,
  MAX_LAUNCHERS,
  mergeLaunchers,
  type AgentLauncher,
} from "../lib/agentLaunchers";

/**
 * The one-click agent launchers (header ⚡ menu, ⌘P, ⌘⇧L) and the global
 * bypass-permissions switch.
 *
 * Only the user-editable fields are persisted — `mergeLaunchers` rebuilds the
 * built-ins from code on every load, so shipping a new launcher (or fixing a
 * renamed flag) reaches people who already have a saved list.
 */
const LAUNCHERS_KEY = "logan.agentLaunchers";
const BYPASS_KEY = "logan.agentBypass";

function load(): AgentLauncher[] {
  try {
    const raw = localStorage.getItem(LAUNCHERS_KEY);
    return mergeLaunchers(raw ? JSON.parse(raw) : null);
  } catch {
    return mergeLaunchers(null);
  }
}

function save(launchers: AgentLauncher[]) {
  try {
    localStorage.setItem(
      LAUNCHERS_KEY,
      JSON.stringify(
        launchers.map(({ id, name, command, bypassArgs, bypassEnv, enabled }) => ({
          id,
          name,
          command,
          bypassArgs,
          bypassEnv,
          enabled,
        })),
      ),
    );
  } catch {
    // Persistence is best-effort; the list stays session-only.
  }
}

/** Editable fields — id/builtin are structure, not preference. */
export type LauncherPatch = Partial<
  Pick<AgentLauncher, "name" | "command" | "bypassArgs" | "bypassEnv">
>;

interface AgentLauncherStore {
  launchers: AgentLauncher[];
  /**
   * Append each launcher's bypass flags. On by default: this whole feature
   * exists to skip the approval prompts, and the switch is the way back out
   * (it is also what the palette/menu labels reflect).
   */
  bypassPermissions: boolean;
  updateLauncher: (id: string, patch: LauncherPatch) => void;
  toggleLauncher: (id: string) => void;
  toggleBypass: () => void;
  /** Custom entry; ignored when the name or command is blank. */
  addLauncher: (name: string, command: string, bypassArgs?: string) => void;
  /** Built-ins are hidden with `toggleLauncher` instead — this is a no-op on them. */
  removeLauncher: (id: string) => void;
  /** Back to the shipped list, dropping custom entries and every edit. */
  resetLaunchers: () => void;
}

function loadBypass(): boolean {
  const raw = localStorage.getItem(BYPASS_KEY);
  return raw === null ? true : raw === "1";
}

export const useAgentLauncherStore = create<AgentLauncherStore>((set) => ({
  launchers: load(),
  bypassPermissions: loadBypass(),

  updateLauncher: (id, patch) =>
    set((s) => ({
      launchers: s.launchers.map((l) =>
        l.id === id
          ? {
              ...l,
              ...patch,
              // A blank display name would leave an unclickable menu row.
              name: (patch.name ?? l.name).trim() || l.name,
            }
          : l,
      ),
    })),

  toggleLauncher: (id) =>
    set((s) => ({
      launchers: s.launchers.map((l) =>
        l.id === id ? { ...l, enabled: !l.enabled } : l,
      ),
    })),

  toggleBypass: () =>
    set((s) => {
      const bypassPermissions = !s.bypassPermissions;
      try {
        localStorage.setItem(BYPASS_KEY, bypassPermissions ? "1" : "0");
      } catch {
        // best-effort
      }
      return { bypassPermissions };
    }),

  addLauncher: (name, command, bypassArgs = "") =>
    set((s) => {
      const trimmedName = name.trim();
      const trimmedCommand = command.trim();
      if (!trimmedName || !trimmedCommand) return s;
      if (s.launchers.length >= MAX_LAUNCHERS) return s;
      return {
        launchers: [
          ...s.launchers,
          {
            id: crypto.randomUUID(),
            name: trimmedName,
            command: trimmedCommand,
            bypassArgs: bypassArgs.trim(),
            bypassEnv: "",
            enabled: true,
            builtin: false,
          },
        ],
      };
    }),

  removeLauncher: (id) =>
    set((s) => ({
      launchers: s.launchers.filter((l) => l.id !== id || l.builtin),
    })),

  resetLaunchers: () => set({ launchers: DEFAULT_LAUNCHERS.map((l) => ({ ...l })) }),
}));

useAgentLauncherStore.subscribe((state, prev) => {
  if (state.launchers !== prev.launchers) save(state.launchers);
});
