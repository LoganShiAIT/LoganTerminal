import { useEffect, useRef } from "react";
import { Terminal as XTerm } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { usePtyStore } from "../../stores/ptyStore";
import { useSettingsStore } from "../../stores/settingsStore";
import "@xterm/xterm/css/xterm.css";

interface TerminalProps {
  tabId: string;
  active: boolean;
  initialCwd?: string | null;
}

export default function Terminal({ tabId, active, initialCwd }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef(active);
  useEffect(() => {
    activeRef.current = active;
  }, [active]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;

    const term = new XTerm({
      fontFamily:
        '"Menlo", "Cascadia Code", "JetBrains Mono", "Consolas", monospace',
      fontSize: useSettingsStore.getState().fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      theme: {
        background: "#14100d",
        foreground: "#f5efe8",
        cursor: "#d97757",
        cursorAccent: "#14100d",
        selectionBackground: "rgba(217, 119, 87, 0.3)",
        black: "#2a201b",
        red: "#f87171",
        green: "#86d68a",
        yellow: "#e6b264",
        blue: "#7aa5d9",
        magenta: "#c084fc",
        cyan: "#5eb3b3",
        white: "#f5efe8",
        brightBlack: "#5a4a42",
        brightRed: "#fca5a5",
        brightGreen: "#a5e6a8",
        brightYellow: "#f5c785",
        brightBlue: "#a3c1e0",
        brightMagenta: "#d8b4fe",
        brightCyan: "#8fcfcf",
        brightWhite: "#faf6f1",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new WebLinksAddon());
    term.open(container);

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
          });
          unlistenExit = await listen(`pty://exit/${id}`, () => {
            term.writeln("\r\n\x1b[31m[process exited]\x1b[0m");
            exited = true;
          });
          unlistenCwd = await listen<string>(`pty://cwd/${id}`, (e) => {
            usePtyStore.getState().setCwd(tabId, e.payload);
          });
          unlistenAgent = await listen<string | null>(
            `pty://agent/${id}`,
            (e) => {
              usePtyStore.getState().setAgentName(tabId, e.payload ?? null);
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
          usePtyStore.getState().setSessionId(tabId, id);
          term.onData((data) => {
            if (sessionId && !exited) invoke("pty_write", { sessionId, data });
          });
        } catch (err) {
          unlistenData?.();
          unlistenExit?.();
          unlistenCwd?.();
          unlistenAgent?.();
          sessionId = null;
          usePtyStore.getState().setSessionId(tabId, null);
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

    const unsubFont = useSettingsStore.subscribe((s) => {
      if (term.options.fontSize !== s.fontSize) {
        term.options.fontSize = s.fontSize;
        onSize();
      }
    });

    const onKey = (e: KeyboardEvent) => {
      if (!activeRef.current) return;
      const mod = e.metaKey || e.ctrlKey;
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
      }
    };
    window.addEventListener("keydown", onKey);

    const focusOnClick = () => term.focus();
    container.addEventListener("mousedown", focusOnClick);

    return () => {
      disposed = true;
      ro.disconnect();
      unsubFont();
      window.removeEventListener("keydown", onKey);
      container.removeEventListener("mousedown", focusOnClick);
      unlistenData?.();
      unlistenExit?.();
      unlistenCwd?.();
      unlistenAgent?.();
      if (sessionId && !exited) {
        invoke("pty_kill", { sessionId });
      }
      term.dispose();
    };
  }, [tabId, initialCwd]);

  return <div ref={containerRef} className="w-full h-full p-2" />;
}
