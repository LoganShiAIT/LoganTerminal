import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { openPath } from "@tauri-apps/plugin-opener";
import {
  useClipboardStore,
  type ClipboardItem,
} from "../../stores/clipboardStore";
import {
  useScreenshotStore,
  type ScreenshotItem,
} from "../../stores/screenshotStore";
import { useActiveTab } from "../../stores/ptyStore";
import { shellEscapePath } from "../../lib/shellEscape";
import { basename } from "../../lib/paths";

interface LightboxData {
  /** Full-resolution source (asset-protocol URL when a file path exists). */
  src: string;
  /** Data-URL preview to fall back to if the asset protocol refuses. */
  fallbackSrc?: string;
  path: string | null;
  timestamp: number;
}

function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 5) return "just now";
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

export default function AssetPanel() {
  const clipItems = useClipboardStore((s) => s.items);
  const setClip = useClipboardStore((s) => s.setItems);
  const prependClip = useClipboardStore((s) => s.prepend);
  const removeClip = useClipboardStore((s) => s.remove);

  const shots = useScreenshotStore((s) => s.items);
  const setShots = useScreenshotStore((s) => s.setItems);
  const prependShot = useScreenshotStore((s) => s.prepend);
  const removeShot = useScreenshotStore((s) => s.remove);

  const activeSessionId = useActiveTab()?.sessionId ?? null;
  const [lightbox, setLightbox] = useState<LightboxData | null>(null);

  useEffect(() => {
    invoke<ClipboardItem[]>("clipboard_history")
      .then(setClip)
      .catch((err) => console.error("clipboard_history failed", err));
    invoke<ScreenshotItem[]>("screenshot_history")
      .then(setShots)
      .catch((err) => console.error("screenshot_history failed", err));

    const unlisteners: Array<() => void> = [];
    (async () => {
      unlisteners.push(
        await listen<ClipboardItem>("clipboard://add", (e) =>
          prependClip(e.payload),
        ),
      );
      unlisteners.push(
        await listen<ScreenshotItem>("screenshot://add", (e) =>
          prependShot(e.payload),
        ),
      );
    })();
    return () => {
      unlisteners.forEach((u) => u());
    };
  }, [setClip, setShots, prependClip, prependShot]);

  const writePath = async (path: string) => {
    if (!activeSessionId) return;
    const escaped = await shellEscapePath(path);
    invoke("pty_write", {
      sessionId: activeSessionId,
      data: escaped + " ",
    });
  };

  const insertClipboard = (item: ClipboardItem) => {
    if (!activeSessionId) return;
    if (item.kind === "image" && item.image_path) {
      writePath(item.image_path);
    } else {
      invoke("pty_write", {
        sessionId: activeSessionId,
        data: item.full_text ?? item.preview,
      });
    }
  };

  const isEmpty = clipItems.length === 0 && shots.length === 0;

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 pt-3 pb-2 border-b border-edge shrink-0">
        <div className="text-[10px] uppercase tracking-[0.18em] text-accent font-semibold">
          Assets
        </div>
        <div className="font-mono text-[11px] text-muted mt-1 truncate">
          {isEmpty
            ? "copy or screenshot to collect"
            : `${clipItems.length} clipboard · ${shots.length} shot${shots.length === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section label="Clipboard" count={clipItems.length}>
          {clipItems.length === 0 ? (
            <Placeholder text="Copy text or an image to see it here." />
          ) : (
            clipItems.map((item, i) => (
              <AssetCard
                key={item.id}
                index={i}
                onClick={() => insertClipboard(item)}
                onRemove={() => {
                  removeClip(item.id);
                  invoke("clipboard_remove", { id: item.id }).catch(() => {});
                }}
                onZoom={
                  item.kind === "image"
                    ? () =>
                        setLightbox({
                          src: item.image_path
                            ? convertFileSrc(item.image_path)
                            : item.preview,
                          fallbackSrc: item.preview,
                          path: item.image_path ?? null,
                          timestamp: item.timestamp,
                        })
                    : undefined
                }
                kind={item.kind}
                timestamp={item.timestamp}
              >
                {item.kind === "image" ? (
                  <img
                    src={item.preview}
                    alt="clipboard"
                    className="w-full max-h-40 object-contain bg-black/40"
                    draggable={false}
                  />
                ) : (
                  <div className="px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-all line-clamp-3 text-ink/90">
                    {item.preview}
                  </div>
                )}
              </AssetCard>
            ))
          )}
        </Section>

        <Section label="Screenshots" count={shots.length}>
          {shots.length === 0 ? (
            <Placeholder text="Take a screenshot to have it appear here." />
          ) : (
            shots.map((item, i) => (
              <AssetCard
                key={item.id}
                index={i}
                onClick={() => writePath(item.path)}
                onRemove={() => {
                  removeShot(item.id);
                  invoke("screenshot_remove", { id: item.id }).catch(() => {});
                }}
                onZoom={() =>
                  setLightbox({
                    src: convertFileSrc(item.path),
                    fallbackSrc: item.thumbnail,
                    path: item.path,
                    timestamp: item.timestamp,
                  })
                }
                kind="image"
                timestamp={item.timestamp}
                footer={
                  <span className="truncate max-w-[70%]" title={item.path}>
                    {basename(item.path)}
                  </span>
                }
              >
                <img
                  src={item.thumbnail}
                  alt="screenshot"
                  className="w-full max-h-40 object-contain bg-black/40"
                  draggable={false}
                />
              </AssetCard>
            ))
          )}
        </Section>
      </div>

      {lightbox && (
        <Lightbox
          data={lightbox}
          canInsert={Boolean(activeSessionId && lightbox.path)}
          onInsert={() => {
            if (lightbox.path) writePath(lightbox.path);
            setLightbox(null);
          }}
          onClose={() => setLightbox(null)}
        />
      )}
    </div>
  );
}

function Lightbox({
  data,
  canInsert,
  onInsert,
  onClose,
}: {
  data: LightboxData;
  canInsert: boolean;
  onInsert: () => void;
  onClose: () => void;
}) {
  const [src, setSrc] = useState(data.src);

  // Capture-phase Esc so it wins over the focused xterm textarea.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const btn =
    "h-7 px-3 rounded-md border border-edge text-[11px] text-muted transition-colors hover:border-accent/40 hover:text-accent disabled:opacity-40 disabled:pointer-events-none";

  // Portal to <body>: the sidebar's backdrop-filter would otherwise become
  // the containing block for this fixed overlay and clip it to the panel.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/60 backdrop-blur-md p-8 animate-[fade-in_0.12s_ease-out]"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <img
        src={src}
        alt="preview"
        draggable={false}
        onError={() => {
          if (data.fallbackSrc && src !== data.fallbackSrc)
            setSrc(data.fallbackSrc);
        }}
        className="max-h-[74vh] max-w-[88vw] rounded-xl border border-edge shadow-[0_24px_90px_rgba(0,0,0,0.6)] animate-[pop-in_0.16s_ease-out] object-contain"
      />
      <div className="flex items-center gap-2 rounded-xl border border-edge bg-raise/95 backdrop-blur-md px-3 py-2 shadow-[0_8px_30px_rgba(0,0,0,0.45)] animate-[card-in_0.2s_ease-out]">
        {data.path && (
          <span
            className="max-w-[280px] truncate font-mono text-[10px] text-faint"
            title={data.path}
          >
            {basename(data.path)}
          </span>
        )}
        <button className={btn} disabled={!canInsert} onClick={onInsert}>
          Insert Path
        </button>
        <button
          className={btn}
          disabled={!data.path}
          onClick={() =>
            data.path && navigator.clipboard.writeText(data.path)
          }
        >
          Copy Path
        </button>
        <button
          className={btn}
          disabled={!data.path}
          onClick={() => data.path && openPath(data.path)}
        >
          Open
        </button>
        <button className={btn} onClick={onClose}>
          Close
        </button>
      </div>
    </div>,
    document.body,
  );
}

function Section({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <div className="p-2">
      <div className="flex items-center justify-between px-1 mb-1.5">
        <span className="text-[10px] uppercase tracking-[0.18em] text-muted">
          {label}
        </span>
        {count > 0 && (
          <span className="font-mono text-[10px] text-faint">{count}</span>
        )}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="px-3 py-4 rounded-lg border border-dashed border-edge text-center text-[11px] leading-relaxed text-faint">
      {text}
    </div>
  );
}

interface AssetCardProps {
  index: number;
  onClick: () => void;
  onRemove: () => void;
  onZoom?: () => void;
  kind: "image" | "text";
  timestamp: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

function AssetCard({
  index,
  onClick,
  onRemove,
  onZoom,
  kind,
  timestamp,
  footer,
  children,
}: AssetCardProps) {
  return (
    <div
      className="group relative rounded-lg border border-edge bg-ink/[0.04] overflow-hidden cursor-pointer transition-[border-color,box-shadow,transform] duration-150 hover:border-accent/50 hover:shadow-[0_6px_20px_rgba(0,0,0,0.4)] hover:-translate-y-0.5 animate-[card-in_0.25s_ease-out_both]"
      style={{ animationDelay: `${Math.min(index * 40, 240)}ms` }}
      onClick={onClick}
      title="Click to insert into terminal"
    >
      {children}
      <button
        className="absolute top-1.5 right-1.5 w-5 h-5 grid place-items-center rounded-md bg-black/60 backdrop-blur-sm text-ink/70 text-[11px] leading-none opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-white transition-[opacity,background-color,color] duration-150"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove"
      >
        ×
      </button>
      {onZoom && (
        <button
          className="absolute top-1.5 left-1.5 w-5 h-5 grid place-items-center rounded-md bg-black/60 backdrop-blur-sm text-ink/70 opacity-0 group-hover:opacity-100 hover:bg-accent hover:text-white transition-[opacity,background-color,color] duration-150"
          onClick={(e) => {
            e.stopPropagation();
            onZoom();
          }}
          title="Preview full size"
        >
          <svg
            width="11"
            height="11"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M6.5 2.5h-4v4M9.5 13.5h4v-4M2.5 2.5 7 7M13.5 13.5 9 9" />
          </svg>
        </button>
      )}
      <div className="h-6 px-2.5 flex items-center justify-between gap-2 text-[10px] text-faint border-t border-edge bg-ink/[0.02]">
        <span className="flex items-center gap-1.5">
          <span
            className={`w-1 h-1 rounded-full ${
              kind === "image" ? "bg-accent/80" : "bg-muted/70"
            }`}
          />
          {kind}
        </span>
        <span className="flex items-center gap-2 min-w-0">
          {footer}
          <span className="shrink-0">{timeAgo(timestamp)}</span>
        </span>
      </div>
    </div>
  );
}
