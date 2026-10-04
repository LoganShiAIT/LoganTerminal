/**
 * Runtime state and coordination for the native window material.
 *
 * The *preference* lives in settingsStore (persisted); this module owns the
 * *effective* state — what the window actually shows — which is never
 * persisted. A single serial coordinator sends requests to the Rust
 * `apply_window_appearance` command: rapid toggles collapse to the latest
 * target, in-flight results that arrive after a newer request are discarded
 * by sequence number, and a native call that exceeds the timeout leaves the
 * window usable on an opaque solid surface.
 */
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import {
  useSettingsStore,
  type WindowMaterial,
} from "../stores/settingsStore";
import { getTheme } from "../themes";
import { applySurfaceTokens, type EffectiveMode } from "./surfacePolicy";

export type MaterialKind = "none" | "vibrancy" | "acrylic";
export type AppearanceStatus =
  | "ok"
  | "pending"
  | "unsupported"
  | "apply-failed"
  | "clear-failed"
  | "timeout";

export interface AppearanceState {
  effectiveMode: EffectiveMode;
  material: MaterialKind;
  status: AppearanceStatus;
}

/** Mirror of the Rust AppearanceOutcome contract. */
export interface NativeOutcome {
  requestedMode: string;
  effectiveMode: string;
  material: string;
  status: string;
  reason: string | null;
}

/** How long a native request may take before the UI stops waiting on it. */
export const NATIVE_TIMEOUT_MS = 3000;

/**
 * The async boundary, injectable for tests. Returning null means "no usable
 * answer" — IPC failure — which the coordinator treats as a solid
 * fallback without forgetting the requested target. `blur` selects whether
 * glass carries the native frost or shows the desktop unblurred.
 */
export type NativeApply = (
  mode: WindowMaterial,
  blur: boolean,
) => Promise<NativeOutcome | null>;

/** The pending target: material preference plus its frost flag. */
export interface AppearanceTarget {
  mode: WindowMaterial;
  blur: boolean;
}

export interface Coordinator {
  /** Set the latest target; repeated calls collapse to the newest one. */
  request: (mode: WindowMaterial, blur: boolean) => void;
  /** Exposed for tests. */
  readonly desired: AppearanceTarget;
}

export function createAppearanceCoordinator(
  apply: NativeApply,
  onState: (state: AppearanceState) => void,
  initial: WindowMaterial = "solid",
  initialBlur = true,
): Coordinator {
  let desired: AppearanceTarget = { mode: initial, blur: initialBlur };
  let targetSeq = 0;
  let processedSeq = 0;
  let running = false;
  let replayedSeq = -1;

  const runLoop = async () => {
    running = true;
    try {
      while (processedSeq < targetSeq) {
        const seq = targetSeq;
        const target = desired;
        onState({ effectiveMode: current.effectiveMode, material: current.material, status: "pending" });
        let timedOut = false;
        const timer = setTimeout(() => {
          timedOut = true;
          current = { effectiveMode: "solid", material: current.material, status: "timeout" };
          onState(current);
        }, NATIVE_TIMEOUT_MS);
        let outcome: NativeOutcome | null = null;
        try {
          // Keep ownership of the real IPC promise after the UI timeout.
          // Another native call must not start while this one can still mutate
          // the window. New targets/retries accumulate in targetSeq meanwhile.
          outcome = await apply(target.mode, target.blur);
        } catch {
          outcome = null;
        } finally {
          clearTimeout(timer);
        }
        // A newer request arrived while this one was in flight; drop the
        // stale result entirely and let the loop pick up the latest target.
        if (seq < targetSeq) continue;
        if (timedOut) {
          // A late result never paints tokens. Reconcile the latest target
          // with a fresh call, once per request, rather than retry forever
          // when a native service consistently exceeds the deadline.
          if (replayedSeq !== seq) {
            replayedSeq = seq;
            continue;
          }
          processedSeq = seq;
          continue;
        }
        processedSeq = seq;
        current = toState(outcome);
        onState(current);
      }
    } finally {
      running = false;
    }
  };

  let current: AppearanceState = {
    effectiveMode: "solid",
    material: "none",
    status: "ok",
  };

  return {
    request(mode, blur) {
      desired = { mode, blur };
      targetSeq += 1;
      if (!running) void runLoop();
    },
    get desired() {
      return desired;
    },
  };
}

function toState(outcome: NativeOutcome | null): AppearanceState {
  if (!outcome) {
    return { effectiveMode: "solid", material: "none", status: "apply-failed" };
  }
  if (outcome.status === "applied" || outcome.status === "cleared") {
    return {
      effectiveMode: outcome.effectiveMode as EffectiveMode,
      material: outcome.material as MaterialKind,
      status: "ok",
    };
  }
  return {
    // apply-failed / clear-failed / unsupported all paint solid.
    effectiveMode: "solid",
    material: (outcome.material as MaterialKind) || "none",
    status: outcome.status as AppearanceStatus,
  };
}

/** Effective state for the running app. Never persisted. */
export const useAppearanceStore = create<AppearanceState>(() => ({
  effectiveMode: "solid",
  material: "none",
  status: "ok",
}));

function isTauriRuntime(): boolean {
  return (
    typeof window !== "undefined" && "__TAURI_INTERNALS__" in window
  );
}

/** Raw native bridge. The coordinator bounds UI waiting without losing IPC. */
async function invokeNative(
  mode: WindowMaterial,
  blur: boolean,
): Promise<NativeOutcome | null> {
  if (!isTauriRuntime()) {
    // Ordinary browser preview: report unsupported instead of hanging.
    return {
      requestedMode: mode,
      effectiveMode: "solid",
      material: "none",
      status: "unsupported",
      reason: "browser-preview",
    };
  }
  try {
    return await invoke<NativeOutcome>("apply_window_appearance", { mode, blur });
  } catch {
    return null;
  }
}

function pushSurfaces() {
  const settings = useSettingsStore.getState();
  const appearance = useAppearanceStore.getState();
  applySurfaceTokens(
    getTheme(settings.themeId),
    appearance.effectiveMode,
    settings.backgroundOpacity,
  );
}

let coordinator: Coordinator | null = null;

/** Force the native layer back to the current preference (manual retry). */
export function retryWindowMaterial() {
  const s = useSettingsStore.getState();
  coordinator?.request(s.windowMaterial, s.backgroundBlur);
}

/**
 * Wire the coordinator to the settings store and paint the startup surface.
 * Called once from main.tsx; the coordinator does not depend on any panel
 * being mounted. Starts solid so the window is usable before the native
 * answer arrives, then applies a saved glass preference.
 */
export function initWindowAppearance() {
  if (coordinator) return;
  const settings = useSettingsStore.getState();
  coordinator = createAppearanceCoordinator(
    invokeNative,
    (state) => {
      useAppearanceStore.setState(state);
      pushSurfaces();
    },
    settings.windowMaterial,
    settings.backgroundBlur,
  );
  // Opaque surfaces first — usable content never waits on the native call.
  pushSurfaces();
  useSettingsStore.subscribe((s, prev) => {
    if (
      s.windowMaterial !== prev.windowMaterial ||
      s.backgroundBlur !== prev.backgroundBlur
    ) {
      // Blur flips reconcile the native layer too: glass without blur must
      // clear the frost, glass with blur must (re)apply it. Opacity and
      // theme changes never reach the coordinator.
      coordinator?.request(s.windowMaterial, s.backgroundBlur);
    }
    if (
      s.windowMaterial !== prev.windowMaterial ||
      s.backgroundOpacity !== prev.backgroundOpacity ||
      s.themeId !== prev.themeId ||
      s.accentOverride !== prev.accentOverride
    ) {
      pushSurfaces();
    }
  });
  coordinator.request(settings.windowMaterial, settings.backgroundBlur);
}
