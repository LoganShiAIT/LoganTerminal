import { usePtyStore } from "../../stores/ptyStore";
import { useAgentLauncherStore } from "../../stores/agentLauncherStore";
import { enabledLaunchers, launchLine } from "../../lib/agentLaunchers";
import { launchAgent } from "../../lib/launchAgent";
import { kbd } from "../../lib/keys";
import { useT } from "../../i18n";
import { BoltIcon } from "../icons";

/** The shortcuts worth learning first, in the order they get used. */
const SHORTCUTS: Array<[string, string]> = [
  ["⌘P", "commands"],
  ["⌘T", "new tab"],
  ["⌘⇧L", "launch agent"],
  ["⌘D", "split"],
  ["⌘⇧Z", "zoom pane"],
  ["⌘F", "find"],
  ["⌘⇧F", "find files"],
  ["⌘K", "clear"],
  ["⌘↑↓", "jump prompts"],
  ["⌘B", "files"],
  ["⌘J", "assets"],
  ["⌘1-9", "jump"],
  ["⌘,", "settings"],
];

/** Shown in place of the terminal grid when no tab is open. */
export default function WelcomeScreen() {
  const t = useT();
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-7">
      <div className="grid h-20 w-20 place-items-center rounded-3xl border border-accent/30 bg-raise/50 backdrop-blur-sm animate-[glow-breathe_4.5s_ease-in-out_infinite]">
        <div className="flex items-end gap-1.5 font-mono text-3xl text-accent">
          ❯
          <span className="inline-block w-[0.55em] h-[1.05em] rounded-[2px] bg-accent/85 animate-[cursor-blink_1.1s_steps(1)_infinite]" />
        </div>
      </div>
      <div className="text-center space-y-2">
        <div className="title-shine text-[18px] font-bold uppercase tracking-[0.32em]">
          LoganTerminal
        </div>
        <div className="font-mono text-[14px] text-muted">
          <span className="type-in">
            {t("a terminal built for AI coding agents")}
          </span>
        </div>
      </div>
      <button
        className="px-4 py-1.5 rounded-full border border-accent/40 text-accent text-[16px] hover:bg-accent/10 hover:border-accent/70 hover:shadow-[0_0_24px_color-mix(in_srgb,var(--color-accent)_35%,transparent)] transition-[color,border-color,box-shadow]"
        onClick={() => usePtyStore.getState().addTab()}
      >
        {t("New Terminal")}
      </button>
      <LaunchRow />

      <div className="flex max-w-[80%] flex-wrap items-center justify-center gap-x-4 gap-y-2 text-[13px] text-faint">
        {SHORTCUTS.map(([keys, label]) => (
          <span key={keys} className="flex items-center gap-1.5">
            <span className="kbd">{kbd(keys)}</span> {t(label)}
          </span>
        ))}
      </div>
    </div>
  );
}

/**
 * Straight-to-work row: an empty window is exactly the moment someone wants
 * an agent, not a shell. Each chip opens a tab already running that CLI, with
 * the resolved command line (bypass flags included) in its tooltip.
 */
function LaunchRow() {
  const t = useT();
  const launchers = useAgentLauncherStore((s) => s.launchers);
  const bypass = useAgentLauncherStore((s) => s.bypassPermissions);
  const visible = enabledLaunchers(launchers);
  if (visible.length === 0) return null;

  return (
    <div className="flex max-w-[80%] flex-wrap items-center justify-center gap-2 -mt-2">
      {visible.map((launcher) => (
        <button
          key={launcher.id}
          className="flex items-center gap-1.5 rounded-full border border-edge px-3 py-1 text-[13px] text-muted transition-colors hover:border-accent/50 hover:text-accent"
          onClick={() => launchAgent(launcher, "tab")}
          title={t("New tab running {cmd}", {
            cmd: launchLine(launcher, bypass),
          })}
        >
          <BoltIcon size={15} />
          {launcher.name}
        </button>
      ))}
    </div>
  );
}
