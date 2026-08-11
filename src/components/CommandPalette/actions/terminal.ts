import { sendTermCmd } from "../../../lib/termBus";
import { kbd } from "../../../lib/keys";
import { t } from "../../../i18n";
import { settings, type PaletteAction } from "./types";

/**
 * Commands aimed at the focused terminal. They route through the term bus
 * rather than reaching into the xterm instance, so the palette never needs a
 * handle on the component.
 */
export function terminalActions(s: {
  notifyLongCommands: boolean;
  notifyBell: boolean;
}): PaletteAction[] {
  const group = t("Terminal");
  return [
    {
      id: "term-clear",
      group,
      label: t("Clear terminal"),
      hint: kbd("⌘K"),
      run: () => sendTermCmd("clear"),
    },
    {
      id: "term-find",
      group,
      label: t("Find in scrollback"),
      hint: kbd("⌘F"),
      keepFocus: true,
      run: () => sendTermCmd("find"),
    },
    {
      id: "term-bottom",
      group,
      label: t("Scroll to bottom"),
      run: () => sendTermCmd("scroll-bottom"),
    },
    {
      id: "term-prompt-prev",
      group,
      label: t("Jump to previous prompt"),
      hint: kbd("⌘↑"),
      run: () => sendTermCmd("prompt-prev"),
    },
    {
      id: "term-prompt-next",
      group,
      label: t("Jump to next prompt"),
      hint: kbd("⌘↓"),
      run: () => sendTermCmd("prompt-next"),
    },
    {
      id: "term-select-output",
      group,
      label: t("Select last command output"),
      hint: kbd("⌘⇧A"),
      run: () => sendTermCmd("select-output"),
    },
    {
      id: "term-notify-long",
      group,
      label: t("Toggle long-command notifications"),
      active: s.notifyLongCommands,
      run: () => settings().toggleNotifyLongCommands(),
    },
    {
      id: "term-notify-bell",
      group,
      label: t("Toggle bell notifications"),
      active: s.notifyBell,
      run: () => settings().toggleNotifyBell(),
    },
    {
      id: "font-up",
      group,
      label: t("Increase font size"),
      hint: kbd("⌘+"),
      run: () => settings().bumpFontSize(1),
    },
    {
      id: "font-down",
      group,
      label: t("Decrease font size"),
      hint: kbd("⌘−"),
      run: () => settings().bumpFontSize(-1),
    },
    {
      id: "font-reset",
      group,
      label: t("Reset font size"),
      hint: kbd("⌘0"),
      run: () => settings().resetFontSize(),
    },
  ];
}
