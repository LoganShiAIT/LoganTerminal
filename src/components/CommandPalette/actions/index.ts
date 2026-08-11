import { useMemo } from "react";
import { usePtyStore } from "../../../stores/ptyStore";
import { useSettingsStore } from "../../../stores/settingsStore";
import { useUiStore } from "../../../stores/uiStore";
import { usePromptStore } from "../../../stores/promptStore";
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
  const rightPanelTab = useUiStore((s) => s.rightPanelTab);
  const prompts = usePromptStore((s) => s.prompts);
  const settings = useSettingsStore();

  return useMemo(
    () => [
      ...agentActions(tabs, activeTabId, settings.fleetCommand),
      ...tabActions(tabs, activeTabId),
      ...paneActions(tabs, activeTabId),
      ...terminalActions(settings),
      ...viewActions(rightPanelTab, settings),
      ...promptActions(prompts),
      ...appearanceActions(settings),
    ],
    [tabs, activeTabId, rightPanelTab, prompts, settings],
  );
}
