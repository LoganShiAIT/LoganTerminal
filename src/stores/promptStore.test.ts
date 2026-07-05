import { describe, it, expect, beforeEach, vi } from "vitest";

const KEY = "logan.prompts";

/** promptStore hydrates from localStorage at import — re-import per test. */
async function freshStore() {
  vi.resetModules();
  return (await import("./promptStore")).usePromptStore;
}

beforeEach(() => localStorage.clear());

describe("addPrompt", () => {
  it("adds newest-first with trimmed title", async () => {
    const store = await freshStore();
    store.getState().addPrompt("  First  ", "body one");
    store.getState().addPrompt("Second", "body two");
    const prompts = store.getState().prompts;
    expect(prompts.map((p) => p.title)).toEqual(["Second", "First"]);
    expect(prompts[1].text).toBe("body one");
  });

  it("normalizes CRLF line endings in the body", async () => {
    const store = await freshStore();
    store.getState().addPrompt("t", "line1\r\nline2\r\nline3");
    expect(store.getState().prompts[0].text).toBe("line1\nline2\nline3");
  });

  it("rejects empty titles and whitespace-only bodies", async () => {
    const store = await freshStore();
    store.getState().addPrompt("   ", "body");
    store.getState().addPrompt("title", "   \n  ");
    expect(store.getState().prompts).toHaveLength(0);
  });

  it("caps the library at 50, dropping the oldest", async () => {
    const store = await freshStore();
    for (let i = 0; i < 52; i++) store.getState().addPrompt(`p${i}`, "x");
    const prompts = store.getState().prompts;
    expect(prompts).toHaveLength(50);
    expect(prompts[0].title).toBe("p51");
    expect(prompts.some((p) => p.title === "p0")).toBe(false);
  });

  it("persists to localStorage on every change", async () => {
    const store = await freshStore();
    store.getState().addPrompt("saved", "text");
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    expect(raw).toHaveLength(1);
    expect(raw[0].title).toBe("saved");
  });
});

describe("removePrompt", () => {
  it("removes by id and persists the removal", async () => {
    const store = await freshStore();
    store.getState().addPrompt("keep", "x");
    store.getState().addPrompt("drop", "y");
    const dropId = store.getState().prompts[0].id;
    store.getState().removePrompt(dropId);
    expect(store.getState().prompts.map((p) => p.title)).toEqual(["keep"]);
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "[]");
    expect(raw.map((p: { title: string }) => p.title)).toEqual(["keep"]);
  });
});

describe("hydration", () => {
  it("restores valid snippets from storage", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([{ id: "1", title: "t", text: "x" }]),
    );
    const store = await freshStore();
    expect(store.getState().prompts).toEqual([
      { id: "1", title: "t", text: "x" },
    ]);
  });

  it("filters malformed entries and tolerates garbage storage", async () => {
    localStorage.setItem(
      KEY,
      JSON.stringify([
        { id: "1", title: "ok", text: "x" },
        { id: 2, title: "bad-id", text: "x" },
        "not-an-object",
        null,
        { title: "missing-id", text: "x" },
      ]),
    );
    let store = await freshStore();
    expect(store.getState().prompts.map((p) => p.title)).toEqual(["ok"]);

    localStorage.setItem(KEY, "corrupt json {{");
    store = await freshStore();
    expect(store.getState().prompts).toEqual([]);
  });

  it("enforces the cap on load", async () => {
    const many = Array.from({ length: 60 }, (_, i) => ({
      id: `${i}`,
      title: `p${i}`,
      text: "x",
    }));
    localStorage.setItem(KEY, JSON.stringify(many));
    const store = await freshStore();
    expect(store.getState().prompts).toHaveLength(50);
  });
});
