import { useEffect, useRef, useState } from "react";
import { useAgentLauncherStore } from "../../stores/agentLauncherStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { enabledLaunchers, launchLine } from "../../lib/agentLaunchers";
import { launchAgent } from "../../lib/launchAgent";
import { sendTermCmd } from "../../lib/termBus";
import { useEscapeClose } from "../../lib/useEscapeClose";
import { kbd } from "../../lib/keys";
import { useT } from "../../i18n";
import { BoltIcon, SplitIcon } from "../icons";

/**
 * The ⚡ button in the header: every configured agent CLI, one click away.
 *
 * A row starts the agent in a new tab at the focused pane's directory; the
 * split button on the row puts it beside the current pane instead. Each row
 * shows the *resolved* command line, flags included — with bypass on, that
 * line is the whole reason to read before clicking.
 *
 * The popover is absolutely positioned inside the header rather than portaled:
 * the header's `backdrop-blur` would make a `fixed` child position against the
 * header anyway, and an absolute child of a relative wrapper is honest about
 * that instead of relying on it.
 */
export default function AgentLaunchMenu() {
  const t = useT();
  const launchers = useAgentLauncherStore((s) => s.launchers);
  const bypass = useAgentLauncherStore((s) => s.bypassPermissions);
  const toggleBypass = useAgentLauncherStore((s) => s.toggleBypass);
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);

  // Esc goes through the shared capture-phase hook (the focused xterm
  // textarea would otherwise swallow it); a click anywhere outside the
  // wrapper dismisses too.
  useEscapeClose(open, () => {
    setOpen(false);
    sendTermCmd("focus");
  });

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  const visible = enabledLaunchers(launchers);

  const launch = (index: number, mode: "tab" | "split") => {
    setOpen(false);
    launchAgent(visible[index], mode);
  };

  return (
    <div ref={wrapRef} className="relative shrink-0">
      <button
        className={`w-7 h-7 grid place-items-center rounded-lg transition-colors ${
          open
            ? "text-accent bg-accent/[0.08]"
            : "text-muted hover:text-accent hover:bg-accent/[0.08]"
        }`}
        onClick={() => setOpen((v) => !v)}
        title={t("Launch an agent CLI ({key} for the first one)", {
          key: kbd("⌘⇧L"),
        })}
      >
        <BoltIcon />
      </button>

      {open && (
        <div
          data-tauri-drag-region="false"
          className="absolute right-0 top-9 z-50 w-[290px] rounded-xl border border-edge bg-raise/95 backdrop-blur-xl shadow-[0_18px_50px_rgba(0,0,0,0.5)] overflow-hidden animate-[pop-in_0.12s_ease-out]"
        >
          <div className="px-3 pt-2.5 pb-1.5 text-[12px] uppercase tracking-[0.18em] text-muted">
            {t("Launch agent")}
          </div>

          {visible.length === 0 ? (
            <div className="px-3 pb-3 text-[13px] leading-relaxed text-faint">
              {t("No launchers enabled — turn one on in Settings.")}
            </div>
          ) : (
            <div className="pb-1">
              {visible.map((launcher, i) => (
                <div
                  key={launcher.id}
                  className="group mx-1.5 flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-ink/80 transition-colors hover:bg-accent/[0.12] hover:text-ink"
                  onClick={() => launch(i, "tab")}
                  title={t("New tab running {cmd}", {
                    cmd: launchLine(launcher, bypass),
                  })}
                >
                  <div className="min-w-0 flex-1">
                    <div className="text-[14px]">{launcher.name}</div>
                    <div className="truncate font-mono text-[12px] text-faint">
                      {launchLine(launcher, bypass)}
                    </div>
                  </div>
                  <button
                    className="w-6 h-6 shrink-0 grid place-items-center rounded-md text-muted opacity-0 transition-[opacity,color,background-color] group-hover:opacity-100 hover:bg-ink/10 hover:text-accent"
                    onClick={(e) => {
                      e.stopPropagation();
                      launch(i, "split");
                    }}
                    title={t("Split the current pane instead")}
                  >
                    <SplitIcon size={16} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 border-t border-edge px-3 py-2">
            <button
              className="flex items-center gap-2 text-left"
              onClick={toggleBypass}
              title={t(
                "Adds each CLI's skip-permissions flag. Off launches them with their normal approval prompts.",
              )}
            >
              <span
                className={`w-7 h-[16px] rounded-full p-[2px] transition-colors ${
                  bypass ? "bg-accent" : "bg-ink/15"
                }`}
              >
                <span
                  className={`block w-[12px] h-[12px] rounded-full bg-white/95 transition-transform ${
                    bypass ? "translate-x-[11px]" : ""
                  }`}
                />
              </span>
              <span className="text-[13px] text-ink/75">
                {t("bypass permissions")}
              </span>
            </button>
            <button
              className="ml-auto text-[12px] text-faint transition-colors hover:text-accent"
              onClick={() => {
                setOpen(false);
                useSettingsStore.getState().setPanelOpen(true);
              }}
            >
              {t("Edit…")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
