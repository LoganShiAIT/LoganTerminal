import type { Terminal as XTerm, IMarker } from "@xterm/xterm";
import { usePtyStore, paneWhere } from "../stores/ptyStore";
import { useSettingsStore } from "../stores/settingsStore";
import { formatDuration } from "./duration";
import { notify } from "./notify";
import { t } from "../i18n";

/** A finished command at least this long pings the OS when out of view. */
export const NOTIFY_AFTER_MS = 10_000;

export interface ShellIntegration {
  /** Scroll to the previous (-1) or next (1) prompt marker. */
  jumpToPrompt: (dir: 1 | -1) => void;
  /** Select the last command's output region. */
  selectLastOutput: () => void;
  dispose: () => void;
}

/**
 * Consume OSC 133 shell-integration markers (zsh + bash — see the rc files in
 * `src-tauri/src/pty/shell_init.rs`) on `term`, and turn them into prompt navigation,
 * output selection, exit-code/duration state, and attention signals.
 *
 * Registering directly on xterm's parser keeps markers in perfect sync with
 * the byte offset they were emitted at; a Rust-side parse-then-event round
 * trip could race the write it describes.
 *
 * - `A`   — new prompt about to render (jump target + failure-tick anchor,
 *           closes the previous command's output region)
 * - `B`   — prompt finished rendering, input starts here (unused for now)
 * - `C`   — command just started executing (clears the stale exit code, opens
 *           the output region ⌘⇧A selects, starts the duration clock; needs
 *           bash >= 4.4 there)
 * - `D;n` — previous command finished with exit code n
 */
export function installShellIntegration(
  term: XTerm,
  { tabId, paneId }: { tabId: string; paneId: string },
): ShellIntegration {
  let promptMarks: IMarker[] = [];
  let pendingPromptMark: IMarker | null = null;
  let cmdStartMark: IMarker | null = null;
  let cmdStartedAt: number | null = null;
  let lastDurationMs: number | null = null;
  let lastOutput: { start: IMarker; end: IMarker } | null = null;

  const jumpToPrompt = (dir: 1 | -1) => {
    promptMarks = promptMarks.filter((m) => !m.isDisposed);
    if (promptMarks.length === 0) return;
    const viewportY = term.buffer.active.viewportY;
    if (dir === -1) {
      for (let i = promptMarks.length - 1; i >= 0; i--) {
        if (promptMarks[i].line < viewportY) {
          term.scrollToLine(promptMarks[i].line);
          return;
        }
      }
      term.scrollToLine(promptMarks[0].line);
    } else {
      for (const mark of promptMarks) {
        if (mark.line > viewportY) {
          term.scrollToLine(mark.line);
          return;
        }
      }
      term.scrollToBottom();
    }
  };

  // The region between the last C (command start) and the A that followed it
  // (next prompt) — i.e. the last command's output.
  const selectLastOutput = () => {
    if (!lastOutput) return;
    const { start, end } = lastOutput;
    if (start.isDisposed || end.isDisposed) return;
    const to = end.line - 1; // stop above the next prompt's row
    if (to < start.line) return; // command printed nothing
    term.selectLines(start.line, to);
    term.scrollToLine(start.line);
  };

  const onPromptStart = () => {
    promptMarks = promptMarks.filter((m) => !m.isDisposed);
    const mark = term.registerMarker(0);
    if (!mark) return;
    promptMarks.push(mark);
    pendingPromptMark = mark;
    if (cmdStartMark && !cmdStartMark.isDisposed) {
      lastOutput = { start: cmdStartMark, end: mark };
    }
    cmdStartMark = null;
  };

  const onCommandStart = () => {
    usePtyStore.getState().setCommandResult(paneId, null, null);
    cmdStartMark = term.registerMarker(0) ?? null;
    cmdStartedAt = Date.now();
  };

  const onCommandDone = (code: number) => {
    // A D with no preceding C (Enter on an empty prompt line) keeps the
    // previous duration — otherwise the chip vanishes while the exit chip
    // persists, which reads as two contradicting states. Only a freshly
    // measured duration may trigger the long-command toast, else an empty
    // Enter would re-announce the previous command.
    const fresh = cmdStartedAt !== null;
    const durationMs =
      cmdStartedAt !== null ? Date.now() - cmdStartedAt : lastDurationMs;
    lastDurationMs = durationMs;
    cmdStartedAt = null;

    const store = usePtyStore.getState();
    store.setCommandResult(paneId, code, durationMs);
    if (code !== 0 && pendingPromptMark && !pendingPromptMark.isDisposed) {
      term.registerDecoration({
        marker: pendingPromptMark,
        overviewRulerOptions: { color: "#f87171", position: "left" },
      });
    }

    const wasLong = fresh && durationMs !== null && durationMs >= NOTIFY_AFTER_MS;
    if (!wasLong) return;
    // A long command finishing is a strong attention signal, independent of
    // the OS-toast preference — the in-app chip always lights up.
    store.markAttention(tabId, paneId);
    // The toast is for "finished while nobody was looking" only (app
    // unfocused or tab hidden — a visible split pane in the active tab counts
    // as looked-at). Panes without a C marker (bash 3.2) never get a
    // duration, so they can't ping either.
    if (!useSettingsStore.getState().notifyLongCommands) return;
    if (document.hasFocus() && store.activeTabId === tabId) return;
    notify(
      code === 0
        ? t("Command finished")
        : t("Command failed (exit {code})", { code }),
      t("{duration} in {where}", {
        duration: formatDuration(durationMs!),
        where: paneWhere(tabId, paneId),
      }),
    );
  };

  const oscHandler = term.parser.registerOscHandler(133, (data) => {
    const [kind, arg] = data.split(";");
    if (kind === "A") {
      onPromptStart();
    } else if (kind === "C") {
      onCommandStart();
    } else if (kind === "D") {
      const code = arg !== undefined ? parseInt(arg, 10) : NaN;
      if (Number.isFinite(code)) onCommandDone(code);
    }
    return true;
  });

  return {
    jumpToPrompt,
    selectLastOutput,
    dispose: () => oscHandler.dispose(),
  };
}
