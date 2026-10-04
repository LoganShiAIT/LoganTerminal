import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({
  drop: null as
    | ((event: { payload: { type: string; paths: string[] } }) => Promise<void>)
    | null,
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (name: string) =>
    name === "clipboard_history"
      ? [
          {
            id: "c",
            kind: "text",
            preview: "do not paste",
            full_text: "do not paste",
            timestamp: Date.now(),
          },
        ]
      : name === "screenshot_history"
        ? []
        : name === "fs_home_dir"
          ? "/home"
          : name === "fs_search"
            ? {
                hits: [
                  {
                    path: "/source/read.md",
                    rel: "read.md",
                    name: "read.md",
                    is_dir: false,
                    is_repo: false,
                    indices: [],
                    score: 1,
                  },
                ],
                total: 1,
                scanned: 1,
                truncated: false,
              }
            : [],
  ),
  convertFileSrc: (s: string) => s,
}));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: vi.fn(async (fn) => {
      mock.drop = fn;
      return () => {};
    }),
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => () => {}),
}));
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useDocumentStore } from "../stores/documentStore";
import { usePtyStore } from "../stores/ptyStore";
import { useUiStore } from "../stores/uiStore";
import AssetPanel from "../components/AssetPanel/AssetPanel";
import FileSearch from "../components/FileSearch/FileSearch";
import { Overlay } from "../components/Overlay/Overlay";
import { useWindowFileDrop } from "./appEffects";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  Element.prototype.scrollIntoView = vi.fn();
  vi.mocked(invoke).mockClear();
  usePtyStore.setState({ tabs: [], activeTabId: null });
  const id = usePtyStore.getState().addTab("/old");
  const pane = usePtyStore.getState().tabs[0].activePaneId;
  usePtyStore.getState().setSessionId(pane, "hidden-session");
  useWorkspaceStore.setState({ entries: [], activeId: null, focus: null });
  useWorkspaceStore.getState().syncTerminals([id], id);
  const doc = useDocumentStore
    .getState()
    .snapshot("# Doc", "scratch", "/source", "Doc");
  useWorkspaceStore.getState().openDocument(doc);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("UI routes during reading", () => {
  it("disables clipboard insertion while retaining asset browsing", async () => {
    await act(async () => root.render(createElement(AssetPanel)));
    host.querySelectorAll("button").forEach((button) => button.click());
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([name]) => name === "pty_write" || name === "paste_to_file",
        ),
    ).toBe(false);
  });
  it("Shift-drop during document focus never writes to a hidden shell", async () => {
    function Drops() {
      useWindowFileDrop();
      return null;
    }
    await act(async () => root.render(createElement(Drops)));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Shift" }));
    await act(async () =>
      mock.drop!({ payload: { type: "drop", paths: ["/some/path"] } }),
    );
    expect(
      vi.mocked(invoke).mock.calls.some(([name]) => name === "pty_write"),
    ).toBe(false);
  });
  it("finder browses document context but insert and cd cannot target the last terminal", async () => {
    useUiStore.getState().setFileSearchOpen(true);
    await act(async () => root.render(createElement(FileSearch)));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 180));
    });
    expect(
      vi
        .mocked(invoke)
        .mock.calls.some(
          ([name, args]) =>
            name === "fs_search" &&
            (args as { root: string }).root === "/source",
        ),
    ).toBe(true);
    const insert = Array.from(host.querySelectorAll("button")).find(
      (b) => b.textContent === "⌘↵",
    )!;
    expect(insert).toBeDefined();
    await act(async () => insert.click());
    expect(
      vi.mocked(invoke).mock.calls.some(([name]) => name === "pty_write"),
    ).toBe(false);
  });
  it("overlay dismissal restores a reader, with no terminal focus command", async () => {
    const id = (useWorkspaceStore.getState().focus as { documentId: string })
      .documentId;
    const reader = document.createElement("section");
    reader.dataset.readerId = id;
    reader.dataset.placement = "main";
    reader.tabIndex = -1;
    document.body.append(reader);
    const focus = vi.spyOn(reader, "focus");
    await act(async () =>
      root.render(
        createElement(Overlay, {
          width: 300,
          onClose: () => {},
          children: "overlay",
        }),
      ),
    );
    await act(async () => root.render(null));
    await new Promise((r) => requestAnimationFrame(r));
    expect(focus).toHaveBeenCalled();
    expect(document.activeElement).toBe(reader);
    reader.remove();
  });
});
