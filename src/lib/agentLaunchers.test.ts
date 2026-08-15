import { describe, it, expect } from "vitest";
import {
  DEFAULT_LAUNCHERS,
  MAX_LAUNCHERS,
  enabledLaunchers,
  launchLine,
  mergeLaunchers,
  type AgentLauncher,
} from "./agentLaunchers";

const claude = (over: Partial<AgentLauncher> = {}): AgentLauncher => ({
  ...DEFAULT_LAUNCHERS[0],
  ...over,
});

describe("launchLine", () => {
  it("appends the bypass flags when the switch is on", () => {
    expect(launchLine(claude(), true)).toBe(
      "claude --dangerously-skip-permissions",
    );
  });

  it("drops them when it is off", () => {
    expect(launchLine(claude(), false)).toBe("claude");
  });

  it("drops them when the launcher has none", () => {
    expect(launchLine(claude({ bypassArgs: "   " }), true)).toBe("claude");
  });

  it("is empty for a blank command, so callers can skip the launch", () => {
    expect(launchLine(claude({ command: "  " }), true)).toBe("");
  });
});

describe("enabledLaunchers", () => {
  it("hides disabled entries and ones with no command", () => {
    const list = [
      claude(),
      claude({ id: "b", enabled: false }),
      claude({ id: "c", command: "" }),
    ];
    expect(enabledLaunchers(list).map((l) => l.id)).toEqual(["claude"]);
  });
});

describe("mergeLaunchers", () => {
  it("returns the shipped list for missing or junk storage", () => {
    const ids = DEFAULT_LAUNCHERS.map((l) => l.id);
    expect(mergeLaunchers(null).map((l) => l.id)).toEqual(ids);
    expect(mergeLaunchers("nope").map((l) => l.id)).toEqual(ids);
    expect(mergeLaunchers([1, "x", null]).map((l) => l.id)).toEqual(ids);
  });

  // Each of these was checked against the CLI's own parser, not borrowed from
  // a sibling tool — see the comments in DEFAULT_LAUNCHERS for what each one
  // rejects. Freezing them here means a careless edit has to argue with a test.
  it("ships every agent's real bypass setting", () => {
    const merged = mergeLaunchers(null);
    expect(merged.map((l) => launchLine(l, true))).toEqual([
      "claude --dangerously-skip-permissions",
      "codex --dangerously-bypass-approvals-and-sandbox",
      // ZCode takes `--mode yolo`; both --permission-mode and
      // --dangerously-skip-permissions are rejected by its runtime.
      "zcode --mode yolo",
      // The Antigravity CLI's binary is `agy`; `antigravity` is only ever a
      // shell alias someone wrote, so launching that would be "not found".
      "agy --dangerously-skip-permissions",
      // dsh has no bypass flag at all — the setting is an env assignment,
      // which has to land *before* the command to take effect.
      "DSH_PERMISSION_MODE=danger-full-access dsh web",
      "opencode --auto",
    ]);
  });

  // Z.ai ships no `zcode` binary, so an enabled-by-default entry would put a
  // command that does not exist in front of everyone. It stays in the list,
  // configured and one checkbox away.
  it("ships ZCode present but disabled", () => {
    const merged = mergeLaunchers(null);
    const zcode = merged.find((l) => l.id === "zcode")!;
    expect(zcode.enabled).toBe(false);
    expect(enabledLaunchers(merged).map((l) => l.id)).toEqual([
      "claude",
      "codex",
      "antigravity",
      "deepseek-harness",
      "opencode",
    ]);
  });

  it("drops the env prefix along with the flags when bypass is off", () => {
    const dsh = mergeLaunchers(null).find((l) => l.id === "deepseek-harness")!;
    expect(launchLine(dsh, false)).toBe("dsh web");
  });

  it("keeps the user's edits to a built-in", () => {
    const merged = mergeLaunchers([
      {
        id: "codex",
        command: "codex-next",
        bypassArgs: "--yolo",
        bypassEnv: "FOO=1",
        enabled: false,
      },
    ]);
    const codex = merged.find((l) => l.id === "codex")!;
    expect(codex.command).toBe("codex-next");
    expect(codex.bypassArgs).toBe("--yolo");
    expect(codex.bypassEnv).toBe("FOO=1");
    expect(codex.enabled).toBe(false);
    expect(codex.builtin).toBe(true);
    expect(launchLine(codex, true)).toBe("FOO=1 codex-next --yolo");
  });

  // The point of rebuilding built-ins from code: a launcher added in a later
  // version has to reach people whose saved list predates it.
  it("re-adds a built-in that is missing from storage", () => {
    const merged = mergeLaunchers([{ id: "claude", command: "claude" }]);
    expect(merged.map((l) => l.id)).toEqual(DEFAULT_LAUNCHERS.map((l) => l.id));
  });

  it("keeps custom entries after the built-ins", () => {
    const merged = mergeLaunchers([
      { id: "u1", name: "My agent", command: "myagent", bypassArgs: "-y" },
    ]);
    expect(merged).toHaveLength(DEFAULT_LAUNCHERS.length + 1);
    const last = merged[merged.length - 1];
    expect(last).toMatchObject({
      id: "u1",
      name: "My agent",
      command: "myagent",
      enabled: true,
      builtin: false,
    });
  });

  it("skips custom entries with no name or command, and duplicate ids", () => {
    const merged = mergeLaunchers([
      { id: "u1", name: "", command: "x" },
      { id: "u2", name: "y", command: "  " },
      { id: "u3", name: "ok", command: "ok" },
      { id: "u3", name: "dupe", command: "dupe" },
    ]);
    expect(merged.filter((l) => !l.builtin).map((l) => l.id)).toEqual(["u3"]);
  });

  it("caps the total list", () => {
    const custom = Array.from({ length: MAX_LAUNCHERS + 10 }, (_, i) => ({
      id: `u${i}`,
      name: `n${i}`,
      command: "c",
    }));
    expect(mergeLaunchers(custom).length).toBeLessThanOrEqual(MAX_LAUNCHERS);
  });
});
