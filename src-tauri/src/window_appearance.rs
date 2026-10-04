//! Native window material: macOS Vibrancy, Windows Acrylic.
//!
//! Tauri 2.11.3's `windowEffects` wrapper calls window-vibrancy but discards
//! its return values, so apply/clear failures would be invisible and the
//! frontend could not fall back to a solid surface. This module calls
//! window-vibrancy 0.6 directly on the main thread and reports the real
//! outcome. The frontend treats `effectiveMode: "solid"` as "paint opaque".

use serde::Serialize;
use tauri::AppHandle;

/// What one `apply_window_appearance` call settled on.
#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppearanceOutcome {
    /// What the frontend asked for (echoed, never normalized away).
    pub requested_mode: String,
    /// What the window actually shows: "glass" only after a successful apply.
    pub effective_mode: String,
    /// none | vibrancy | acrylic
    pub material: String,
    /// applied | cleared | unsupported | apply-failed | clear-failed
    pub status: String,
    /// Short machine-readable reason; the UI renders its own localized text.
    pub reason: Option<String>,
}

impl AppearanceOutcome {
    fn ok(requested_mode: &str, effective_mode: &str, material: &str, status: &str) -> Self {
        Self {
            requested_mode: requested_mode.to_string(),
            effective_mode: effective_mode.to_string(),
            material: material.to_string(),
            status: status.to_string(),
            reason: None,
        }
    }

    fn failed(
        requested_mode: &str,
        material: &str,
        status: &str,
        reason: impl Into<String>,
    ) -> Self {
        Self {
            requested_mode: requested_mode.to_string(),
            // A failed apply/clear always leaves the frontend painting solid.
            effective_mode: "solid".to_string(),
            material: material.to_string(),
            status: status.to_string(),
            reason: Some(reason.into()),
        }
    }
}

#[tauri::command]
pub fn apply_window_appearance(
    app: AppHandle,
    mode: String,
    blur: Option<bool>,
) -> Result<AppearanceOutcome, String> {
    eprintln!(
        "[window_appearance] apply_window_appearance called with mode={mode:?} blur={blur:?}"
    );
    // Unknown modes must not touch the last valid native configuration.
    if mode != "solid" && mode != "glass" {
        return Err(format!("unknown appearance mode: {mode:?}"));
    }
    // A missing flag keeps the frost — the historical glass behavior.
    let result = platform::apply(&app, &mode, blur != Some(false));
    eprintln!("[window_appearance] result={result:?}");
    Ok(result)
}

#[cfg(any(target_os = "macos", target_os = "windows"))]
mod platform {
    use super::{AppHandle, AppearanceOutcome};
    use std::sync::Mutex;
    use tauri::{Manager, WebviewWindow};

    /// The material currently on the window. Distinct from the user's saved
    /// preference: a failed glass apply leaves this `false` while the
    /// frontend keeps "glass" for the next retry.
    static GLASS_APPLIED: Mutex<bool> = Mutex::new(false);

    const MATERIAL: &str = if cfg!(target_os = "macos") {
        "vibrancy"
    } else {
        "acrylic"
    };

    pub fn apply(app: &AppHandle, mode: &str, blur: bool) -> AppearanceOutcome {
        // What the window should end up with: glass carries the native layer
        // only when the frost is wanted — "glass" without blur still reports
        // an effective glass surface (the frontend tint stays translucent),
        // just with no material behind it.
        let want_layer = mode == "glass" && blur;
        // Idempotence: repeating the state already on the window is a no-op,
        // so retries after success never stack a second native layer.
        {
            let applied = GLASS_APPLIED.lock().unwrap();
            if want_layer == *applied {
                return match (mode, want_layer) {
                    ("glass", true) => AppearanceOutcome::ok(mode, "glass", MATERIAL, "applied"),
                    ("glass", false) => AppearanceOutcome::ok(mode, "glass", "none", "applied"),
                    _ => AppearanceOutcome::ok(mode, "solid", "none", "cleared"),
                };
            }
        }

        let Some(window) = app.get_webview_window("main") else {
            return AppearanceOutcome::failed(mode, "none", "apply-failed", "main-window-missing");
        };

        // window-vibrancy's macOS path requires MainThreadMarker; run both
        // platforms on the UI thread for a uniform contract. Tauri commands
        // run off the main thread, so the blocking recv cannot deadlock.
        let (tx, rx) = std::sync::mpsc::channel();
        if app
            .run_on_main_thread(move || {
                let result = if want_layer {
                    apply_glass(&window)
                } else {
                    clear_glass(&window)
                };
                let _ = tx.send(result);
            })
            .is_err()
        {
            return AppearanceOutcome::failed(mode, "none", "apply-failed", "main-thread-busy");
        }
        let result = rx
            .recv()
            .unwrap_or_else(|_| Err("main-thread-dropped".to_string()));

        match (want_layer, result) {
            (true, Ok(())) => {
                *GLASS_APPLIED.lock().unwrap() = true;
                AppearanceOutcome::ok(mode, "glass", MATERIAL, "applied")
            }
            (true, Err(e)) => AppearanceOutcome::failed(mode, "none", "apply-failed", e),
            (false, Ok(())) => {
                *GLASS_APPLIED.lock().unwrap() = false;
                if mode == "glass" {
                    AppearanceOutcome::ok(mode, "glass", "none", "applied")
                } else {
                    AppearanceOutcome::ok(mode, "solid", "none", "cleared")
                }
            }
            // Cleanup failed: the native layer may still be there. Keep the
            // applied flag so the next clear request retries the clear, and
            // tell the frontend to cover it with an opaque surface.
            (false, Err(e)) => AppearanceOutcome::failed(mode, MATERIAL, "clear-failed", e),
        }
    }

    #[cfg(target_os = "macos")]
    fn apply_glass(window: &WebviewWindow) -> Result<(), String> {
        // Clear first: apply_vibrancy adds a subview every call, and a
        // previously half-failed state must not stack a second one.
        let _ = window_vibrancy::clear_vibrancy(window);
        window_vibrancy::apply_vibrancy(
            window,
            window_vibrancy::NSVisualEffectMaterial::UnderWindowBackground,
            // Let the system dim the material when the window is inactive.
            Some(window_vibrancy::NSVisualEffectState::FollowsWindowActiveState),
            None,
        )
        .map_err(|e| e.to_string())
    }

    #[cfg(target_os = "macos")]
    fn clear_glass(window: &WebviewWindow) -> Result<(), String> {
        window_vibrancy::clear_vibrancy(window)
            .map(|_| ())
            .map_err(|e| e.to_string())
    }

    #[cfg(target_os = "windows")]
    fn apply_glass(window: &WebviewWindow) -> Result<(), String> {
        // No tint color: the frontend's own translucent surface provides it,
        // so one opacity setting drives the whole window.
        window_vibrancy::apply_acrylic(window, None).map_err(|e| e.to_string())
    }

    #[cfg(target_os = "windows")]
    fn clear_glass(window: &WebviewWindow) -> Result<(), String> {
        window_vibrancy::clear_acrylic(window).map_err(|e| e.to_string())
    }
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
mod platform {
    use super::{AppHandle, AppearanceOutcome};

    pub fn apply(_app: &AppHandle, mode: &str, _blur: bool) -> AppearanceOutcome {
        // The window is not transparent on this platform, so glass falls back
        // to solid whether or not the frost was requested.
        if mode == "glass" {
            AppearanceOutcome::failed(mode, "none", "unsupported", "platform-unsupported")
        } else {
            AppearanceOutcome::ok(mode, "solid", "none", "cleared")
        }
    }
}
