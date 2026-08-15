import { describe, it, expect, beforeEach, vi } from "vitest";

const LAUNCHERS_KEY = "logan.agentLaunchers";
const BYPASS_KEY = "logan.agentBypass";

/** The store hydrates from localStorage at import — re-import per test. */
async function freshStore() {
  vi.resetModules();
  return (await import("./agentLauncherStore")).useAgentLauncherStore;
}

beforeEach(() => localStorage.clear());

describe("hydration", () => {
  it("bypasses permissions by default", async () => {
    const store = await freshStore();
    expect(store.getState().bypassPermissions).toBe(true);
  });

  it("restores an explicit opt-out", async () => {
    localStorage.setItem(BYPASS_KEY, "0");
    const store = await freshStore();
    expect(store.getState().bypassPermissions).toBe(false);
  });

  it("survives a corrupt launcher list", async () => {
    localStorage.setItem(LAUNCHERS_KEY, "{not json");
    const store = await freshStore();
    expect(store.getState().launchers.map((l) => l.id)).toContain("claude");
  });
});

describe("editing", () => {
  it("persists command and flag edits", async () => {
    const store = await freshStore();
    store.getState().updateLauncher("claude", { bypassArgs: "--yolo" });
    const saved = JSON.parse(localStorage.getItem(LAUNCHERS_KEY)!);
    expect(saved.find((l: { id: string }) => l.id === "claude").bypassArgs).toBe(
      "--yolo",
    );
  });

  it("refuses to blank a launcher's display name", async () => {
    const store = await freshStore();
    store.getState().updateLauncher("claude", { name: "   " });
    expect(store.getState().launchers[0].name).toBe("Claude Code");
  });

  it("toggles visibility without deleting", async () => {
    const store = await freshStore();
    const before = store.getState().launchers.length;
    const enabledOf = (id: string) =>
      store.getState().launchers.find((l) => l.id === id)!.enabled;

    store.getState().toggleLauncher("codex"); // ships on → off
    expect(enabledOf("codex")).toBe(false);
    store.getState().toggleLauncher("zcode"); // ships off → on
    expect(enabledOf("zcode")).toBe(true);
    expect(store.getState().launchers).toHaveLength(before);
  });

  it("only deletes custom launchers", async () => {
    const store = await freshStore();
    store.getState().addLauncher("Mine", "mine");
    const custom = store.getState().launchers.find((l) => !l.builtin)!;
    store.getState().removeLauncher("claude");
    store.getState().removeLauncher(custom.id);
    const ids = store.getState().launchers.map((l) => l.id);
    expect(ids).toContain("claude");
    expect(ids).not.toContain(custom.id);
  });

  it("ignores a custom launcher with no name or command", async () => {
    const store = await freshStore();
    store.getState().addLauncher("  ", "cmd");
    store.getState().addLauncher("name", "  ");
    expect(store.getState().launchers.every((l) => l.builtin)).toBe(true);
  });

  it("reset drops custom entries and edits", async () => {
    const store = await freshStore();
    store.getState().addLauncher("Mine", "mine");
    store.getState().updateLauncher("claude", { command: "nope" });
    store.getState().resetLaunchers();
    const { launchers } = store.getState();
    expect(launchers.every((l) => l.builtin)).toBe(true);
    expect(launchers[0].command).toBe("claude");
  });
});

describe("bypass switch", () => {
  it("persists the off state", async () => {
    const store = await freshStore();
    store.getState().toggleBypass();
    expect(localStorage.getItem(BYPASS_KEY)).toBe("0");
    expect(store.getState().bypassPermissions).toBe(false);
  });
});
