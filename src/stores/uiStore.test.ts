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

  it("opens the left sidebar — revealing into a collapsed tree shows nothing", async () => {
    localStorage.setItem(
      "logan.uiLayout",
      JSON.stringify({ leftSidebarOpen: false }),
    );
    const store = await freshStore();
    expect(store.getState().leftSidebarOpen).toBe(false);

    store.getState().revealInFileTree("/tmp/project", true);
    expect(store.getState().leftSidebarOpen).toBe(true);
    expect(store.getState().reveal).toMatchObject({ isDir: true });
  });
});
