import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (name: string) => {
    if (name === "fs_read_text_file") throw new Error("missing file");
    return null;
  }),
}));
beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});
describe("coordinated boot restore", () => {
  it("restores mixed ordering, companion refs and missing files with fresh shells", async () => {
    localStorage.setItem(
      "logan.workspaceSnapshot",
      JSON.stringify({
        version: 1,
        activeId: "doc",
        entries: [
          {
            id: "term",
            kind: "terminal",
            layout: "/fresh",
            companion: "doc",
            ratio: 0.6,
          },
          { id: "doc", kind: "document", path: "/missing.md", mode: "source" },
        ],
      }),
    );
    const { initializeWorkspace } = await import("./workspace");
    const { usePtyStore } = await import("../stores/ptyStore");
    const { useWorkspaceStore } = await import("../stores/workspaceStore");
    const { useDocumentStore } = await import("../stores/documentStore");
    initializeWorkspace();
    initializeWorkspace();
    await Promise.resolve();
    await Promise.resolve();
    expect(usePtyStore.getState().tabs).toHaveLength(1);
    const [term, doc] = useWorkspaceStore.getState().entries;
    expect(term).toMatchObject({
      kind: "terminal",
      companionId: doc.id,
      ratio: 0.6,
    });
    expect(useWorkspaceStore.getState().activeId).toBe(doc.id);
    expect(useDocumentStore.getState().documents[doc.id]).toMatchObject({
      mode: "source",
      loaded: false,
      loading: false,
    });
    expect(useDocumentStore.getState().documents[doc.id].error).toContain(
      "missing file",
    );
    expect(usePtyStore.getState().tabs[0].id).not.toBe("term");
  });
  it("caps document restoration at twelve and terminal restoration at nine", async () => {
    localStorage.setItem(
      "logan.workspaceSnapshot",
      JSON.stringify({
        version: 1,
        activeId: "d14",
        entries: [
          ...Array.from({ length: 14 }, (_, i) => ({
            id: `d${i}`,
            kind: "document",
            path: `/f${i}.md`,
            mode: "preview",
          })),
          ...Array.from({ length: 14 }, (_, i) => ({
            id: `t${i}`,
            kind: "terminal",
            layout: "/shell",
          })),
        ],
      }),
    );
    const { initializeWorkspace } = await import("./workspace");
    const { usePtyStore } = await import("../stores/ptyStore");
    const { useDocumentStore } = await import("../stores/documentStore");
    initializeWorkspace();
    expect(usePtyStore.getState().tabs).toHaveLength(9);
    expect(Object.keys(useDocumentStore.getState().documents)).toHaveLength(12);
  });
  it("restores document-only layouts without spawning a hidden default terminal", async () => {
    localStorage.setItem(
      "logan.workspaceSnapshot",
      JSON.stringify({
        version: 1,
        activeId: "d",
        entries: [
          { id: "d", kind: "document", path: "/doc.md", mode: "preview" },
        ],
      }),
    );
    const { initializeWorkspace } = await import("./workspace");
    const { usePtyStore } = await import("../stores/ptyStore");
    initializeWorkspace();
    expect(usePtyStore.getState().tabs).toHaveLength(0);
  });
});
