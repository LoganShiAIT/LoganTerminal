import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  usePtyStore,
  findLeaf,
  collectLeaves,
  paneWhere,
} from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useMathStore } from "../../stores/mathStore";
import { buildXtermTheme, buildSearchDecorations } from "../../themes";
import { onTermCmd } from "../../lib/termBus";
import { notify } from "../../lib/notify";
import { openTerminalLink } from "../../lib/openLink";
import { hasAppMod } from "../../lib/keys";
import { installShellIntegration } from "../../lib/shellIntegration";
import { installMathAwareness } from "../../lib/mathAwareness";
import type { GitStatusInfo } from "../../lib/git";
import "@xterm/xterm/css/xterm.css";
import { t } from "../../i18n";

/** Agent TUIs can bell repeatedly; at most one toast per pane per window. */
const BELL_THROTTLE_MS = 30_000;
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

interface TerminalProps {
  tabId: string;
  paneId: string;
  active: boolean;
  initialCwd?: string | null;
}

function searchDecorations() {
  const s = useSettingsStore.getState();
  return buildSearchDecorations(s.themeId, s.accentOverride);
}

function submitsPrompt(data: string): boolean {
  // Prompt snippets and multi-line paste should not look like "sent" just
  // because their pasted body contains line breaks. The user's Enter arrives
  // as a separate \r after the paste lands.
  if (
    data.includes(BRACKETED_PASTE_START) &&
    data.includes(BRACKETED_PASTE_END)
  ) {
    return false;
  }
  return data.includes("\r") || data.includes("\n");
}

export default function Terminal({
  tabId,
  paneId,
  active,
  initialCwd,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [matchInfo, setMatchInfo] = useState<{
    index: number;
    count: number;
  } | null>(null);
  const [atBottom, setAtBottom] = useState(true);
  const activeRef = useRef(active);
  /** Set by the mount effect; lets other effects ask for a rescan. */
  const scanMathRef = useRef<(() => void) | null>(null);
  useEffect(() => {
    activeRef.current = active;
    // Becoming the focused pane makes this terminal the auto-follow source.
    if (active) scanMathRef.current?.();
  }, [active]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const settings = useSettingsStore.getState();
    const term = new XTerm({
      // ui-monospace resolves to SF Mono on macOS / Cascadia Mono on Windows.
      fontFamily:
        'ui-monospace, "Menlo", "Cascadia Code", "JetBrains Mono", "Consolas", monospace',
      fontSize: settings.fontSize,
      lineHeight: 1.2,
      cursorBlink: settings.cursorBlink,
      cursorStyle: settings.cursorStyle,
      smoothScrollDuration: 120,
      allowProposedApi: true,
      theme: buildXtermTheme(settings.themeId, settings.accentOverride),
      // Explicit OSC 8 hyperlinks (agents emit these for file references).
      // window.open is dead in a Tauri webview, so route through the
      // opener plugin; non-http protocols are filtered inside the handler.
      linkHandler: {
        activate: (_e, text) => openTerminalLink(text),
        allowNonHttpProtocols: true,
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    // Same opener route for plain-text URLs the addon detects by regex.
    term.loadAddon(new WebLinksAddon((_e, uri) => openTerminalLink(uri)));
    const search = new SearchAddon();
    term.loadAddon(search);
    // Correct emoji/CJK cell widths — AI CLIs print plenty of both.
    term.loadAddon(new Unicode11Addon());
    term.unicode.activeVersion = "11";
    term.open(container);
    // GPU renderer; on context loss or unsupported WebGL2 xterm falls back
    // to the DOM renderer, so failures here are non-fatal.
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch (err) {
      console.warn("WebGL renderer unavailable, using DOM renderer", err);
    }
    termRef.current = term;
    searchRef.current = search;

    const searchResults = search.onDidChangeResults(
      ({ resultIndex, resultCount }) => {
        setMatchInfo({ index: resultIndex, count: resultCount });
      },
    );

    const shell = installShellIntegration(term, { tabId, paneId });

    const updateAtBottom = () => {
      const buf = term.buffer.active;
      setAtBottom(buf.viewportY >= buf.baseY);
    };
    const scrollDisposable = term.onScroll(updateAtBottom);

    const math = installMathAwareness(term, {
      isActive: () => activeRef.current,
    });
    scanMathRef.current = math.scheduleScan;

    const writeDisposable = term.onWriteParsed(() => {
      updateAtBottom();
      math.scheduleScan();
    });

    // BEL: agent CLIs ring it when they need input. Marks the pane dot
    // (store no-ops when this pane is being watched) and pings the OS when
    // out of view — the toast names the detected agent when there is one.
    let lastBellToast = 0;
    const bellDisposable = term.onBell(() => {
      const store = usePtyStore.getState();
      store.markUnread(tabId, paneId);
      // Strong signal: agent TUIs ring when blocked on input. Store no-ops
      // when the pane is being watched.
      store.markAttention(tabId, paneId);
      if (!useSettingsStore.getState().notifyBell) return;
      if (document.hasFocus() && store.activeTabId === tabId) return;
      const now = Date.now();
      if (now - lastBellToast < BELL_THROTTLE_MS) return;
      lastBellToast = now;
      const tab = store.tabs.find((t) => t.id === tabId);
      const leaf = tab ? findLeaf(tab.root, paneId) : undefined;
      notify(
        leaf?.agentName
          ? t("{name} needs attention", { name: leaf.agentName })
          : t("Terminal bell"),
        t("in {where}", { where: paneWhere(tabId, paneId) }),
      );
    });

    // OSC 0/2 window title — surfaces on the tab instead of the cwd.
    const titleDisposable = term.onTitleChange((title) => {
      usePtyStore.getState().setPaneTitle(paneId, title.trim() || null);
    });

    // Busy tracking: an agent CLI streams output while it works and falls
    // silent once it's waiting on the user, so sustained pty output — minus
    // keystroke echo — is the "a task is running here" signal. Chrome that
    // animates on a running agent (the header hairline) reads this flag,
    // which is why merely opening a CLI must not raise it.
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

    // Every `pty://…` subscription for the current session, torn down as one
    // unit — a missed handle here outlives the component and keeps writing
    // into a disposed terminal.
    let unlistenAll: UnlistenFn[] = [];
    const unlistenSession = () => {
      for (const fn of unlistenAll) fn();
      unlistenAll = [];
    };
    let sessionId: string | null = null;
    let disposed = false;
    let spawning = false;
    let exited = false;
    let gitStatusInFlight = false;

    const onSize = async () => {
      if (disposed) return;
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols < 2 || term.rows < 2) return;

      if (!sessionId && !spawning) {
        spawning = true;
        try {
          const id = crypto.randomUUID();
          sessionId = id;
          unlistenAll.push(await listen<string>(`pty://data/${id}`, (e) => {
            term.write(e.payload);
            // Echo of what the user just typed isn't work being done.
            if (Date.now() - lastInputAt >= ECHO_WINDOW_MS) keepBusy();
            // Store no-ops when this pane is the one being watched.
            usePtyStore.getState().markUnread(tabId, paneId);
          }));
          unlistenAll.push(await listen(`pty://exit/${id}`, () => {
            term.writeln(`\r\n\x1b[31m${t("[process exited]")}\x1b[0m`);
            exited = true;
            clearBusy();
            const store = usePtyStore.getState();
            store.markPaneExited(paneId);
            store.markUnread(tabId, paneId);
          }));
          unlistenAll.push(await listen<string>(`pty://cwd/${id}`, (e) => {
            usePtyStore.getState().setCwd(paneId, e.payload);
            // OSC 7 fires every prompt (not just on chdir), so this also
            // catches `git checkout` in place — no polling needed. Branch +
            // dirty counts come back in one round trip; `git status` on a
            // huge cold repo can be slow, so never stack a second query on
            // an unfinished one (the next prompt refreshes anyway).
            if (gitStatusInFlight) return;
            gitStatusInFlight = true;
            invoke<GitStatusInfo | null>("git_status", { cwd: e.payload })
              .then((info) =>
                usePtyStore
                  .getState()
                  .setGitInfo(paneId, info?.branch ?? null, info?.dirty ?? null),
              )
              .catch(() => {})
              .finally(() => {
                gitStatusInFlight = false;
              });
          }));
          unlistenAll.push(
            await listen<string | null>(`pty://agent/${id}`, (e) => {
              usePtyStore.getState().setAgentName(paneId, e.payload ?? null);
            }),
          );

          await invoke<string>("pty_spawn", {
            sessionId: id,
            rows: term.rows,
            cols: term.cols,
            cwd: initialCwd ?? undefined,
          });
          if (disposed) {
            // Unmounted mid-spawn: the effect cleanup already ran (with
            // these handles still null), so tear the listeners down here
            // or they outlive the component.
            invoke("pty_kill", { sessionId: id });
            unlistenSession();
            return;
          }
          usePtyStore.getState().setSessionId(paneId, id);
          {
            // Fleet tabs: type the configured command once, right after
            // spawn — the pty buffers it until the shell's first prompt
            // (iTerm2 "send text at start" mechanism). Consumed immediately
            // so an HMR re-effect or reload can never send it twice.
            const store = usePtyStore.getState();
            const tab = store.tabs.find((t) => t.id === tabId);
            const leaf = tab ? findLeaf(tab.root, paneId) : undefined;
            if (leaf?.initialCmd) {
              invoke("pty_write", {
                sessionId: id,
                data: leaf.initialCmd + "\r",
              }).catch(() => {});
              store.clearInitialCmd(paneId);
            }
          }
          term.onData((data) => {
            if (!sessionId || exited) return;
            const sentAt = submitsPrompt(data) ? Date.now() : null;
            lastInputAt = Date.now();
            // Submitting starts the run: light up now rather than waiting
            // for the agent's first frame to clear the echo window.
            if (sentAt !== null) keepBusy();
            const store = usePtyStore.getState();
            const tab = store.tabs.find((t) => t.id === tabId);
            const activeLeaf = tab ? findLeaf(tab.root, paneId) : undefined;
            invoke("pty_write", { sessionId, data });
            if (sentAt !== null && activeLeaf?.agentName && !activeLeaf.exited) {
              store.markPromptSent(paneId, sentAt);
            }
            // Broadcast: fan the same bytes out to every live sibling pane
            // (tmux synchronize-panes). Same caveat as tmux: any paste
            // wrapping follows the *focused* pane's bracketed-paste mode.
            if (!tab?.broadcast) return;
            for (const leaf of collectLeaves(tab.root)) {
              if (leaf.id !== paneId && leaf.sessionId && !leaf.exited) {
                invoke("pty_write", { sessionId: leaf.sessionId, data });
                if (sentAt !== null && leaf.agentName) {
                  store.markPromptSent(leaf.id, sentAt);
                }
              }
            }
          });
        } catch (err) {
          unlistenSession();
          sessionId = null;
          usePtyStore.getState().setSessionId(paneId, null);
          term.writeln(`\r\n\x1b[31mpty_spawn failed: ${err}\x1b[0m`);
        } finally {
          spawning = false;
        }
      } else if (sessionId && !exited) {
        invoke("pty_resize", {
          sessionId,
          rows: term.rows,
          cols: term.cols,
        });
      }
    };

    const ro = new ResizeObserver(onSize);
    ro.observe(container);

    const unsubSettings = useSettingsStore.subscribe((s, prev) => {
      if (term.options.fontSize !== s.fontSize) {
        term.options.fontSize = s.fontSize;
        onSize();
      }
      if (
        s.themeId !== prev.themeId ||
        s.accentOverride !== prev.accentOverride
      ) {
        term.options.theme = buildXtermTheme(s.themeId, s.accentOverride);
      }
      if (s.cursorStyle !== prev.cursorStyle) {
        term.options.cursorStyle = s.cursorStyle;
      }
      if (s.cursorBlink !== prev.cursorBlink) {
        term.options.cursorBlink = s.cursorBlink;
      }
      if (
        s.mathInline !== prev.mathInline ||
        s.mathAutoFollow !== prev.mathAutoFollow
      ) {
        // Turning either off must take effect now, not at the next write.
        if (!s.mathInline) math.clearDecorations();
        math.scheduleScan();
      }
    });

    // Chrome UI (command palette, header buttons) drives the active terminal
    // through the term bus rather than reaching into this component.
    const unsubTermCmd = onTermCmd((cmd) => {
      if (!activeRef.current) return;
      if (typeof cmd === "object") {
        // term.paste feeds onData like a real ⌘V: newlines normalized and,
        // when the running program enabled bracketed paste, wrapped in the
        // 200~/201~ guards so multi-line text doesn't run line-by-line.
        if (cmd.kind === "paste") term.paste(cmd.text);
        return;
      }
      switch (cmd) {
        case "clear":
          term.clear();
          break;
        case "find":
          setSearchOpen(true);
          break;
        case "scroll-bottom":
          term.scrollToBottom();
          break;
        case "focus":
          term.focus();
          break;
        case "prompt-prev":
          shell.jumpToPrompt(-1);
          break;
        case "prompt-next":
          shell.jumpToPrompt(1);
          break;
        case "select-output":
          shell.selectLastOutput();
          break;
        case "send-selection": {
          // Prefer what the user highlighted; with nothing selected, fall
          // back to the last command's output (the formula an agent just
          // printed is almost always exactly that).
          let text = term.getSelection();
          let origin: "selection" | "output" = "selection";
          if (!text.trim()) {
            shell.selectLastOutput();
            text = term.getSelection();
            origin = "output";
          }
          if (text.trim()) useMathStore.getState().setSource(text, origin);
          break;
        }
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      if (!hasAppMod(e)) return;
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        useSettingsStore.getState().bumpFontSize(1);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        useSettingsStore.getState().bumpFontSize(-1);
      } else if (e.key === "0") {
        e.preventDefault();
        useSettingsStore.getState().resetFontSize();
      } else if (e.key === "k" || e.key === "K") {
        e.preventDefault();
        term.clear();
      } else if ((e.key === "f" || e.key === "F") && !e.shiftKey) {
        e.preventDefault();
        setSearchOpen(true);
      } else if (e.key === "ArrowUp") {
        // Mod+arrows (not plain arrows, which stay with shell history).
        e.preventDefault();
        shell.jumpToPrompt(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        shell.jumpToPrompt(1);
      } else if ((e.key === "a" || e.key === "A") && e.shiftKey) {
        // iTerm2's "Select Output of Last Command" convention; plain ⌘A is
        // left alone so select-all behavior stays untouched.
        e.preventDefault();
        shell.selectLastOutput();
      }
    };
    window.addEventListener("keydown", onKey);

    const focusOnClick = () => term.focus();
    container.addEventListener("mousedown", focusOnClick);

    return () => {
      disposed = true;
      ro.disconnect();
      unsubSettings();
      unsubTermCmd();
      window.removeEventListener("keydown", onKey);
      container.removeEventListener("mousedown", focusOnClick);
      clearBusy();
      unlistenSession();
      if (sessionId && !exited) {
        invoke("pty_kill", { sessionId });
      }
      searchResults.dispose();
      math.dispose();
      scanMathRef.current = null;
      scrollDisposable.dispose();
      writeDisposable.dispose();
      bellDisposable.dispose();
      titleDisposable.dispose();
      shell.dispose();
      termRef.current = null;
      searchRef.current = null;
      term.dispose();
    };
  }, [tabId, paneId, initialCwd]);

  // Focus the search box on open, prefilled from the terminal selection.
  useEffect(() => {
    if (!searchOpen) return;
    const input = searchInputRef.current;
    if (!input) return;
    const selection = termRef.current?.getSelection().trim() ?? "";
    if (selection && !selection.includes("\n")) {
      input.value = selection;
      searchRef.current?.findNext(selection, {
        incremental: true,
        decorations: searchDecorations(),
      });
    }
    input.focus();
    input.select();
  }, [searchOpen]);

  const findNext = () => {
    const q = searchInputRef.current?.value ?? "";
    if (q)
      searchRef.current?.findNext(q, { decorations: searchDecorations() });
  };

  const findPrev = () => {
    const q = searchInputRef.current?.value ?? "";
    if (q)
      searchRef.current?.findPrevious(q, { decorations: searchDecorations() });
  };

  const closeSearch = () => {
    setSearchOpen(false);
    setMatchInfo(null);
    searchRef.current?.clearDecorations();
    termRef.current?.clearSelection();
    termRef.current?.focus();
  };

  return (
    <div className="relative w-full h-full">
      {/* pl-3 gives the text a gutter; pr-1 keeps the xterm scrollbar near the edge. */}
      <div ref={containerRef} className="w-full h-full pl-3 pr-1 py-2" />

      {searchOpen && (
        <div className="absolute top-1.5 right-3 z-10 flex items-center gap-0.5 h-8 pl-2.5 pr-1 rounded-lg border border-edge bg-raise/95 backdrop-blur-md shadow-[0_4px_20px_rgba(0,0,0,0.45)] animate-[pop-in_0.12s_ease-out]">
          <input
            ref={searchInputRef}
            type="text"
            spellCheck={false}
            placeholder={t("find")}
            className="w-40 bg-transparent font-mono text-xs text-ink placeholder:text-faint focus:outline-none"
            onChange={(e) => {
              const q = e.target.value;
              if (q) {
                searchRef.current?.findNext(q, {
                  incremental: true,
                  decorations: searchDecorations(),
                });
              } else {
                searchRef.current?.clearDecorations();
                termRef.current?.clearSelection();
                setMatchInfo(null);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                if (e.shiftKey) findPrev();
                else findNext();
              } else if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                closeSearch();
              }
            }}
          />
          <span className="font-mono text-[10px] text-faint min-w-[3.2em] text-center shrink-0">
            {matchInfo
              ? matchInfo.count > 0
                ? `${matchInfo.index + 1}/${matchInfo.count}`
                : "0/0"
              : ""}
          </span>
          <button
            className="w-6 h-6 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-ink/10 transition-colors"
            onClick={findPrev}
            title={t("Previous match (⇧↩)")}
          >
            <ChevronIcon dir="up" />
          </button>
          <button
            className="w-6 h-6 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-ink/10 transition-colors"
            onClick={findNext}
            title={t("Next match (↩)")}
          >
            <ChevronIcon dir="down" />
          </button>
          <button
            className="w-6 h-6 grid place-items-center rounded-md text-[13px] leading-none text-muted hover:text-ink hover:bg-ink/10 transition-colors"
            onClick={closeSearch}
            title={t("Close (esc)")}
          >
            ×
          </button>
        </div>
      )}

      {!atBottom && (
        <button
          className="absolute bottom-3 right-4 z-10 w-8 h-8 grid place-items-center rounded-full border border-edge bg-raise/90 backdrop-blur-md text-accent shadow-[0_2px_12px_rgba(0,0,0,0.4)] hover:bg-accent hover:text-white transition-colors animate-[pop-in_0.12s_ease-out]"
          onClick={() => {
            termRef.current?.scrollToBottom();
            termRef.current?.focus();
          }}
          title={t("Scroll to bottom")}
        >
          <ChevronIcon dir="down" />
        </button>
      )}
    </div>
  );
}

function ChevronIcon({ dir }: { dir: "up" | "down" }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={dir === "up" ? "rotate-180" : ""}
    >
      <path d="M3.5 6l4.5 4.5L12.5 6" />
    </svg>
  );
}
