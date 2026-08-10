import { describe, it, expect, beforeEach, vi } from "vitest";

/** The store hydrates from localStorage at import — re-import per test. */
async function freshStore() {
  vi.resetModules();
  return await import("./settingsStore");
}

const scale = () =>
  document.documentElement.style.getPropertyValue("--anim-scale");

beforeEach(() => {
  localStorage.clear();
  document.documentElement.style.removeProperty("--anim-scale");
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
