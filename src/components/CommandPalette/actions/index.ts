import { activeLeafOf } from "../../../stores/ptyStore";
import { dirLabel } from "../../../lib/paths";
import { activateWorkspace } from "../../../lib/workspace";
import { t } from "../../../i18n";
import { documentActions } from "./documents";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useMemo } from "react";
import { usePtyStore } from "../../../stores/ptyStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useUiStore } from "../../../stores/uiStore";
import { usePromptStore } from "../../../stores/promptStore";
import { useAgentLauncherStore } from "../../../stores/agentLauncherStore";
import type { PaletteAction } from "./types";
import { agentActions } from "./agents";
import { tabActions, paneActions } from "./workspace";
import { terminalActions } from "./terminal";
import { viewActions, promptActions } from "./view";
import { appearanceActions } from "./appearance";

export type { PaletteAction } from "./types";

/**
 * Everything the palette can run, in display order — the groups are listed
 * here in the order a user is most likely to want them.
 *
 * The builders are plain functions of the state they render, which keeps each
 * one testable and means this hook is only responsible for subscribing. It
 * takes the whole settings store rather than a dozen selectors: nearly every
 * field feeds an `active` dot anyway, so a narrower subscription would fire
 * just as often for more code.
 */
export function useActions(): PaletteAction[] {
  const tabs = usePtyStore((s) => s.tabs);
  const activeTabId = usePtyStore((s) => s.activeTabId);
  const sidebarTab = useUiStore((s) => s.sidebarTab);
  const prompts = usePromptStore((s) => s.prompts);
  const launchers = useAgentLauncherStore((s) => s.launchers);
  const bypass = useAgentLauncherStore((s) => s.bypassPermissions);
  const settings = useSettingsStore();
  const workspace = useWorkspaceStore();
  const documents = useDocumentStore((s) => s.documents);
  const terminalFocus = workspace.focus?.kind === "terminal";

  return useMemo(
    () => [
      ...agentActions(
        tabs,
        activeTabId,
        settings.fleetCommand,
        launchers,
        bypass,
      ),
      ...tabActions(tabs, activeTabId).filter(
        (a) =>
          !a.id.startsWith("tab-") ||
          ["tab-new", "tab-close", "tab-next", "tab-prev"].includes(a.id),
      ),
      ...workspace.entries.map((entry, i) => {
        const tab = tabs.find((tab) => tab.id === entry.id);
        const leaf = tab ? activeLeafOf(tab) : null;
        const label =
          entry.kind === "document"
            ? (documents[entry.id]?.title ?? t("Document"))
            : leaf?.title || dirLabel(leaf?.cwd ?? leaf?.initialCwd ?? "shell");
        return {
          id: `workspace-${entry.id}`,
          group: t("Tabs"),
          label: `${i + 1} · ${label}`,
          active: entry.id === workspace.activeId,
          transient: true,
          run: () => activateWorkspace(entry.id),
        };
      }),
      ...documentActions(),
      ...(terminalFocus ? paneActions(tabs, activeTabId) : []),
      ...(terminalFocus ? terminalActions(settings) : []),
      ...viewActions(sidebarTab, settings),
      ...promptActions(prompts),
      ...appearanceActions(settings),
    ],
    [
      tabs,
      activeTabId,
      sidebarTab,
      prompts,
      launchers,
      bypass,
      settings,
      workspace,
      documents,
    ],
  );
}
