import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, createElement, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
const calls = vi.hoisted(() => ({
  spawn: vi.fn(),
  kill: vi.fn(),
  sizes: [] as number[],
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (s: string) => s,
}));
vi.mock("./appEffects", () => ({
  useGlobalKeymap: () => {},
  useWindowFileDrop: () => {},
  usePtyTeardownOnUnload: () => {},
}));
vi.mock("../components/AppHeader/AppHeader", () => ({ default: () => null }));
vi.mock("../components/Sidebar/Sidebar", () => ({
  Sidebar: () => null,
  ResizeHandle: () => null,
}));
vi.mock("../components/Ambient/AmbientLayers", () => ({
  AmbientOrbs: () => null,
  CrtOverlay: () => null,
}));
vi.mock("../components/SidePanel/SidePanel", () => ({ default: () => null }));
vi.mock("../components/DropOverlay/DropOverlay", () => ({
  default: () => null,
}));
vi.mock("../components/Settings/SettingsPanel", () => ({
  default: () => null,
}));
vi.mock("../components/CommandPalette/CommandPalette", () => ({
  default: () => null,
}));
vi.mock("../components/FileSearch/FileSearch", () => ({ default: () => null }));
vi.mock("../components/MathHover/MathHoverLayer", () => ({
  default: () => null,
}));
vi.mock("../components/AgentDashboard/AgentDashboard", () => ({
  default: () => null,
}));
vi.mock("../components/WorktreeModal/WorktreeModal", () => ({
  default: () => null,
}));
vi.mock("../components/AssetPanel/AssetPanel", () => ({
  Lightbox: () => null,
}));
vi.mock("../components/Terminal/Terminal", () => ({
  default: ({ paneId }: { paneId: string }) => {
    useEffect(() => {
      calls.spawn(paneId);
      return () => {
        calls.kill(paneId);
      };
    }, [paneId]);
    return createElement(
      "div",
      { "data-test-terminal": paneId },
      "retained scrollback",
    );
  },
}));
import App from "../App";
import { usePtyStore } from "../stores/ptyStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useDocumentStore } from "../stores/documentStore";
import { useSettingsStore } from "../stores/settingsStore";
import {
  activateWorkspace,
  closeWorkspace,
  openDocumentSnapshot,
} from "./workspace";
import * as math from "./math";
let root: Root, host: HTMLDivElement;
const observers: { callback: ResizeObserverCallback; elements: Element[] }[] =
  [];
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      record: (typeof observers)[number];
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, elements: [] };
        observers.push(this.record);
      }
      observe(el: Element) {
        this.record.elements.push(el);
      }
      disconnect() {}
    },
  );
  observers.length = 0;
  calls.spawn.mockClear();
  calls.kill.mockClear();
  usePtyStore.setState({ tabs: [], activeTabId: null });
  useDocumentStore.setState({ documents: {} });
  useWorkspaceStore.setState({ entries: [], activeId: null, focus: null });
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function resizeMain(width: number) {
  const observer = observers.find((o) =>
    o.elements.some((e) => e.tagName === "MAIN"),
  )!;
  observer.callback(
    [{ contentRect: { width } } as ResizeObserverEntry],
    {} as ResizeObserver,
  );
}
describe("reader mount boundaries", () => {
  it("retains terminal nodes through document navigation, ratio/theme changes and narrow fallback", async () => {
    const tab = usePtyStore.getState().addTab("/project");
    useWorkspaceStore.getState().syncTerminals([tab], tab);
    await act(async () => root.render(createElement(App)));
    const terminalNode = host.querySelector("[data-test-terminal]");
    expect(calls.spawn).toHaveBeenCalledTimes(1);
    let id!: string;
    await act(async () => {
      id = openDocumentSnapshot("# reader", "scratch", "reader", "/project")!;
    });
    expect(host.querySelector("[data-test-terminal]")).toBe(terminalNode);
    await act(async () => {
      useWorkspaceStore.getState().openDocument(id, tab);
      useWorkspaceStore.getState().setRatio(tab, 0.62);
      useSettingsStore.getState().setReaderAppearance("paper");
    });
    expect(calls.kill).not.toHaveBeenCalled();
    expect(calls.spawn).toHaveBeenCalledTimes(1);
    await act(async () => resizeMain(600));
    expect(host.querySelector("[data-terminal-tab]")?.className).toBe("hidden");
    await act(async () => activateWorkspace(tab));
    expect(host.querySelector("[data-terminal-tab]")?.className).not.toBe(
      "hidden",
    );
    await act(async () => resizeMain(1000));
    expect(
      (host.querySelector("[data-terminal-tab]") as HTMLElement).style.width,
    ).toBe("38%");
    await act(async () => closeWorkspace(id));
    expect(calls.kill).not.toHaveBeenCalled();
    expect(host.querySelector("[data-test-terminal]")).toBe(terminalNode);
    await act(async () => closeWorkspace(tab));
    expect(calls.kill).toHaveBeenCalledTimes(1);
  });
  it("does not reparse unchanged text during PTY output state updates, focus and resize", async () => {
    const tab = usePtyStore.getState().addTab("/project");
    useWorkspaceStore.getState().syncTerminals([tab], tab);
    const id = openDocumentSnapshot(
      "# 标题\n\n$$x^2$$",
      "scratch",
      "reader",
      null,
    )!;
    const parse = vi.spyOn(math, "parseMarkdownDocument");
    await act(async () => root.render(createElement(App)));
    const initial = parse.mock.calls.length;
    await act(async () => {
      usePtyStore
        .getState()
        .setPaneBusy(usePtyStore.getState().tabs[0].activePaneId, true);
      resizeMain(900);
    });
    expect(parse).toHaveBeenCalledTimes(initial);
    await act(async () => {
      activateWorkspace(tab);
      activateWorkspace(id);
    });
    expect(parse).toHaveBeenCalledTimes(initial);
  });
});
