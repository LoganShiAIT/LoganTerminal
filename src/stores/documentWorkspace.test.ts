import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  convertFileSrc: (s: string) => s,
}));
import { invoke } from "@tauri-apps/api/core";
import { useDocumentStore, MAX_DOCUMENT_BYTES } from "./documentStore";
import { useWorkspaceStore } from "./workspaceStore";
import { usePtyStore, collectLeaves } from "./ptyStore";
import { loadSnapshotTabs } from "./tabSnapshot";
import { validWorkspaceSnapshot, WORKSPACE_KEY } from "./workspaceSnapshot";
import {
  activateWorkspace,
  closeFocusedSurface,
  cycleWorkspace,
  getFocusedTerminalTarget,
  openDocumentSnapshot,
  saveWorkspace,
  workspaceCwd,
} from "../lib/workspace";
import { onTermCmd, sendTermCmd } from "../lib/termBus";
const call = vi.mocked(invoke);
beforeEach(() => {
  localStorage.clear();
  call.mockReset();
  useDocumentStore.setState({ documents: {} });
  useWorkspaceStore.setState({
    entries: [],
    activeId: null,
    focus: null,
    notice: null,
  });
  usePtyStore.setState({ tabs: [], activeTabId: null });
});
function terminal() {
  const id = usePtyStore.getState().addTab("/project");
  useWorkspaceStore.getState().syncTerminals(
    usePtyStore.getState().tabs.map((t) => t.id),
    id,
  );
  usePtyStore
    .getState()
    .setSessionId(
      collectLeaves(usePtyStore.getState().tabs[0].root)[0].id,
      "live-session",
    );
  return id;
}
describe("document records", () => {
  it("deduplicates simultaneous canonical aliases", async () => {
    call.mockImplementation(async (name) =>
      name === "fs_canonical_path" ? "/报告/a.md" : "# 中文",
    );
    const ids = await Promise.all([
      useDocumentStore.getState().openFile("/alias.md"),
      useDocumentStore.getState().openFile("/报告/a.md"),
    ]);
    expect(ids[0]).toBe(ids[1]);
    expect(Object.values(useDocumentStore.getState().documents)).toHaveLength(
      1,
    );
    expect(useDocumentStore.getState().documents[ids[0]].baseDir).toBe("/报告");
  });
  it("ignores old revisions and preserves content on failed reload", async () => {
    const id = useDocumentStore.getState().restoreFile("/a.md", "preview");
    let resolveOld!: (s: string) => void;
    call
      .mockImplementationOnce(
        () =>
          new Promise((r) => {
            resolveOld = r as (s: string) => void;
          }),
      )
      .mockResolvedValueOnce("new");
    const old = useDocumentStore.getState().reload(id);
    await useDocumentStore.getState().reload(id);
    resolveOld("old");
    await old;
    expect(useDocumentStore.getState().documents[id].source).toBe("new");
    call.mockRejectedValueOnce("missing");
    await useDocumentStore.getState().reload(id);
    expect(useDocumentStore.getState().documents[id]).toMatchObject({
      source: "new",
      error: "missing",
      loaded: true,
    });
  });
  it("does not recreate a closed document from an asynchronous response", async () => {
    const id = useDocumentStore
      .getState()
      .restoreFile("/missing.md", "preview");
    let resolve!: (s: string) => void;
    call.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r as (s: string) => void;
        }),
    );
    const pending = useDocumentStore.getState().reload(id);
    useDocumentStore.getState().close(id);
    resolve("late");
    await pending;
    expect(useDocumentStore.getState().documents[id]).toBeUndefined();
  });
  it("bounds UTF-8 snapshots before parsing and preserves immutable capture context", () => {
    expect(() =>
      useDocumentStore
        .getState()
        .snapshot(
          "中".repeat(MAX_DOCUMENT_BYTES / 3 + 1),
          "draft",
          null,
          "draft",
        ),
    ).toThrow("1 MiB");
    const id = useDocumentStore
      .getState()
      .snapshot("# A", "selection", "/A", "selection");
    terminal();
    usePtyStore.getState().setCwd(getFocusedTerminalTarget()!.id, "/B");
    expect(useDocumentStore.getState().documents[id]).toMatchObject({
      source: "# A",
      baseDir: "/A",
      kind: "snapshot",
    });
    expect(call).not.toHaveBeenCalledWith(
      "fs_write_text_file",
      expect.anything(),
    );
  });
});
describe("workspace focus and lifecycle", () => {
  it("cycles and reorders mixed entries without changing terminal identities", () => {
    const a = terminal(),
      leaf = getFocusedTerminalTarget()!;
    const b = openDocumentSnapshot("# B", "scratch", "B", "/B")!;
    const c = usePtyStore.getState().addTab("/C");
    useWorkspaceStore.getState().syncTerminals([a, c], c);
    activateWorkspace(a);
    cycleWorkspace(1);
    expect(useWorkspaceStore.getState().activeId).toBe(b);
    useWorkspaceStore.getState().move(1, 0);
    expect(useWorkspaceStore.getState().entries[0].id).toBe(b);
    expect(collectLeaves(usePtyStore.getState().tabs[0].root)[0]).toMatchObject(
      { id: leaf.id, sessionId: "live-session" },
    );
    expect(call).not.toHaveBeenCalled();
  });
  it("routes close to a companion, then document, while preserving the PTY", () => {
    const tab = terminal();
    const id = openDocumentSnapshot(
      "read",
      "output",
      "output",
      "/capture",
      true,
    )!;
    const pane = collectLeaves(usePtyStore.getState().tabs[0].root)[0];
    expect(getFocusedTerminalTarget()).toBeUndefined();
    closeFocusedSurface();
    expect(
      useWorkspaceStore.getState().entries.find((e) => e.id === tab),
    ).toMatchObject({ companionId: null });
    expect(useDocumentStore.getState().documents[id]).toBeDefined();
    activateWorkspace(id);
    closeFocusedSurface();
    expect(usePtyStore.getState().tabs[0].root).toBe(pane);
    expect(useDocumentStore.getState().documents[id]).toBeUndefined();
  });
  it("blocks terminal bus, splits, broadcast and pane close during document focus", () => {
    terminal();
    const listener = vi.fn();
    const off = onTermCmd(listener);
    openDocumentSnapshot("# doc", "draft", "draft", "/source");
    for (const cmd of [
      "clear",
      "find",
      "select-output",
      "prompt-prev",
      { kind: "paste", text: "danger" },
    ] as const)
      sendTermCmd(cmd);
    usePtyStore.getState().splitPane("row");
    usePtyStore.getState().closeActivePane();
    usePtyStore.getState().toggleBroadcast(usePtyStore.getState().activeTabId!);
    expect(listener).not.toHaveBeenCalled();
    off();
    expect(collectLeaves(usePtyStore.getState().tabs[0].root)).toHaveLength(1);
    expect(usePtyStore.getState().tabs[0].broadcast).toBe(false);
    expect(workspaceCwd()).toBe("/source");
    activateWorkspace(usePtyStore.getState().activeTabId!);
    expect(getFocusedTerminalTarget()?.sessionId).toBe("live-session");
  });
  it("removing a document detaches all companion references", () => {
    const tab = terminal();
    const id = openDocumentSnapshot("read", "scratch", "doc", null, true)!;
    useWorkspaceStore.getState().remove(id);
    expect(
      useWorkspaceStore.getState().entries.find((e) => e.id === tab),
    ).toMatchObject({ companionId: null });
  });
});
describe("workspace snapshots", () => {
  it("mirrors legacy layout and excludes temporary content and Agent commands", () => {
    const id = terminal();
    usePtyStore.getState().splitPane("row", "/agent", "claude");
    openDocumentSnapshot("private text", "output", "temp", "/project", true);
    saveWorkspace();
    const raw = localStorage.getItem(WORKSPACE_KEY)!;
    expect(raw).not.toMatch(/private text|claude|live-session/);
    expect(JSON.parse(raw)).toMatchObject({
      version: 1,
      activeId: id,
      entries: [{ kind: "terminal" }],
    });
    expect(localStorage.getItem("logan.tabSnapshot")).toContain("/agent");
    const restored = loadSnapshotTabs();
    expect(
      collectLeaves(restored[0].root).every(
        (p) => p.initialCmd === null && p.sessionId === null,
      ),
    ).toBe(true);
    expect(restored[0].id).not.toBe(id);
  });
  it("falls back to legacy on corrupt workspace and caps terminal/depth restore", () => {
    localStorage.setItem(WORKSPACE_KEY, '{"version":');
    localStorage.setItem(
      "logan.tabSnapshot",
      JSON.stringify(Array.from({ length: 15 }, () => "/old")),
    );
    expect(loadSnapshotTabs()).toHaveLength(9);
    expect(
      validWorkspaceSnapshot({
        version: 1,
        activeId: "a",
        entries: [
          {
            id: "a",
            kind: "terminal",
            layout: { dir: "row", ratio: 0.5, a: {}, b: null },
          },
        ],
      }),
    ).toBe(false);
  });
});
