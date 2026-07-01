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
      <div className="p-3 pb-2 border-b border-[color:var(--border-warm)] shrink-0">
        <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--claude-orange)] font-semibold">
          Assets
        </div>
        <div className="text-[color:var(--text-muted)] text-xs mt-1">
          {isEmpty
            ? "empty — copy or screenshot"
            : `${clipItems.length} clipboard · ${shots.length} shot${shots.length === 1 ? "" : "s"}`}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        <Section label="Clipboard">
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
                    className="w-full max-h-40 object-contain bg-black/30"
                    draggable={false}
                  />
                ) : (
                  <div className="px-2.5 py-2 text-xs whitespace-pre-wrap break-all line-clamp-3 text-[color:var(--text-primary)]">
                    {item.preview}
                  </div>
                )}
              </AssetCard>
            ))
          )}
        </Section>

        <Section label="Screenshots">
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
                    {item.path.split("/").pop()}
                  </span>
                }
              >
                <img
                  src={item.thumbnail}
                  alt="screenshot"
                  className="w-full max-h-40 object-contain bg-black/30"
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
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="p-2">
      <div className="text-[10px] uppercase tracking-[0.15em] text-[color:var(--text-muted)] mb-1.5 px-1">
        {label}
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function Placeholder({ text }: { text: string }) {
  return (
    <div className="px-2.5 py-3 text-xs text-[color:var(--text-muted)] italic">
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
      className="group rounded-md border border-[color:var(--border-warm)] bg-[color:var(--bg-base)]/60 hover:border-[color:var(--claude-orange)] cursor-pointer transition-colors overflow-hidden relative"
      onClick={onClick}
    >
      {children}
      <button
        className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 text-white/80 text-xs opacity-0 group-hover:opacity-100 transition-opacity leading-none"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        title="Remove"
      >
        ×
      </button>
      <div className="px-2.5 py-1 text-[10px] text-[color:var(--text-muted)] border-t border-[color:var(--border-warm)] flex items-center justify-between gap-2">
        <span>{kind}</span>
        <span className="flex items-center gap-2">
          {footer}
          <span>{timeAgo(timestamp)}</span>
        </span>
      </div>
    </div>
  );
}
