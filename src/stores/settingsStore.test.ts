import { describe, it, expect, beforeEach, vi } from "vitest";

/** The store hydrates from localStorage at import — re-import per test. */
async function freshStore() {
  vi.resetModules();
  return await import("./settingsStore");
}

const scale = () =>
  document.documentElement.style.getPropertyValue("--anim-scale");

const glassAttr = () => document.documentElement.dataset.glass;

/**
 * Stand in for the OS accessibility preference. jsdom has no matchMedia, and
 * the store only ever asks the one question, so a stub that answers it is
 * enough — `reduce` is what "Reduce Transparency" is turned on.
 */
function stubReducedTransparency(reduce: boolean) {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: reduce && query.includes("prefers-reduced-transparency"),
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
}

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--anim-scale");
  delete document.documentElement.dataset.glass;
  vi.unstubAllGlobals();
});

describe("animation speed", () => {
  it("defaults to 1× and publishes the scale at import", async () => {
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().animSpeed).toBe(1);
    expect(scale()).toBe("1");
  });

  it("pushes the inverse to CSS — faster playback, shorter durations", async () => {
    const { useSettingsStore } = await freshStore();
    useSettingsStore.getState().setAnimSpeed(2);
    expect(scale()).toBe("0.5");
    useSettingsStore.getState().setAnimSpeed(0.5);
    expect(scale()).toBe("2");
  });

  it("persists the choice and restores it on the next launch", async () => {
    const first = await freshStore();
    first.useSettingsStore.getState().setAnimSpeed(1.5);
    expect(localStorage.getItem("logan.animSpeed")).toBe("1.5");

    const second = await freshStore();
    expect(second.useSettingsStore.getState().animSpeed).toBe(1.5);
    expect(Number(scale())).toBeCloseTo(1 / 1.5, 10);
  });

  it("falls back to 1× for values outside the offered set", async () => {
    const { useSettingsStore, DEFAULT_ANIM_SPEED } = await freshStore();
    useSettingsStore.getState().setAnimSpeed(9);
    expect(useSettingsStore.getState().animSpeed).toBe(DEFAULT_ANIM_SPEED);

    // Same for a corrupted or stale persisted value.
    localStorage.setItem("logan.animSpeed", "not a number");
    const reloaded = await freshStore();
    expect(reloaded.useSettingsStore.getState().animSpeed).toBe(
      DEFAULT_ANIM_SPEED,
    );
  });
});

describe("liquid glass", () => {
  it("is on by default and publishes the attribute at import", async () => {
    stubReducedTransparency(false);
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().liquidGlass).toBe(true);
    expect(glassAttr()).toBe("1");
  });

  it("flips the attribute and persists the choice", async () => {
    stubReducedTransparency(false);
    const first = await freshStore();
    first.useSettingsStore.getState().toggleLiquidGlass();
    expect(glassAttr()).toBe("0");
    expect(localStorage.getItem("logan.liquidGlass")).toBe("0");

    const second = await freshStore();
    expect(second.useSettingsStore.getState().liquidGlass).toBe(false);
    expect(glassAttr()).toBe("0");
  });

  it("lets the system Reduce Transparency preference win", async () => {
    stubReducedTransparency(true);
    const { useSettingsStore } = await freshStore();
    // The user's own choice is untouched — only the rendered material is off,
    // so clearing the system preference restores the glass they picked.
    expect(useSettingsStore.getState().liquidGlass).toBe(true);
    expect(glassAttr()).toBe("0");
  });

  it("assumes no preference when matchMedia is unavailable", async () => {
    vi.stubGlobal("matchMedia", undefined);
    const { useSettingsStore } = await freshStore();
    expect(useSettingsStore.getState().liquidGlass).toBe(true);
    expect(glassAttr()).toBe("1");
  });
});
