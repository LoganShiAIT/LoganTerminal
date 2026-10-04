/**
 * Lifecycle regression: changing the window material or background opacity
 * must update the existing xterm instance's theme in place — never dispose
 * the terminal, never respawn the PTY. jsdom can't run real xterm layout, so
 * the xterm class and the session/integration modules are mocked; the part
 * under test is Terminal.tsx's own subscription wiring.
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTheme } from "../themes";

const mocks = vi.hoisted(() => {
  const instances: any[] = [];
  class FakeTerm {
    options: any;
    buffer = { active: { viewportY: 0, baseY: 0 } };
    unicode = { activeVersion: "6" };
    cols = 80;
    rows = 24;
    dispose = vi.fn();
    constructor(options: any) {
      this.options = options;
      instances.push(this);
    }
    loadAddon() {}
    open() {}
    attachCustomKeyEventHandler() {}
    onScroll() {
      return { dispose() {} };
    }
    onWriteParsed() {
      return { dispose() {} };
    }
    onTitleChange() {
      return { dispose() {} };
    }
    onBell() {
      return { dispose() {} };
    }
    refresh() {}
    focus() {}
    clear() {}
    paste() {}
    scrollToBottom() {}
    getSelection() {
      return "";
    }
    clearSelection() {}
  }
  return {
    instances,
    FakeTerm,
    attachPtySession: vi.fn(() => ({ sync: vi.fn(), dispose: vi.fn() })),
    installShellIntegration: vi.fn(() => ({
      jumpToPrompt: vi.fn(),
      selectLastOutput: vi.fn(),
      dispose: vi.fn(),
    })),
    installMathAwareness: vi.fn(() => ({
      scheduleScan: vi.fn(),
      clearUnderlines: vi.fn(),
      dispose: vi.fn(),
    })),
  };
});

vi.mock("@xterm/xterm", () => ({ Terminal: mocks.FakeTerm }));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));
vi.mock("@xterm/addon-fit", () => ({ FitAddon: class { fit() {} } }));
vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-search", () => ({ SearchAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class { onContextLoss() {} },
}));
vi.mock("@xterm/addon-unicode11", () => ({ Unicode11Addon: class {} }));
vi.mock("../lib/ptySession", () => ({
  attachPtySession: mocks.attachPtySession,
}));
vi.mock("../lib/shellIntegration", () => ({
  installShellIntegration: mocks.installShellIntegration,
}));
vi.mock("../lib/mathAwareness", () => ({
  installMathAwareness: mocks.installMathAwareness,
}));
vi.mock("../lib/notify", () => ({ notify: vi.fn() }));
vi.mock("../lib/openLink", () => ({ openTerminalLink: vi.fn() }));

import Terminal from "../components/Terminal/Terminal";
import { useAppearanceStore } from "../lib/windowAppearance";
import { useSettingsStore } from "../stores/settingsStore";

// jsdom lacks both observers Terminal relies on.
class StubObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("Terminal appearance lifecycle", () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    // Lets act() work with the real react-dom renderer under jsdom.
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("ResizeObserver", StubObserver);
    vi.stubGlobal("IntersectionObserver", StubObserver);
    localStorage.clear();
    useAppearanceStore.setState({
      effectiveMode: "solid",
      material: "none",
      status: "ok",
    });
    host = document.createElement("div");
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(
        createElement(Terminal, { tabId: "t1", paneId: "p1", active: true }),
      );
    });
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
    mocks.instances.length = 0;
    vi.clearAllMocks();
  });

  it("starts with the opaque theme and one PTY session", () => {
    const term = mocks.instances[0];
    expect(term.options.allowTransparency).toBe(true);
    expect(term.options.theme.background).toBe(
      getTheme(useSettingsStore.getState().themeId).xterm.background,
    );
    expect(mocks.attachPtySession).toHaveBeenCalledTimes(1);
  });

  it("swaps the theme in place on glass, without dispose or a new PTY", async () => {
    const term = mocks.instances[0];
    const paletteBefore = { ...term.options.theme };
    await act(async () => {
      useAppearanceStore.setState({
        effectiveMode: "glass",
        material: "vibrancy",
        status: "ok",
      });
    });
    expect(term.options.theme.background).toBe("#00000000");
    // ANSI palette, cursor and selection survive the swap untouched.
    expect(term.options.theme.red).toBe(paletteBefore.red);
    expect(term.options.theme.cursor).toBe(paletteBefore.cursor);
    expect(term.options.theme.selectionBackground).toBe(
      paletteBefore.selectionBackground,
    );
    expect(term.dispose).not.toHaveBeenCalled();
    expect(mocks.attachPtySession).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAppearanceStore.setState({
        effectiveMode: "solid",
        material: "none",
        status: "ok",
      });
    });
    expect(term.options.theme.background).toBe(
      getTheme(useSettingsStore.getState().themeId).xterm.background,
    );
    expect(term.dispose).not.toHaveBeenCalled();
    expect(mocks.attachPtySession).toHaveBeenCalledTimes(1);
  });

  it("does not touch the terminal theme when only the opacity slider moves", async () => {
    const term = mocks.instances[0];
    await act(async () => {
      useAppearanceStore.setState({
        effectiveMode: "glass",
        material: "vibrancy",
        status: "ok",
      });
    });
    const themeRef = term.options.theme;
    await act(async () => {
      useSettingsStore.getState().setBackgroundOpacity(0.5);
    });
    // The opacity lives on the pane's CSS surface, not in the xterm theme.
    expect(term.options.theme).toBe(themeRef);
    expect(term.dispose).not.toHaveBeenCalled();
    expect(mocks.attachPtySession).toHaveBeenCalledTimes(1);
  });
});
