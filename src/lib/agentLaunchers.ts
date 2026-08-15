/**
 * The agent CLIs the app can start in one click, and the flag each one needs
 * to skip its own permission prompts.
 *
 * The flags live in data rather than in the launch code because they are the
 * part most likely to drift: every CLI spells "stop asking me" differently and
 * renames it between releases. A user who hits a renamed flag edits one field
 * in Settings instead of waiting for a new build.
 *
 * Nothing here touches a store or a terminal — see `lib/launchAgent.ts` for
 * that — so the merge/parse rules below are unit-testable on their own.
 */
export interface AgentLauncher {
  /** Stable key; the id of a built-in never changes, even if its command does. */
  id: string;
  /** Display name in the launcher menu and the palette. */
  name: string;
  /** The binary (or shell function) to run. */
  command: string;
  /** Appended when the bypass switch is on. Empty = nothing to append. */
  bypassArgs: string;
  /**
   * `KEY=VALUE` pairs prefixed to the command when the bypass switch is on —
   * some harnesses take their "don't ask" setting from the environment rather
   * than argv (DeepSeek's `dsh` is one). POSIX-shell syntax, so a Windows
   * PowerShell pane would need this edited into a `$env:` form.
   */
  bypassEnv: string;
  /** Hidden entries stay in the list but out of every launch surface. */
  enabled: boolean;
  /** Shipped with the app: editable and hideable, but never deletable. */
  builtin: boolean;
}

/**
 * Shipped launchers, in menu order.
 *
 * Each entry's bypass setting is that CLI's own "don't ask, just do it"
 * switch, taken from its actual argument parser rather than by analogy — they
 * disagree more than you would expect, and a flag borrowed from a sibling tool
 * is rejected outright. All of them are genuinely dangerous (an agent started
 * this way can edit and run anything in the directory it starts in), which is
 * why the bypass switch exists and why the resolved command line is shown on
 * every surface that can launch one.
 */
export const DEFAULT_LAUNCHERS: readonly AgentLauncher[] = [
  {
    id: "claude",
    name: "Claude Code",
    command: "claude",
    bypassArgs: "--dangerously-skip-permissions",
    bypassEnv: "",
    enabled: true,
    builtin: true,
  },
  {
    id: "codex",
    name: "Codex",
    command: "codex",
    bypassArgs: "--dangerously-bypass-approvals-and-sandbox",
    bypassEnv: "",
    enabled: true,
    builtin: true,
  },
  {
    // Ships disabled: Z.ai releases ZCode as a desktop app only and puts no
    // `zcode` on PATH, so for most people this entry would launch a command
    // that does not exist. Enable it if you have a terminal entry point for
    // the runtime — the settings below are already correct for one.
    //
    // Z.ai's runtime calls this mode "yolo" and accepts it only through
    // `--mode`. Its own --help also advertises `--permission-mode <mode>` as a
    // legacy alias, but that line is stale: the flag reaches neither argv
    // parser and dies with "Unknown option". `--dangerously-skip-permissions`
    // is likewise rejected.
    id: "zcode",
    name: "ZCode",
    command: "zcode",
    bypassArgs: "--mode yolo",
    bypassEnv: "",
    enabled: false,
    builtin: true,
  },
  {
    // `agy` is what the Antigravity CLI installer puts on PATH — there is no
    // `antigravity` binary, only whatever shell alias people write themselves.
    id: "antigravity",
    name: "Antigravity",
    command: "agy",
    bypassArgs: "--dangerously-skip-permissions",
    bypassEnv: "",
    enabled: true,
    builtin: true,
  },
  {
    // DeepSeek Harness has no bypass *flag*; its shipped profile config reads
    // `mode: process.env.DSH_PERMISSION_MODE ?? 'workspace-write'` and flips
    // the approval policy to 'never' only for `danger-full-access`. Note what
    // 'never' means there: approval requests are deterministically *rejected*,
    // not auto-approved — it only reads as a bypass because the same value
    // also opens the sandbox, so nothing has to escalate.
    id: "deepseek-harness",
    name: "DeepSeek Harness",
    command: "dsh web",
    bypassArgs: "",
    bypassEnv: "DSH_PERMISSION_MODE=danger-full-access",
    enabled: true,
    builtin: true,
  },
  {
    // The gentlest of the bunch, and the only one that stays gentle: its own
    // help reads "auto-approve permissions that are not explicitly denied
    // (dangerous!)" — so a `deny` rule in opencode.json still wins, unlike the
    // others here, which hand over everything.
    id: "opencode",
    name: "opencode",
    command: "opencode",
    bypassArgs: "--auto",
    bypassEnv: "",
    enabled: true,
    builtin: true,
  },
] as const;

/** Cap on custom entries — the menu is a menu, not a database. */
export const MAX_LAUNCHERS = 16;

/**
 * The line typed into a fresh shell. Empty command = nothing to run, which
 * callers treat as "don't launch anything" rather than spawning a bare shell
 * they didn't ask for.
 */
export function launchLine(launcher: AgentLauncher, bypass: boolean): string {
  const command = launcher.command.trim();
  if (!command) return "";
  if (!bypass) return command;
  return [launcher.bypassEnv.trim(), command, launcher.bypassArgs.trim()]
    .filter(Boolean)
    .join(" ");
}

export function enabledLaunchers(launchers: AgentLauncher[]): AgentLauncher[] {
  return launchers.filter((l) => l.enabled && l.command.trim());
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}

/**
 * Rebuild the list from whatever was persisted.
 *
 * Built-ins are re-emitted from `DEFAULT_LAUNCHERS` with only the three
 * user-editable fields taken from storage. That ordering matters: a launcher
 * added to a later version of the app appears for existing users instead of
 * being frozen out by their saved list, and a truncated or hand-edited entry
 * can never delete a built-in.
 */
export function mergeLaunchers(raw: unknown): AgentLauncher[] {
  const stored = Array.isArray(raw) ? raw.filter(isRecord) : [];
  const byId = new Map<string, Record<string, unknown>>();
  for (const entry of stored) {
    const id = str(entry.id);
    if (id && !byId.has(id)) byId.set(id, entry);
  }

  const merged: AgentLauncher[] = DEFAULT_LAUNCHERS.map((def) => {
    const saved = byId.get(def.id);
    if (!saved) return { ...def };
    return {
      ...def,
      name: str(saved.name, def.name).trim() || def.name,
      command: str(saved.command, def.command),
      bypassArgs: str(saved.bypassArgs, def.bypassArgs),
      bypassEnv: str(saved.bypassEnv, def.bypassEnv),
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : def.enabled,
    };
  });

  const builtinIds = new Set(DEFAULT_LAUNCHERS.map((d) => d.id));
  for (const saved of stored) {
    const id = str(saved.id);
    const name = str(saved.name).trim();
    const command = str(saved.command).trim();
    if (!id || builtinIds.has(id) || !name || !command) continue;
    if (merged.some((l) => l.id === id)) continue;
    merged.push({
      id,
      name,
      command,
      bypassArgs: str(saved.bypassArgs),
      bypassEnv: str(saved.bypassEnv),
      enabled: typeof saved.enabled === "boolean" ? saved.enabled : true,
      builtin: false,
    });
    if (merged.length >= MAX_LAUNCHERS) break;
  }

  return merged;
}
