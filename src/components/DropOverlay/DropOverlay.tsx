import { convertFileSrc } from "@tauri-apps/api/core";
import { usePtyStore } from "../../stores/ptyStore";
import { basename } from "../../lib/paths";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function isImage(p: string): boolean {
  return IMAGE_EXT.test(p);
}

export default function DropOverlay() {
  const paths = usePtyStore((s) => s.dropPaths);
  if (!paths || paths.length === 0) return null;

  const images = paths.filter(isImage).slice(0, 6);
  const nonImageCount = paths.length - paths.filter(isImage).length;

  return (
    <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center p-8 bg-accent/10 backdrop-blur-sm animate-[fade-in_0.15s_ease-out]">
      <div className="border-2 border-dashed border-accent rounded-2xl px-8 py-6 bg-panel/90 shadow-[0_0_60px_color-mix(in_srgb,var(--color-accent)_15%,transparent)] max-w-[80%] animate-[pop-in_0.18s_ease-out]">
        <div className="text-accent text-sm font-semibold tracking-[0.15em] uppercase mb-3">
          Drop to attach
        </div>
        <div className="text-[11px] text-muted mb-3">
          Hold Shift to insert paths into the terminal instead.
        </div>
        {images.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {images.map((p) => (
              <img
                key={p}
                src={convertFileSrc(p)}
                alt=""
                className="w-24 h-24 object-cover rounded-lg border border-edge shadow-lg shadow-black/30"
                draggable={false}
              />
            ))}
          </div>
        )}
        <ul className="font-mono text-xs text-ink space-y-1 max-h-40 overflow-hidden">
          {paths.slice(0, 8).map((p) => (
            <li key={p} className="truncate" title={p}>
              {basename(p)}
            </li>
          ))}
          {paths.length > 8 && (
            <li className="text-muted">+{paths.length - 8} more…</li>
          )}
        </ul>
        {nonImageCount > 0 && images.length > 0 && (
          <div className="text-[10px] text-muted mt-2">
            {nonImageCount} non-image file{nonImageCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
