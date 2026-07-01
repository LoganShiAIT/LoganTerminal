use std::path::{Path, PathBuf};
use std::sync::mpsc::channel;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use base64::Engine;
use image::{ImageEncoder, RgbaImage};
use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const MAX_HISTORY: usize = 20;
const THUMBNAIL_MAX: u32 = 240;

#[derive(Clone, Serialize)]
pub struct ScreenshotItem {
    pub id: String,
    pub timestamp: u64,
    pub path: String,
    pub thumbnail: String,
}

#[derive(Default)]
pub struct ScreenshotHistory {
    items: Mutex<Vec<ScreenshotItem>>,
}

impl ScreenshotHistory {
    pub fn new() -> Self {
        Self::default()
    }

    /// Returns true if the item was newly added; false if a duplicate path already exists.
    pub fn push_dedup(&self, item: ScreenshotItem) -> bool {
        let mut items = self.items.lock();
        if items.iter().any(|i| i.path == item.path) {
            return false;
        }
        items.insert(0, item);
        items.truncate(MAX_HISTORY);
        true
    }

    pub fn snapshot(&self) -> Vec<ScreenshotItem> {
        self.items.lock().clone()
    }

    pub fn remove(&self, id: &str) {
        self.items.lock().retain(|i| i.id != id);
    }

    fn replace(&self, items: Vec<ScreenshotItem>) {
        *self.items.lock() = items;
    }
}

pub fn seed_recent(app: &AppHandle) {
    let mut candidates: Vec<(SystemTime, PathBuf)> = screenshot_dirs()
        .into_iter()
        .filter_map(|dir| std::fs::read_dir(dir).ok())
        .flat_map(|read| read.filter_map(|entry| entry.ok()))
        .map(|entry| entry.path())
        .filter(|path| is_screenshot(path))
        .filter_map(|path| {
            let modified = path.metadata().and_then(|m| m.modified()).ok()?;
            Some((modified, path))
        })
        .collect();

    candidates.sort_by(|a, b| b.0.cmp(&a.0));
    let items: Vec<ScreenshotItem> = candidates
        .into_iter()
        .filter_map(|(modified, path)| build_screenshot_item_with_time(&path, modified, false))
        .take(MAX_HISTORY)
        .collect();

    app.state::<ScreenshotHistory>().replace(items);
}

pub fn spawn_watcher(app: AppHandle) {
    thread::spawn(move || {
        let (tx, rx) = channel::<notify::Result<Event>>();
        let mut watcher: RecommendedWatcher = match notify::recommended_watcher(tx) {
            Ok(w) => w,
            Err(e) => {
                eprintln!("[screenshots] watcher init failed: {}", e);
                return;
            }
        };
        for dir in screenshot_dirs() {
            if dir.exists() {
                let _ = watcher.watch(&dir, RecursiveMode::NonRecursive);
            }
        }

        for res in rx {
            let Ok(event) = res else { continue };
            if !matches!(event.kind, EventKind::Create(_) | EventKind::Modify(_)) {
                continue;
            }
            for path in event.paths {
                if !is_screenshot(&path) {
                    continue;
                }
                if let Some(item) = build_screenshot_item_with_time(&path, SystemTime::now(), true)
                {
                    let history = app.state::<ScreenshotHistory>();
                    if history.push_dedup(item.clone()) {
                        let _ = app.emit("screenshot://add", item);
                    }
                }
            }
        }
    });
}

fn is_screenshot(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    let ext_ok = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let lower = e.to_ascii_lowercase();
            lower == "png" || lower == "jpg" || lower == "jpeg"
        })
        .unwrap_or(false);
    if !ext_ok {
        return false;
    }
    // macOS default name prefixes (English + Chinese), Windows Snipping/Snip prefixes.
    let starts = [
        "Screen Shot",
        "Screenshot",
        "截屏",
        "截图",
        "屏幕截图",
        "Snip",
    ];
    starts.iter().any(|p| name.starts_with(p))
}

fn build_screenshot_item_with_time(
    path: &Path,
    timestamp: SystemTime,
    retry: bool,
) -> Option<ScreenshotItem> {
    // Retry a few times: file may still be being written.
    let img = if retry {
        (0..6).find_map(|i| {
            thread::sleep(Duration::from_millis(if i == 0 { 250 } else { 200 }));
            image::open(path).ok()
        })?
    } else {
        image::open(path).ok()?
    };
    let rgba = img.to_rgba8();
    let thumb = make_thumbnail(&rgba, THUMBNAIL_MAX);
    let data_url = encode_png_data_url(&thumb).ok()?;
    Some(ScreenshotItem {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: time_ms(timestamp),
        path: path.to_string_lossy().into_owned(),
        thumbnail: data_url,
    })
}

fn make_thumbnail(img: &RgbaImage, max: u32) -> RgbaImage {
    let (w, h) = img.dimensions();
    if w <= max && h <= max {
        return img.clone();
    }
    let (nw, nh) = if w >= h {
        let nh = ((max as u64 * h as u64) / w as u64).max(1) as u32;
        (max, nh)
    } else {
        let nw = ((max as u64 * w as u64) / h as u64).max(1) as u32;
        (nw, max)
    };
    image::imageops::resize(img, nw, nh, image::imageops::FilterType::Triangle)
}

fn encode_png_data_url(img: &RgbaImage) -> anyhow::Result<String> {
    let mut buf: Vec<u8> = Vec::new();
    let encoder = image::codecs::png::PngEncoder::new(&mut buf);
    encoder.write_image(
        img.as_raw(),
        img.width(),
        img.height(),
        image::ExtendedColorType::Rgba8,
    )?;
    let b64 = base64::engine::general_purpose::STANDARD.encode(&buf);
    Ok(format!("data:image/png;base64,{}", b64))
}

#[cfg(target_os = "macos")]
fn screenshot_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(out) = std::process::Command::new("defaults")
        .args(["read", "com.apple.screencapture", "location"])
        .output()
    {
        if out.status.success() {
            let raw = String::from_utf8_lossy(&out.stdout).trim().to_string();
            let expanded = if let Some(rest) = raw.strip_prefix("~/") {
                std::env::var("HOME")
                    .map(|h| PathBuf::from(h).join(rest))
                    .unwrap_or_else(|_| PathBuf::from(raw.clone()))
            } else {
                PathBuf::from(raw)
            };
            if !expanded.as_os_str().is_empty() {
                dirs.push(expanded);
            }
        }
    }
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(home).join("Desktop"));
    }
    dirs.sort();
    dirs.dedup();
    dirs
}

#[cfg(target_os = "windows")]
fn screenshot_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(profile) = std::env::var("USERPROFILE") {
        dirs.push(PathBuf::from(&profile).join("Pictures").join("Screenshots"));
        dirs.push(
            PathBuf::from(&profile)
                .join("Pictures")
                .join("Screen Captures"),
        );
        dirs.push(PathBuf::from(&profile).join("Desktop"));
    }
    dirs
}

#[cfg(not(any(target_os = "macos", target_os = "windows")))]
fn screenshot_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        dirs.push(PathBuf::from(&home).join("Pictures"));
        dirs.push(PathBuf::from(&home).join("Desktop"));
    }
    dirs
}

fn time_ms(time: SystemTime) -> u64 {
    time.duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn screenshot_history(state: State<'_, ScreenshotHistory>) -> Vec<ScreenshotItem> {
    state.snapshot()
}

#[tauri::command]
#[allow(dead_code)]
pub fn screenshot_remove(state: State<'_, ScreenshotHistory>, id: String) {
    state.remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_macos_english_names() {
        assert!(is_screenshot(Path::new(
            "/Users/x/Desktop/Screen Shot 2026-01-01 at 12.00.00.png"
        )));
        assert!(is_screenshot(Path::new(
            "/Users/x/Desktop/Screenshot 2026-01-01 at 12.00.00 PM.png"
        )));
    }

    #[test]
    fn matches_chinese_names() {
        assert!(is_screenshot(Path::new(
            "/Users/x/Desktop/截屏2026-01-01 12.00.00.png"
        )));
        assert!(is_screenshot(Path::new("/Users/x/Desktop/截图1.jpg")));
    }

    #[test]
    fn matches_windows_names() {
        assert!(is_screenshot(Path::new(
            "C:/Users/x/Pictures/Screenshots/Screenshot (1).png"
        )));
        assert!(is_screenshot(Path::new(
            "C:/Users/x/Pictures/Snip 2026-01-01.png"
        )));
    }

    #[test]
    fn rejects_random_files() {
        assert!(!is_screenshot(Path::new("/Users/x/Desktop/notes.txt")));
        assert!(!is_screenshot(Path::new("/Users/x/Desktop/photo.png")));
        assert!(!is_screenshot(Path::new("/Users/x/Desktop/Screen.pdf")));
    }

    #[test]
    fn converts_system_time_to_ms() {
        assert_eq!(time_ms(UNIX_EPOCH + Duration::from_millis(1234)), 1234);
    }
}
