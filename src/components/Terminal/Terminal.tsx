import { getFocusedTerminalTarget, openDocumentSnapshot } from "../../lib/workspace";
import { useWorkspaceStore } from "../../stores/workspaceStore";
import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { usePtyStore, findLeaf, paneWhere } from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { useMathStore } from "../../stores/mathStore";
import { buildXtermTheme } from "../../themes";
import { useAppearanceStore } from "../../lib/windowAppearance";
import { onTermCmd } from "../../lib/termBus";
import { notify } from "../../lib/notify";
import { openTerminalLink } from "../../lib/openLink";
import { hasAppMod } from "../../lib/keys";
import { installShellIntegration } from "../../lib/shellIntegration";
import { installMathAwareness } from "../../lib/mathAwareness";
import { attachPtySession } from "../../lib/ptySession";
import { t } from "../../i18n";
import { ChevronIcon } from "../icons";
import TerminalSearch from "./TerminalSearch";
import "@xterm/xterm/css/xterm.css";

/** Agent TUIs can bell repeatedly; at most one toast per pane per window. */
const BELL_THROTTLE_MS = 30_000;

/** Upper bound on how often a resize gesture is allowed to refit the grid. */
const FIT_THROTTLE_MS = 60;

interface TerminalProps {
  tabId: string;
  paneId: string;
  active: boolean;
  initialCwd?: string | null;
}

/**
 * One xterm instance bound to one pane.
 *
 * This component owns the *terminal*: the addons, the theme, the per-terminal
 * shortcuts, and the term-bus commands the chrome sends it. The backend PTY
 * behind it lives in [`attachPtySession`], and the scrollback search bar in
 * [`TerminalSearch`] — both are lifecycle-heavy enough to be worth their own
 * files.
 */
export default function Terminal({
  tabId,
  paneId,
  active,
  initialCwd,
}: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
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
      // Must be set before the first open(): it enables a transparent default
      // background so glass mode can swap the theme without re-creating the
      // terminal. The pane's own surface paints the base tint underneath.
      allowTransparency: true,
      theme: buildXtermTheme(
        settings.themeId,
        settings.accentOverride,
        useAppearanceStore.getState().effectiveMode === "glass",
      ),
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
    // Gate human keyboard/paste input, while allowing xterm protocol replies
    // to continue servicing background terminal applications.
    term.attachCustomKeyEventHandler(() => getFocusedTerminalTarget()?.id === paneId);
    const gatePaste = (event: ClipboardEvent) => {
      if (getFocusedTerminalTarget()?.id !== paneId) {event.preventDefault(); event.stopImmediatePropagation();}
    };
    container.addEventListener("paste", gatePaste, true);
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

    const shell = installShellIntegration(term, { tabId, paneId });
    const math = installMathAwareness(term, {
      isActive: () => activeRef.current,
    });
    scanMathRef.current = math.scheduleScan;
    const session = attachPtySession(term, { tabId, paneId, initialCwd });

    const updateAtBottom = () => {
      const buf = term.buffer.active;
      setAtBottom(buf.viewportY >= buf.baseY);
    };

    const disposables = [
      term.onScroll(updateAtBottom),
      term.onWriteParsed(() => {
        updateAtBottom();
        math.scheduleScan();
      }),
      // OSC 0/2 window title — surfaces on the tab instead of the cwd.
      term.onTitleChange((title) => {
        usePtyStore.getState().setPaneTitle(paneId, title.trim() || null);
      }),
      term.onBell(makeBellHandler(tabId, paneId)),
    ];

    // Resizing drives the whole session: the first measurement is also what
    // spawns the shell, since a PTY needs real dimensions to start.
    let offscreen = false;
    const onSize = () => {
      // A pane that is off screen — a background tab, or a pane behind a
      // zoomed sibling — is `display: none`, so it has no layout box and
      // getComputedStyle hands FitAddon the *specified* "100%" instead of a
      // used pixel value. FitAddon parses that as 100px and proposes a ~9x5
      // grid: the buffer reflows to nine columns and the pty gets SIGWINCH'd
      // down with it, so whatever TUI is running redraws into a sliver. What
      // you see on the way back is that reflow plus a canvas whose backing
      // store is a frame out of sync with its CSS size — text stretched and
      // blown up. Never measure a pane that isn't rendered.
      if (container.offsetWidth === 0 || container.offsetHeight === 0) {
        offscreen = true;
        return;
      }
      try {
        fit.fit();
      } catch {
        return;
      }
      if (term.cols < 2 || term.rows < 2) return;
      session.sync(term.rows, term.cols);
      if (offscreen) {
        offscreen = false;
        // xterm pauses its renderer while the pane is hidden; repaint at the
        // size we just measured instead of waiting for the next write.
        term.refresh(0, term.rows - 1);
      }
    };

    // Split, close and zoom animate the pane rect for 150ms, and a divider
    // drag fires every frame. Fitting on each of those intermediate widths
    // reflows the buffer and resizes the pty a dozen times for one gesture,
    // which is what leaves a redrawing agent TUI garbled. Fit on the leading
    // frame so dragging still tracks the pointer, then once more after the
    // motion settles.
    let lastFitAt = 0;
    let trailing: number | null = null;
    const requestFit = () => {
      const wait = FIT_THROTTLE_MS - (Date.now() - lastFitAt);
      if (wait <= 0) {
        lastFitAt = Date.now();
        onSize();
        return;
      }
      if (trailing !== null) return;
      trailing = window.setTimeout(() => {
        trailing = null;
        lastFitAt = Date.now();
        onSize();
      }, wait);
    };
    const ro = new ResizeObserver(requestFit);
    ro.observe(container);

    // Coming back from `display: none` is not always a size change the
    // ResizeObserver reports, and a font-size change that arrived while the
    // pane was hidden still has to land. Visibility is the reliable edge.
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[entries.length - 1].isIntersecting) onSize();
      },
      { threshold: 0 },
    );
    io.observe(container);

    const unsubSettings = useSettingsStore.subscribe((s, prev) => {
      if (term.options.fontSize !== s.fontSize) {
        term.options.fontSize = s.fontSize;
        onSize();
      }
      if (s.themeId !== prev.themeId || s.accentOverride !== prev.accentOverride) {
        term.options.theme = buildXtermTheme(
          s.themeId,
          s.accentOverride,
          useAppearanceStore.getState().effectiveMode === "glass",
        );
      }
      if (s.cursorStyle !== prev.cursorStyle) {
        term.options.cursorStyle = s.cursorStyle;
      }
      if (s.cursorBlink !== prev.cursorBlink) {
        term.options.cursorBlink = s.cursorBlink;
      }
      if (s.mathInline !== prev.mathInline || s.mathAutoFollow !== prev.mathAutoFollow) {
        // Turning either off must take effect now, not at the next write.
        if (!s.mathInline) math.clearUnderlines();
        math.scheduleScan();
      }
    });

    // Effective material change: swap only the default background in the
    // existing instance's theme — never a dispose/reopen, and hidden panes
    // get the same update through their own subscriptions.
    const unsubAppearance = useAppearanceStore.subscribe((s, prev) => {
      if (s.effectiveMode === prev.effectiveMode) return;
      const st = useSettingsStore.getState();
      term.options.theme = buildXtermTheme(
        st.themeId,
        st.accentOverride,
        s.effectiveMode === "glass",
      );
    });

    // Chrome UI (command palette, header buttons) drives the active terminal
    // through the term bus rather than reaching into this component.
    const unsubTermCmd = onTermCmd((cmd) => {
      if (!activeRef.current || getFocusedTerminalTarget()?.id !== paneId) return;
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
        case "read-selection":
        case "read-selection-beside": {
          let text = term.getSelection();
          let origin: "selection" | "output" = "selection";
          if (!text.trim()) {term.clearSelection(); shell.selectLastOutput(); text = term.getSelection(); origin = "output";}
          if (!text.trim()) {useWorkspaceStore.getState().setNotice("Select text and try again"); break;}
          const leaf = getFocusedTerminalTarget();
          openDocumentSnapshot(text, origin, origin === "selection" ? t("Terminal selection") : t("Last command output"), leaf?.cwd ?? leaf?.initialCwd ?? null, cmd === "read-selection-beside", null, paneId);
          break;
        }
        case "send-selection":
          sendSelectionToMath(term, shell.selectLastOutput);
          break;
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current || getFocusedTerminalTarget()?.id !== paneId || !hasAppMod(e)) return;
      const s = useSettingsStore.getState();
      if (e.key === "=" || e.key === "+") s.bumpFontSize(1);
      else if (e.key === "-" || e.key === "_") s.bumpFontSize(-1);
      else if (e.key === "0") s.resetFontSize();
      else if (e.key === "k" || e.key === "K") term.clear();
      else if ((e.key === "f" || e.key === "F") && !e.shiftKey) setSearchOpen(true);
      // Mod+arrows (not plain arrows, which stay with shell history).
      else if (e.key === "ArrowUp") shell.jumpToPrompt(-1);
      else if (e.key === "ArrowDown") shell.jumpToPrompt(1);
      // iTerm2's "Select Output of Last Command" convention; plain ⌘A is
      // left alone so select-all behavior stays untouched.
      else if ((e.key === "a" || e.key === "A") && e.shiftKey) shell.selectLastOutput();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);

    const focusOnClick = () => term.focus();
    container.addEventListener("mousedown", focusOnClick);

    return () => {
      ro.disconnect();
      io.disconnect();
      if (trailing !== null) window.clearTimeout(trailing);
      unsubSettings();
      unsubAppearance();
      unsubTermCmd();
      window.removeEventListener("keydown", onKey);
      container.removeEventListener("mousedown", focusOnClick);
      container.removeEventListener("paste", gatePaste, true);
      session.dispose();
      for (const d of disposables) d.dispose();
      math.dispose();
      scanMathRef.current = null;
      shell.dispose();
      termRef.current = null;
      searchRef.current = null;
      term.dispose();
    };
  }, [tabId, paneId, initialCwd]);

  return (
    <div className="relative w-full h-full">
      {/* pl-3 gives the text a gutter; pr-1 keeps the xterm scrollbar near the edge. */}
      <div ref={containerRef} className="w-full h-full pl-3 pr-1 py-2" />

      {searchOpen && (
        <TerminalSearch
          term={termRef.current}
          search={searchRef.current}
          onClose={() => setSearchOpen(false)}
        />
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

/**
 * BEL: agent CLIs ring it when they need input. Marks the pane dot (the store
 * no-ops when this pane is being watched) and pings the OS when out of view —
 * the toast names the detected agent when there is one.
 */
function makeBellHandler(tabId: string, paneId: string) {
  let lastToast = 0;
  return () => {
    const store = usePtyStore.getState();
    store.markUnread(tabId, paneId);
    // Strong signal: agent TUIs ring when blocked on input.
    store.markAttention(tabId, paneId);
    if (!useSettingsStore.getState().notifyBell) return;
    if (document.hasFocus() && store.activeTabId === tabId) return;
    const now = Date.now();
    if (now - lastToast < BELL_THROTTLE_MS) return;
    lastToast = now;
    const tab = store.tabs.find((tb) => tb.id === tabId);
    const leaf = tab ? findLeaf(tab.root, paneId) : undefined;
    notify(
      leaf?.agentName
        ? t("{name} needs attention", { name: leaf.agentName })
        : t("Terminal bell"),
      t("in {where}", { where: paneWhere(tabId, paneId) }),
    );
  };
}

/**
 * Prefer what the user highlighted; with nothing selected, fall back to the
 * last command's output — the formula an agent just printed is almost always
 * exactly that.
 */
function sendSelectionToMath(term: XTerm, selectLastOutput: () => void) {
  let text = term.getSelection();
  let origin: "selection" | "output" = "selection";
  if (!text.trim()) {
    selectLastOutput();
    text = term.getSelection();
    origin = "output";
  }
  if (text.trim()) useMathStore.getState().setSource(text, origin);
}
