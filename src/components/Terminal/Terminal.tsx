import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type IMarker } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePtyStore } from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { buildXtermTheme, buildSearchDecorations } from "../../themes";
import { onTermCmd } from "../../lib/termBus";
import "@xterm/xterm/css/xterm.css";

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

const isMac = navigator.userAgent.includes("Mac");

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
  useEffect(() => {
    activeRef.current = active;
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
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
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

    // Shell-integration prompt markers (OSC 133; zsh only — see pty.rs's
    // zshrc hook). Registering directly on xterm's parser keeps markers in
    // perfect sync with the byte offset they were emitted at; a Rust-side
    // parse-then-event round trip could race the write it describes.
    // A;  — new prompt about to render (jump target + failure-tick anchor)
    // B;  — prompt finished rendering, input starts here (unused for now)
    // C;  — command just started executing (clears the stale exit code)
    // D;n — previous command finished with exit code n
    let promptMarks: IMarker[] = [];
    let pendingPromptMark: IMarker | null = null;
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
    const oscHandler = term.parser.registerOscHandler(133, (data) => {
      const [kind, arg] = data.split(";");
      if (kind === "A") {
        promptMarks = promptMarks.filter((m) => !m.isDisposed);
        const mark = term.registerMarker(0);
        if (mark) {
          promptMarks.push(mark);
          pendingPromptMark = mark;
        }
      } else if (kind === "C") {
        usePtyStore.getState().setLastExitCode(paneId, null);
      } else if (kind === "D") {
        const code = arg !== undefined ? parseInt(arg, 10) : NaN;
        if (!Number.isFinite(code)) return true;
        usePtyStore.getState().setLastExitCode(paneId, code);
        if (code !== 0 && pendingPromptMark && !pendingPromptMark.isDisposed) {
          term.registerDecoration({
            marker: pendingPromptMark,
            overviewRulerOptions: { color: "#f87171", position: "left" },
          });
        }
      }
      return true;
    });

    const updateAtBottom = () => {
      const buf = term.buffer.active;
      setAtBottom(buf.viewportY >= buf.baseY);
    };
    const scrollDisposable = term.onScroll(updateAtBottom);
    const writeDisposable = term.onWriteParsed(updateAtBottom);

    let unlistenData: UnlistenFn | null = null;
    let unlistenExit: UnlistenFn | null = null;
    let unlistenCwd: UnlistenFn | null = null;
    let unlistenAgent: UnlistenFn | null = null;
    let sessionId: string | null = null;
    let disposed = false;
    let spawning = false;
    let exited = false;

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
          unlistenData = await listen<string>(`pty://data/${id}`, (e) => {
            term.write(e.payload);
            // Store no-ops when this pane is the one being watched.
            usePtyStore.getState().markUnread(tabId, paneId);
          });
          unlistenExit = await listen(`pty://exit/${id}`, () => {
            term.writeln("\r\n\x1b[31m[process exited]\x1b[0m");
            exited = true;
            const store = usePtyStore.getState();
            store.markPaneExited(paneId);
            store.markUnread(tabId, paneId);
          });
          unlistenCwd = await listen<string>(`pty://cwd/${id}`, (e) => {
            usePtyStore.getState().setCwd(paneId, e.payload);
          });
          unlistenAgent = await listen<string | null>(
            `pty://agent/${id}`,
            (e) => {
              usePtyStore.getState().setAgentName(paneId, e.payload ?? null);
            },
          );

          await invoke<string>("pty_spawn", {
            sessionId: id,
            rows: term.rows,
            cols: term.cols,
            cwd: initialCwd ?? undefined,
          });
          if (disposed) {
            invoke("pty_kill", { sessionId: id });
            return;
          }
          usePtyStore.getState().setSessionId(paneId, id);
          term.onData((data) => {
            if (sessionId && !exited) invoke("pty_write", { sessionId, data });
          });
        } catch (err) {
          unlistenData?.();
          unlistenExit?.();
          unlistenCwd?.();
          unlistenAgent?.();
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
    });

    // Chrome UI (command palette, header buttons) drives the active terminal
    // through the term bus rather than reaching into this component.
    const unsubTermCmd = onTermCmd((cmd) => {
      if (!activeRef.current) return;
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
          jumpToPrompt(-1);
          break;
        case "prompt-next":
          jumpToPrompt(1);
          break;
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      // Mac: ⌘ only, so Ctrl+K (kill-line) etc. still reach the shell.
      const mod = isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey;
      if (!mod) return;
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
        jumpToPrompt(-1);
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        jumpToPrompt(1);
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
      unlistenData?.();
      unlistenExit?.();
      unlistenCwd?.();
      unlistenAgent?.();
      if (sessionId && !exited) {
        invoke("pty_kill", { sessionId });
      }
      searchResults.dispose();
      scrollDisposable.dispose();
      writeDisposable.dispose();
      oscHandler.dispose();
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
            placeholder="find"
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
            title="Previous match (⇧↩)"
          >
            <ChevronIcon dir="up" />
          </button>
          <button
            className="w-6 h-6 grid place-items-center rounded-md text-muted hover:text-ink hover:bg-ink/10 transition-colors"
            onClick={findNext}
            title="Next match (↩)"
          >
            <ChevronIcon dir="down" />
          </button>
          <button
            className="w-6 h-6 grid place-items-center rounded-md text-[13px] leading-none text-muted hover:text-ink hover:bg-ink/10 transition-colors"
            onClick={closeSearch}
            title="Close (esc)"
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
          title="Scroll to bottom"
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
