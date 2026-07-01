use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::PathBuf;
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use arboard::{Clipboard, ImageData};
use base64::Engine;
use image::{ImageEncoder, RgbaImage};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

const POLL_INTERVAL: Duration = Duration::from_millis(500);
const MAX_HISTORY: usize = 20;
const THUMBNAIL_MAX: u32 = 240;
const MAX_IMAGE_PIXELS: usize = 20_000_000; // ~20MP hard cap

#[derive(Clone, Serialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum ClipboardKind {
    Text,
    Image,
}

#[derive(Clone, Serialize)]
pub struct ClipboardItem {
    pub id: String,
    pub timestamp: u64,
    pub kind: ClipboardKind,
    pub preview: String,
    pub full_text: Option<String>,
    pub image_path: Option<String>,
}

#[derive(Default)]
pub struct ClipboardHistory {
    items: Mutex<Vec<ClipboardItem>>,
}

impl ClipboardHistory {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn push(&self, item: ClipboardItem) {
        let evicted = {
            let mut items = self.items.lock();
            items.insert(0, item);
            if items.len() > MAX_HISTORY {
                items.split_off(MAX_HISTORY)
            } else {
                Vec::new()
            }
        };
        delete_image_files(evicted);
    }

    pub fn snapshot(&self) -> Vec<ClipboardItem> {
        self.items.lock().clone()
    }

    pub fn remove(&self, id: &str) {
        let removed = {
            let mut items = self.items.lock();
            let idx = items.iter().position(|item| item.id == id);
            idx.map(|i| items.remove(i))
        };
        delete_image_files(removed);
    }
}

pub fn spawn_monitor(app: AppHandle) {
    thread::spawn(move || {
        let mut clipboard = match Clipboard::new() {
            Ok(cb) => cb,
            Err(e) => {
                eprintln!("[clipboard] init failed: {}", e);
                return;
            }
        };

        let mut last_text_hash: u64 = 0;
        let mut last_image_hash: u64 = 0;

        loop {
            thread::sleep(POLL_INTERVAL);

            if let Ok(img) = clipboard.get_image() {
                if img.bytes.len() > MAX_IMAGE_PIXELS * 4 {
                    continue;
                }
                let hash = hash_image(&img);
                if hash != last_image_hash {
                    last_image_hash = hash;
                    last_text_hash = 0;
                    if let Some(item) = build_image_item(&app, &img) {
                        emit_add(&app, item);
                    }
                }
                continue;
            }

            if let Ok(text) = clipboard.get_text() {
                if text.is_empty() {
                    continue;
                }
                let hash = hash_bytes(text.as_bytes());
                if hash != last_text_hash {
                    last_text_hash = hash;
                    last_image_hash = 0;
                    emit_add(&app, build_text_item(text));
                }
            }
        }
    });
}

/// Deletes the on-disk PNG (if any) backing each item. Used when items fall
/// out of history — either evicted past `MAX_HISTORY` or explicitly removed —
/// so `~/.logan-terminal/clipboard/` doesn't grow forever.
fn delete_image_files(items: impl IntoIterator<Item = ClipboardItem>) {
    for item in items {
        if let Some(path) = item.image_path {
            let _ = std::fs::remove_file(path);
        }
    }
}

fn emit_add(app: &AppHandle, item: ClipboardItem) {
    let history = app.state::<ClipboardHistory>();
    history.push(item.clone());
    let _ = app.emit("clipboard://add", item);
}

fn build_text_item(text: String) -> ClipboardItem {
    let preview: String = text.chars().take(160).collect();
    ClipboardItem {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: now_ms(),
        kind: ClipboardKind::Text,
        preview,
        full_text: Some(text),
        image_path: None,
    }
}

fn build_image_item(app: &AppHandle, img: &ImageData) -> Option<ClipboardItem> {
    let rgba = RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.to_vec())?;
    let thumb = make_thumbnail(&rgba, THUMBNAIL_MAX);
    let thumb_data_url = encode_png_data_url(&thumb).ok()?;
    let path = save_png(&clipboard_dir(app).ok()?, &rgba).ok()?;
    let _ = app; // AppHandle only used to derive path
    Some(ClipboardItem {
        id: uuid::Uuid::new_v4().to_string(),
        timestamp: now_ms(),
        kind: ClipboardKind::Image,
        preview: thumb_data_url,
        full_text: None,
        image_path: Some(path.to_string_lossy().into_owned()),
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

fn save_png(dir: &std::path::Path, img: &RgbaImage) -> anyhow::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let path = dir.join(format!("clip-{}.png", now_ms()));
    img.save(&path)?;
    Ok(path)
}

fn clipboard_dir(_app: &AppHandle) -> anyhow::Result<PathBuf> {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .map_err(|_| anyhow::anyhow!("no HOME/USERPROFILE"))?;
    Ok(PathBuf::from(home)
        .join(".logan-terminal")
        .join("clipboard"))
}

fn hash_image(img: &ImageData) -> u64 {
    let mut h = DefaultHasher::new();
    img.width.hash(&mut h);
    img.height.hash(&mut h);
    let step = std::cmp::max(1, img.bytes.len() / 512);
    for i in (0..img.bytes.len()).step_by(step) {
        img.bytes[i].hash(&mut h);
    }
    h.finish()
}

fn hash_bytes(b: &[u8]) -> u64 {
    let mut h = DefaultHasher::new();
    b.hash(&mut h);
    h.finish()
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

#[tauri::command]
pub fn clipboard_history(state: State<'_, ClipboardHistory>) -> Vec<ClipboardItem> {
    state.snapshot()
}

#[tauri::command]
pub fn clipboard_remove(state: State<'_, ClipboardHistory>, id: String) {
    state.remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_test_dir() -> PathBuf {
        std::env::temp_dir().join(format!("logan-clip-test-{}", uuid::Uuid::new_v4()))
    }

    fn touch(path: &std::path::Path) {
        std::fs::write(path, b"x").unwrap();
    }

    fn image_item(id: &str, path: &std::path::Path) -> ClipboardItem {
        ClipboardItem {
            id: id.to_string(),
            timestamp: 0,
            kind: ClipboardKind::Image,
            preview: String::new(),
            full_text: None,
            image_path: Some(path.to_string_lossy().into_owned()),
        }
    }

    #[test]
    fn push_deletes_evicted_image_files() {
        let dir = temp_test_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let history = ClipboardHistory::new();
        let paths: Vec<_> = (0..=MAX_HISTORY)
            .map(|i| dir.join(format!("{i}.png")))
            .collect();
        for (i, path) in paths.iter().enumerate() {
            touch(path);
            history.push(image_item(&i.to_string(), path));
        }

        assert!(!paths[0].exists(), "oldest item's file should be deleted");
        for path in &paths[1..] {
            assert!(path.exists(), "recent items' files should survive");
        }
        std::fs::remove_dir_all(&dir).ok();
    }

    #[test]
    fn remove_deletes_the_items_image_file() {
        let dir = temp_test_dir();
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("only.png");
        touch(&path);
        let history = ClipboardHistory::new();
        history.push(image_item("a", &path));

        history.remove("a");

        assert!(!path.exists());
        std::fs::remove_dir_all(&dir).ok();
    }
}
