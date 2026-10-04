import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const retry = vi.hoisted(() => vi.fn());
vi.mock("./windowAppearance", async (importOriginal) => ({
  ...await importOriginal<typeof import("./windowAppearance")>(),
  retryWindowMaterial: retry,
}));

import { WindowMaterialSection } from "../components/Settings/AppearanceSections";
import { useSettingsStore } from "../stores/settingsStore";
import { useAppearanceStore } from "./windowAppearance";

describe("window appearance settings", () => {
  let host: HTMLDivElement;
  let root: Root;
  beforeEach(async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    retry.mockClear();
    useSettingsStore.setState({ locale: "en", windowMaterial: "solid", backgroundBlur: true, backgroundOpacity: 0.75 });
    useAppearanceStore.setState({ effectiveMode: "solid", material: "none", status: "ok" });
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    await act(async () => root.render(createElement(WindowMaterialSection)));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const button = (label: string) => Array.from(host.querySelectorAll("button"))
    .find(b => b.textContent === label)!;

  it("reports cleanup failure even for solid and retries the saved target", async () => {
    await act(async () => useAppearanceStore.setState({ material: "vibrancy", status: "clear-failed" }));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("couldn't be removed");
    expect(host.querySelector("input")?.disabled).toBe(true);
    await act(async () => button("Solid").click());
    expect(retry).toHaveBeenCalledTimes(1);
    await act(async () => useSettingsStore.getState().setLocale("zh"));
    expect(host.querySelector('[role="status"]')?.textContent).toContain("清理失败");
  });

  it("exposes selected, checked, percentage and disabled states and avoids a duplicate request", async () => {
    expect(button("Solid").getAttribute("aria-pressed")).toBe("true");
    expect(button("Glass").getAttribute("aria-pressed")).toBe("false");
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("true");
    expect((host.querySelector('[role="switch"]') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => button("Glass").click());
    expect(retry).not.toHaveBeenCalled();
    expect(useSettingsStore.getState().windowMaterial).toBe("glass");
    await act(async () => useAppearanceStore.setState({ effectiveMode: "glass", status: "ok" }));
    expect(button("Glass").getAttribute("aria-pressed")).toBe("true");
    const slider = host.querySelector("input")!;
    expect(slider.disabled).toBe(false);
    expect(slider.getAttribute("aria-valuetext")).toBe("75%");
    await act(async () => (host.querySelector('[role="switch"]') as HTMLButtonElement).click());
    expect(useSettingsStore.getState().backgroundBlur).toBe(false);
    expect(host.querySelector('[role="switch"]')?.getAttribute("aria-checked")).toBe("false");
  });
});
