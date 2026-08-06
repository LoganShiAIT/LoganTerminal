import { describe, it, expect } from "vitest";
import { t, TRANSLATIONS } from "./i18n";
import { useSettingsStore } from "./stores/settingsStore";

// Raw sources through vite's glob import — no node:fs, so the test typechecks
// under the app's own tsconfig (no @types/node in this project).
const SOURCES = import.meta.glob("./**/*.{ts,tsx}", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Literal `t("…")` keys used anywhere in the app. */
function usedKeys(): Set<string> {
  const keys = new Set<string>();
  const call = /\bt\(\s*"((?:[^"\\]|\\.)*)"/g;
  for (const [path, src] of Object.entries(SOURCES)) {
    if (path.endsWith("i18n.ts") || path.includes(".test.")) continue;
    for (const m of src.matchAll(call)) {
      keys.add(m[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"));
    }
  }
  return keys;
}

describe("translation coverage", () => {
  it("has a Chinese string for every key the UI asks for", () => {
    const missing = [...usedKeys()].filter((k) => !(k in TRANSLATIONS));
    expect(missing).toEqual([]);
  });

  it("keeps placeholders identical between the two languages", () => {
    const names = (s: string) =>
      (s.match(/\{(\w+)\}/g) ?? []).slice().sort().join(",");
    const drifted = Object.entries(TRANSLATIONS)
      .filter(([en, zh]) => names(en) !== names(zh))
      .map(([en]) => en);
    expect(drifted).toEqual([]);
  });
});

describe("t", () => {
  it("translates when the locale is Chinese", () => {
    useSettingsStore.setState({ locale: "zh" });
    expect(t("New Terminal")).toBe("新建终端");
  });

  it("passes English through untouched", () => {
    useSettingsStore.setState({ locale: "en" });
    expect(t("New Terminal")).toBe("New Terminal");
  });

  it("falls back to the key when a translation is missing", () => {
    useSettingsStore.setState({ locale: "zh" });
    expect(t("not a real ui string")).toBe("not a real ui string");
  });

  it("interpolates in both languages", () => {
    useSettingsStore.setState({ locale: "zh" });
    expect(t("{n} waiting", { n: 3 })).toBe("3 个待处理");
    useSettingsStore.setState({ locale: "en" });
    expect(t("{n} waiting", { n: 3 })).toBe("3 waiting");
  });

  it("leaves an unknown placeholder alone rather than printing undefined", () => {
    useSettingsStore.setState({ locale: "en" });
    expect(t("{n} waiting", { other: 1 })).toBe("{n} waiting");
  });
});
