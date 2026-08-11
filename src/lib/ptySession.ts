import type { Terminal as XTerm } from "@xterm/xterm";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePtyStore, findLeaf, collectLeaves } from "../stores/ptyStore";
import type { GitStatusInfo } from "./git";
import { t } from "../i18n";

/**
 * Silence after which a pane counts as idle again. Generous on purpose: a
 * working agent CLI redraws its spinner every ~100ms, but one stuck in a
 * long tool call may only tick its elapsed counter once a second.
 */
const BUSY_IDLE_MS = 1_500;
/** Output this soon after a keystroke is assumed to be its echo, not work. */
const ECHO_WINDOW_MS = 250;
const BRACKETED_PASTE_START = "\x1b[200~";
const BRACKETED_PASTE_END = "\x1b[201~";

export interface PtySessionHandle {
  /** Spawn on first call, resize on every later one. Safe to call often. */
  sync(rows: number, cols: number): void;
  /** Kill the backend session and drop every subscription. */
  dispose(): void;
}

/**
 * Owns one pane's backend PTY: spawning it, streaming its output into `term`,
 * forwarding keystrokes, and keeping the store's per-pane state (cwd, git,
 * agent, busy, exited) in sync.
 *
 * Split out of the Terminal component so that file is about xterm — this is
 * the half with the lifecycle hazards, and all of them are handled in
 * [`dispose`]: unsubscribing every `pty://…` listener as one unit, and
 * handling an unmount that lands mid-spawn.
 */
export function attachPtySession(
  term: XTerm,
  { tabId, paneId, initialCwd }: { tabId: string; paneId: string; initialCwd?: string | null },
): PtySessionHandle {
  let sessionId: string | null = null;
  let disposed = false;
  let spawning = false;
  let exited = false;
  let gitStatusInFlight = false;
  let unlistenAll: UnlistenFn[] = [];

  const unlistenSession = () => {
    for (const fn of unlistenAll) fn();
    unlistenAll = [];
  };

  // --- busy tracking -------------------------------------------------
  // An agent CLI streams output while it works and falls silent once it is
  // waiting on the user, so sustained pty output — minus keystroke echo — is
  // the "a task is running here" signal. Chrome that animates on a running
  // agent (the header hairline) reads this flag, which is why merely opening
  // a CLI must not raise it. The falling edge is also what starts a pane's
  // idle timer (see LeafPane.agentIdleSinceAt).
  let busy = false;
  let busyTimer: number | null = null;
  let lastInputAt = 0;

  const setBusy = (next: boolean) => {
    if (busy === next) return;
    busy = next;
    usePtyStore.getState().setPaneBusy(paneId, next);
  };
  const keepBusy = () => {
    setBusy(true);
    if (busyTimer !== null) window.clearTimeout(busyTimer);
    busyTimer = window.setTimeout(() => {
      busyTimer = null;
      setBusy(false);
    }, BUSY_IDLE_MS);
  };
  const clearBusy = () => {
    if (busyTimer !== null) window.clearTimeout(busyTimer);
    busyTimer = null;
    setBusy(false);
  };

  /**
   * OSC 7 fires every prompt (not just on chdir), so this also catches
   * `git checkout` in place — no polling needed. Branch + dirty counts come
   * back in one round trip; `git status` on a huge cold repo can be slow, so
   * never stack a second query on an unfinished one (the next prompt
   * refreshes anyway).
   */
  const refreshGit = (cwd: string) => {
    if (gitStatusInFlight) return;
    gitStatusInFlight = true;
    invoke<GitStatusInfo | null>("git_status", { cwd })
      .then((info) =>
        usePtyStore
          .getState()
          .setGitInfo(paneId, info?.branch ?? null, info?.dirty ?? null),
      )
      .catch(() => {})
      .finally(() => {
        gitStatusInFlight = false;
      });
  };

  const subscribe = async (id: string) => {
    unlistenAll.push(
      await listen<string>(`pty://data/${id}`, (e) => {
        term.write(e.payload);
        // Echo of what the user just typed isn't work being done.
        if (Date.now() - lastInputAt >= ECHO_WINDOW_MS) keepBusy();
        // Store no-ops when this pane is the one being watched.
        usePtyStore.getState().markUnread(tabId, paneId);
      }),
    );
    unlistenAll.push(
      await listen(`pty://exit/${id}`, () => {
        term.writeln(`\r\n\x1b[31m${t("[process exited]")}\x1b[0m`);
        exited = true;
        clearBusy();
        const store = usePtyStore.getState();
        store.markPaneExited(paneId);
        store.markUnread(tabId, paneId);
      }),
    );
    unlistenAll.push(
      await listen<string>(`pty://cwd/${id}`, (e) => {
        usePtyStore.getState().setCwd(paneId, e.payload);
        refreshGit(e.payload);
      }),
    );
    unlistenAll.push(
      await listen<string | null>(`pty://agent/${id}`, (e) => {
        usePtyStore.getState().setAgentName(paneId, e.payload ?? null);
      }),
    );
  };

  /**
   * Fleet tabs: type the configured command once, right after spawn — the
   * pty buffers it until the shell's first prompt (iTerm2's "send text at
   * start" mechanism). Consumed immediately so an HMR re-effect or a reload
   * can never send it twice.
   */
  const sendInitialCmd = (id: string) => {
    const store = usePtyStore.getState();
    const tab = store.tabs.find((tb) => tb.id === tabId);
    const leaf = tab ? findLeaf(tab.root, paneId) : undefined;
    if (!leaf?.initialCmd) return;
    invoke("pty_write", { sessionId: id, data: leaf.initialCmd + "\r" }).catch(
      () => {},
    );
    store.clearInitialCmd(paneId);
  };

  const forwardInput = () => {
    term.onData((data) => {
      if (!sessionId || exited) return;
      lastInputAt = Date.now();
      // Submitting starts the run: light up now rather than waiting for the
      // agent's first frame to clear the echo window. Busy also stops the
      // idle timer — it restarts when the agent falls silent.
      if (submitsPrompt(data)) keepBusy();
      invoke("pty_write", { sessionId, data });

      // Broadcast: fan the same bytes out to every live sibling pane (tmux
      // synchronize-panes). Same caveat as tmux: any paste wrapping follows
      // the *focused* pane's bracketed-paste mode. Siblings run their own
      // busy tracking off their pty output; stamping their timers from here
      // would fight it.
      const tab = usePtyStore.getState().tabs.find((tb) => tb.id === tabId);
      if (!tab?.broadcast) return;
      for (const leaf of collectLeaves(tab.root)) {
        if (leaf.id !== paneId && leaf.sessionId && !leaf.exited) {
          invoke("pty_write", { sessionId: leaf.sessionId, data });
        }
      }
    });
  };

  const spawn = async (rows: number, cols: number) => {
    spawning = true;
    try {
      const id = crypto.randomUUID();
      sessionId = id;
      await subscribe(id);
      await invoke<string>("pty_spawn", {
        sessionId: id,
        rows,
        cols,
        cwd: initialCwd ?? undefined,
      });
      if (disposed) {
        // Unmounted mid-spawn: the effect cleanup already ran (with these
        // handles still null), so tear the listeners down here or they
        // outlive the component.
        invoke("pty_kill", { sessionId: id });
        unlistenSession();
        return;
      }
      usePtyStore.getState().setSessionId(paneId, id);
      sendInitialCmd(id);
      forwardInput();
    } catch (err) {
      unlistenSession();
      sessionId = null;
      usePtyStore.getState().setSessionId(paneId, null);
      term.writeln(`\r\n\x1b[31mpty_spawn failed: ${err}\x1b[0m`);
    } finally {
      spawning = false;
    }
  };

  return {
    sync(rows, cols) {
      if (disposed) return;
      if (!sessionId && !spawning) {
        void spawn(rows, cols);
      } else if (sessionId && !exited) {
        invoke("pty_resize", { sessionId, rows, cols });
      }
    },
    dispose() {
      disposed = true;
      clearBusy();
      unlistenSession();
      if (sessionId && !exited) invoke("pty_kill", { sessionId });
    },
  };
}

/**
 * Whether this input chunk submits the prompt. Prompt snippets and
 * multi-line pastes should not look like "sent" just because their pasted
 * body contains line breaks — the user's Enter arrives as a separate \r
 * after the paste lands.
 */
export function submitsPrompt(data: string): boolean {
  if (data.includes(BRACKETED_PASTE_START) && data.includes(BRACKETED_PASTE_END)) {
    return false;
  }
  return data.includes("\r") || data.includes("\n");
}
