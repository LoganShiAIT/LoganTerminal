import type { SidebarTab } from "../../../stores/uiStore";
import type { PromptSnippet } from "../../../stores/promptStore";
import { sendTermCmd } from "../../../lib/termBus";
import { kbd } from "../../../lib/keys";
import { t } from "../../../i18n";
import { settings, ui, type PaletteAction } from "./types";

/** Panels, sidebars and the finder — what is on screen. */
export function viewActions(
  sidebarTab: SidebarTab,
  s: { mathInline: boolean; mathAutoFollow: boolean },
): PaletteAction[] {
  const view = t("View");
  return [
    {
      id: "file-search",
      group: t("Files"),
      label: t("Find file or folder in this project"),
      hint: kbd("⌘⇧F"),
      keepFocus: true,
      run: () => ui().setFileSearchOpen(true),
    },
    {
      id: "view-sidebar",
      group: view,
      label: t("Toggle sidebar"),
      hint: kbd("⌘B"),
      run: () => ui().toggleSidebar(),
    },
    {
      id: "view-files",
      group: view,
      label: t("Show file tree"),
      hint: kbd("⌘J"),
      active: sidebarTab === "files",
      run: () => ui().openSidebarPanel("files"),
    },
    {
      id: "view-assets",
      group: view,
      label: t("Show assets panel"),
      active: sidebarTab === "assets",
      run: () => ui().openSidebarPanel("assets"),
    },
    {
      id: "view-review",
      group: view,
      label: t("Show review panel"),
      active: sidebarTab === "review",
      run: () => ui().openSidebarPanel("review"),
    },
    {
      id: "view-diff",
      group: view,
      label: t("Show git diff panel"),
      hint: kbd("⌘⇧G"),
      active: sidebarTab === "diff",
      run: () => ui().openSidebarPanel("diff"),
    },
    {
      id: "view-math",
      group: view,
      label: t("Render selection as math / markdown"),
      hint: kbd("⌘⇧M"),
      keepFocus: true,
      active: sidebarTab === "math",
      run: () => {
        sendTermCmd("send-selection");
        ui().openSidebarPanel("math");
      },
    },
    {
      id: "math-inline",
      group: view,
      label: t("Toggle inline math underline in terminal output"),
      active: s.mathInline,
      run: () => settings().toggleMathInline(),
    },
    {
      id: "math-auto-follow",
      group: view,
      label: t("Toggle math panel auto-follow"),
      active: s.mathAutoFollow,
      run: () => settings().toggleMathAutoFollow(),
    },
    {
      id: "view-settings",
      group: view,
      label: t("Open settings"),
      hint: kbd("⌘,"),
      keepFocus: true,
      run: () => settings().setPanelOpen(true),
    },
  ];
}

/**
 * Saved prompt snippets (managed in Settings) — inserted through the paste
 * channel so a multi-line prompt lands as one bracketed paste.
 */
export function promptActions(prompts: PromptSnippet[]): PaletteAction[] {
  return prompts.map((p) => ({
    id: `prompt-${p.id}`,
    group: t("Prompts"),
    label: t("Insert prompt: {title}", { title: p.title }),
    run: () => sendTermCmd({ kind: "paste", text: p.text }),
  }));
}
