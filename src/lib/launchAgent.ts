import { workspaceCwd, getFocusedTerminalTarget } from "./workspace";
import { usePtyStore } from "../stores/ptyStore";
import { useAgentLauncherStore } from "../stores/agentLauncherStore";
import { enabledLaunchers, launchLine, type AgentLauncher } from "./agentLaunchers";

/**
 * Where a one-click launch lands. Both reuse the pane tree's existing
 * `initialCmd` rail (the same one fleet tabs use), so the command is typed
 * once into a brand-new shell and never into a session that already has an
 * agent — a "launch" can't collide with whatever is running in front of you.
 */
export type LaunchMode = "tab" | "split";

/** The directory a launch inherits: whatever the focused pane is sitting in. */
function currentCwd(): string | null {
  return workspaceCwd();
}

/** The exact line a launch would type, given the current bypass switch. */
export function resolvedLine(launcher: AgentLauncher): string {
  return launchLine(launcher, useAgentLauncherStore.getState().bypassPermissions);
}

/** Start `launcher` in a new tab (or split) at the focused pane's directory. */
export function launchAgent(launcher: AgentLauncher, mode: LaunchMode = "tab") {
  const line = resolvedLine(launcher);
  if (!line) return;
  const pty = usePtyStore.getState();
  if (mode === "split" && getFocusedTerminalTarget()) pty.splitPane("row", currentCwd(), line);
  else pty.addTab(currentCwd(), line);
}

/**
 * ⌘⇧L — the first enabled launcher, i.e. whichever one sits at the top of the
 * Settings list. Returns false when nothing is enabled.
 */
export function launchPrimaryAgent(mode: LaunchMode = "tab"): boolean {
  const first = enabledLaunchers(useAgentLauncherStore.getState().launchers)[0];
  if (!first) return false;
  launchAgent(first, mode);
  return true;
}
