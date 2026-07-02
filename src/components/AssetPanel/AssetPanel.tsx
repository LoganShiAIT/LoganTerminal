import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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
            clipItems.map((item) => (
              <AssetCard
                key={item.id}
                onClick={() => insertClipboard(item)}
                onRemove={() => {
                  removeClip(item.id);
                  invoke("clipboard_remove", { id: item.id }).catch(() => {});
                }}
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
            shots.map((item) => (
              <AssetCard
                key={item.id}
                onClick={() => writePath(item.path)}
                onRemove={() => {
                  removeShot(item.id);
                  invoke("screenshot_remove", { id: item.id }).catch(() => {});
                }}
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
    </div>
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
  onClick: () => void;
  onRemove: () => void;
  kind: "image" | "text";
  timestamp: number;
  footer?: React.ReactNode;
  children: React.ReactNode;
}

function AssetCard({
  onClick,
  onRemove,
  kind,
  timestamp,
  footer,
  children,
}: AssetCardProps) {
  return (
    <div
      className="group relative rounded-lg border border-edge bg-ink/[0.04] overflow-hidden cursor-pointer transition-[border-color,box-shadow] duration-150 hover:border-accent/50 hover:shadow-[0_2px_16px_rgba(0,0,0,0.35)] animate-[card-in_0.22s_ease-out]"
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
