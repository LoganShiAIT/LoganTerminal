import { describe, expect, it, vi } from "vitest";
import {
  createAppearanceCoordinator,
  type AppearanceState,
  type NativeOutcome,
} from "./windowAppearance";
import type { WindowMaterial } from "../stores/settingsStore";

const ok = (mode: WindowMaterial, material?: string): NativeOutcome => ({
  requestedMode: mode,
  effectiveMode: mode,
  material: material ?? (mode === "glass" ? "vibrancy" : "none"),
  status: mode === "glass" ? "applied" : "cleared",
  reason: null,
});

function collect() {
  const states: AppearanceState[] = [];
  return {
    states,
    onState: (s: AppearanceState) => states.push(s),
  };
}

/** Flush the coordinator's promise chain. */
async function settle(rounds = 20) {
  for (let i = 0; i < rounds; i++) await Promise.resolve();
}

describe("appearance coordinator", () => {
  it("applies a single request and reports the native result", async () => {
    const { states, onState } = collect();
    const apply = vi.fn(async (m: WindowMaterial) => ok(m));
    const c = createAppearanceCoordinator(apply, onState);
    c.request("glass", true);
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    expect(states[states.length - 1]).toEqual({
      effectiveMode: "glass",
      material: "vibrancy",
      status: "ok",
    });
  });

  it("collapses rapid glass→solid so the latest target wins", async () => {
    const { states, onState } = collect();
    let releaseGlass!: (o: NativeOutcome) => void;
    const apply = vi.fn((m: WindowMaterial) => {
      if (m === "glass")
        return new Promise<NativeOutcome>((r) => (releaseGlass = r));
      return Promise.resolve(ok(m));
    });
    const c = createAppearanceCoordinator(apply, onState);
    c.request("glass", true);
    c.request("solid", true);
    // The glass call resolves late; its result must not stick.
    releaseGlass(ok("glass"));
    await settle();
    expect(apply).toHaveBeenCalledTimes(2);
    const finals = states.filter((s) => s.status !== "pending");
    expect(finals[finals.length - 1]).toEqual({
      effectiveMode: "solid",
      material: "none",
      status: "ok",
    });
    expect(finals.some((s) => s.effectiveMode === "glass")).toBe(false);
  });

  it("times out to a usable solid surface and ignores the late response", async () => {
    const { states, onState } = collect();
    // Simulates invokeNative resolving null after NATIVE_TIMEOUT_MS.
    const apply = vi.fn(async (_m: WindowMaterial) => null);
    const c = createAppearanceCoordinator(apply, onState);
    c.request("glass", true);
    await settle();
    expect(states[states.length - 1]).toEqual({
      effectiveMode: "solid",
      material: "none",
      status: "timeout",
    });
    // Manual retry re-runs the native request for the same preference.
    c.request("glass", true);
    await settle();
    expect(apply).toHaveBeenCalledTimes(2);
  });

  it("falls back to solid with a readable status when the native apply fails", async () => {
    const { states, onState } = collect();
    const apply = vi.fn(
      async (_m: WindowMaterial): Promise<NativeOutcome> => ({
        requestedMode: "glass",
        effectiveMode: "solid",
        material: "none",
        status: "apply-failed",
        reason: "boom",
      }),
    );
    const c = createAppearanceCoordinator(apply, onState);
    c.request("glass", true);
    await settle();
    expect(states[states.length - 1]).toEqual({
      effectiveMode: "solid",
      material: "none",
      status: "apply-failed",
    });
  });

  it("maps unsupported platforms to solid without dropping the request", async () => {
    const { states, onState } = collect();
    const apply = vi.fn(
      async (_m: WindowMaterial): Promise<NativeOutcome> => ({
        requestedMode: "glass",
        effectiveMode: "solid",
        material: "none",
        status: "unsupported",
        reason: "platform-unsupported",
      }),
    );
    const c = createAppearanceCoordinator(apply, onState);
    c.request("glass", true);
    await settle();
    expect(states[states.length - 1]?.status).toBe("unsupported");
    expect(states[states.length - 1]?.effectiveMode).toBe("solid");
  });

  it("does not re-invoke the native layer when only the target seq is unchanged", async () => {
    const { onState } = collect();
    const apply = vi.fn(async (m: WindowMaterial) => ok(m));
    const c = createAppearanceCoordinator(apply, onState);
    c.request("solid", true);
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
    // No new request — nothing should fire (opacity changes never reach the
    // coordinator at all; they only repaint CSS surfaces).
    await settle();
    expect(apply).toHaveBeenCalledTimes(1);
  });

  it("passes the blur flag through and reconciles when it flips", async () => {
    const { states, onState } = collect();
    const apply = vi.fn(async (m: WindowMaterial, b: boolean) =>
      ok(m, m === "glass" && b ? "vibrancy" : "none"),
    );
    const c = createAppearanceCoordinator(apply, onState);
    // Glass without the frost: the native layer is cleared but the surface
    // stays glass (the frontend tint keeps compositing over a clear window).
    c.request("glass", false);
    await settle();
    expect(apply).toHaveBeenCalledWith("glass", false);
    expect(states[states.length - 1]).toEqual({
      effectiveMode: "glass",
      material: "none",
      status: "ok",
    });
    // Flipping the flag is a new target — the native layer is reconciled.
    c.request("glass", true);
    await settle();
    expect(apply).toHaveBeenCalledWith("glass", true);
    expect(apply).toHaveBeenCalledTimes(2);
    expect(states[states.length - 1]).toEqual({
      effectiveMode: "glass",
      material: "vibrancy",
      status: "ok",
    });
  });

  it("treats a blur-only change as a new target even for the same mode", async () => {
    const { onState } = collect();
    const apply = vi.fn(async (m: WindowMaterial) => ok(m));
    const c = createAppearanceCoordinator(apply, onState);
    c.request("glass", true);
    await settle();
    c.request("glass", false);
    await settle();
    expect(apply).toHaveBeenCalledTimes(2);
  });
});
