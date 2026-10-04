import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "/capture/图.svg"),
  convertFileSrc: (s: string) => `asset:${s}`,
}));
vi.mock("../components/AssetPanel/AssetPanel", () => ({
  Lightbox: () => null,
}));
import MarkdownPreview from "../components/MarkdownPreview/MarkdownPreview";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "../stores/settingsStore";
let root: Root, host: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.mocked(invoke).mockClear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});
describe("revision-bound reader media", () => {
  it("retains media nodes on rerenders and uses capture directory, never shell cwd", async () => {
    const source =
      "# doc\n\n![image](./图.svg)\n\n```sh\necho $PATH\n```\n\n$$x^2$$";
    const render = () =>
      root.render(
        createElement(MarkdownPreview, {
          source,
          baseDir: "/capture",
          reading: true,
          revision: 1,
        }),
      );
    await act(async () => render());
    const image = host.querySelector("img");
    expect(image).not.toBeNull();
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("fs_resolve_image", {
      target: "./图.svg",
      baseDir: "/capture",
    });
    await act(async () => render());
    expect(host.querySelector("img")).toBe(image);
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
    useSettingsStore.getState().setLocale("zh");
    await act(async () => render());
    expect(host.querySelector("[data-code-id]")?.textContent).toBe("复制代码");
  });
  it("never resolves a remote image and keeps informative missing placeholders", async () => {
    vi.mocked(invoke).mockRejectedValueOnce("missing");
    await act(async () =>
      root.render(
        createElement(MarkdownPreview, {
          source:
            "![remote](https://example.com/image.png)\n\n![missing](./lost.png)",
          baseDir: "/capture",
          reading: true,
        }),
      ),
    );
    expect(vi.mocked(invoke)).toHaveBeenCalledTimes(1);
    expect(host.querySelector("img")).toBeNull();
    expect(host.textContent).toContain("外部");
    expect(host.textContent).toContain("不可用");
  });
  it("copies raw code and TeX without changing resolved media", async () => {
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });
    await act(async () =>
      root.render(
        createElement(MarkdownPreview, {
          source: "![image](a.svg)\n\n```sh\necho $PATH\n```\n\n$$a_i + b_j$$",
          baseDir: "/capture",
          reading: true,
        }),
      ),
    );
    const image = host.querySelector("img");
    await act(async () => {
      (host.querySelector("[data-code-id]") as HTMLButtonElement).click();
    });
    expect(writeText).toHaveBeenLastCalledWith("echo $PATH\n");
    expect(host.querySelector("img")).toBe(image);
    await act(async () => {
      (host.querySelector("[data-math-id]") as HTMLButtonElement).click();
    });
    expect(writeText).toHaveBeenLastCalledWith("a_i + b_j");
    expect(host.querySelector("img")).toBe(image);
  });
});
