import { useSettingsStore } from "../../stores/settingsStore";
import { kbd } from "../../lib/keys";
import { useT } from "../../i18n";
import { useEscapeClose } from "../../lib/useEscapeClose";
import { Overlay } from "../Overlay/Overlay";
import {
  LanguageSection,
  ThemeSection,
  ReaderAppearanceSection,
  AccentSection,
  FontSizeSection,
  CursorSection,
  EffectsSection,
  WindowMaterialSection,
} from "./AppearanceSections";
import {
  NotificationsSection,
  MathSection,
  AgentLaunchersSection,
  AgentsSection,
  PromptsSection,
  FilesSection,
} from "./WorkflowSections";

/**
 * ⌘, — every persisted preference, in one scroll.
 *
 * The sections themselves live in AppearanceSections / WorkflowSections; this
 * file only decides which ones appear and in what order (cosmetic first,
 * since that is what people come here to change).
 */
export default function SettingsPanel() {
  const t = useT();
  const open = useSettingsStore((s) => s.panelOpen);
  const setOpen = useSettingsStore((s) => s.setPanelOpen);

  useEscapeClose(open, () => setOpen(false));

  if (!open) return null;

  return (
    <Overlay width={460} align="center" onClose={() => setOpen(false)}>
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-edge sticky top-0 bg-raise z-10">
        <div className="text-[13px] uppercase tracking-[0.22em] text-accent font-semibold">
          {t("Settings")}
        </div>
        <button
          className="w-6 h-6 grid place-items-center rounded-md text-[16px] leading-none text-muted hover:text-ink hover:bg-ink/10 transition-colors"
          onClick={() => setOpen(false)}
          title={t("Close (esc)")}
        >
          ×
        </button>
      </div>

      <div className="px-5 py-4 space-y-5">
        <LanguageSection />
        <ThemeSection />
        <WindowMaterialSection />
        <ReaderAppearanceSection />
        <AccentSection />
        <FontSizeSection />
        <CursorSection />
        <EffectsSection />
        <NotificationsSection />
        <MathSection />
        <AgentLaunchersSection />
        <AgentsSection />
        <PromptsSection />
        <FilesSection />
      </div>

      <div className="px-5 pb-4 text-[12px] text-faint">
        {t(
          "Changes apply instantly and are remembered across restarts. Tip: everything here is also in the command palette ({key}).",
          { key: kbd("⌘P") },
        )}
      </div>
    </Overlay>
  );
}
