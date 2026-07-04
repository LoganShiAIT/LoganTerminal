import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

/**
 * Best-effort desktop notification. Failures are swallowed: on macOS a dev
 * binary isn't a proper .app bundle, so the permission APIs can misbehave —
 * a missed toast must never break terminal behavior.
 */
export async function notify(title: string, body: string) {
  try {
    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";
    if (ok) sendNotification({ title, body });
  } catch {
    // best-effort only
  }
}
