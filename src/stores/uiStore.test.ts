import { describe, it, expect, beforeEach, vi } from "vitest";

/** uiStore hydrates layout from localStorage at import — re-import per test. */
async function freshStore() {
  vi.resetModules();
  return (await import("./uiStore")).useUiStore;
}

beforeEach(() => localStorage.clear());

describe("file finder state", () => {
  it("starts closed and is not persisted", async () => {
    const store = await freshStore();
    expect(store.getState().fileSearchOpen).toBe(false);

    store.getState().setFileSearchOpen(true);
    expect(store.getState().fileSearchOpen).toBe(true);

    const saved = JSON.parse(localStorage.getItem("logan.uiLayout") ?? "{}");
    expect(saved.fileSearchOpen).toBeUndefined();
  });
});

describe("revealInFileTree", () => {
  it("bumps the sequence so the same path can be revealed twice", async () => {
    const store = await freshStore();
    expect(store.getState().reveal).toBeNull();

    store.getState().revealInFileTree("/tmp/a/b.ts", false);
    const first = store.getState().reveal;
    expect(first).toMatchObject({ path: "/tmp/a/b.ts", isDir: false, seq: 1 });

    store.getState().revealInFileTree("/tmp/a/b.ts", false);
    expect(store.getState().reveal?.seq).toBe(2);
  });

  it("opens the sidebar on the file tab — revealing into a hidden tree shows nothing", async () => {
    localStorage.setItem(
      "logan.uiLayout",
      JSON.stringify({ sidebarOpen: false, sidebarTab: "diff" }),
    );
    const store = await freshStore();
    expect(store.getState().sidebarOpen).toBe(false);

    store.getState().revealInFileTree("/tmp/project", true);
    expect(store.getState().sidebarOpen).toBe(true);
    expect(store.getState().sidebarTab).toBe("files");
    expect(store.getState().reveal).toMatchObject({ isDir: true });
  });
});

describe("sidebar panel", () => {
  it("openSidebarPanel shows the tab and opens a collapsed sidebar", async () => {
    localStorage.setItem(
      "logan.uiLayout",
      JSON.stringify({ sidebarOpen: false, sidebarTab: "files" }),
    );
    const store = await freshStore();

    store.getState().openSidebarPanel("diff");
    expect(store.getState().sidebarTab).toBe("diff");
    expect(store.getState().sidebarOpen).toBe(true);

    // Already open on another tab: switch tabs, stay open.
    store.getState().openSidebarPanel("math");
    expect(store.getState().sidebarTab).toBe("math");
    expect(store.getState().sidebarOpen).toBe(true);
  });

  it("toggleSidebarPanel only hides when that tab is already the visible one", async () => {
    const store = await freshStore();

    store.getState().openSidebarPanel("assets");
    // Different tab → switch to it rather than closing.
    store.getState().toggleSidebarPanel("diff");
    expect(store.getState().sidebarTab).toBe("diff");
    expect(store.getState().sidebarOpen).toBe(true);

    // Same tab, visible → collapse.
    store.getState().toggleSidebarPanel("diff");
    expect(store.getState().sidebarOpen).toBe(false);
    expect(store.getState().sidebarTab).toBe("diff");

    // Same tab, hidden → bring it back.
    store.getState().toggleSidebarPanel("diff");
    expect(store.getState().sidebarOpen).toBe(true);
  });

  it("drops a layout saved by the two-sidebar build instead of half-reading it", async () => {
    localStorage.setItem(
      "logan.uiLayout",
      JSON.stringify({
        leftSidebarOpen: false,
        rightSidebarOpen: true,
        leftSidebarWidth: 240,
        rightPanelTab: "diff",
      }),
    );
    const store = await freshStore();

    expect(store.getState().sidebarOpen).toBe(true);
    expect(store.getState().sidebarWidth).toBe(320);
    expect(store.getState().sidebarTab).toBe("files");
  });
});
