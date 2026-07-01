import { convertFileSrc } from "@tauri-apps/api/core";
import { usePtyStore } from "../../stores/ptyStore";

const IMAGE_EXT = /\.(png|jpe?g|gif|webp|bmp|svg)$/i;

function basename(p: string): string {
  const idx = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return idx >= 0 ? p.slice(idx + 1) : p;
}

function isImage(p: string): boolean {
  return IMAGE_EXT.test(p);
}

export default function DropOverlay() {
  const paths = usePtyStore((s) => s.dropPaths);
  if (!paths || paths.length === 0) return null;

  const images = paths.filter(isImage).slice(0, 6);
  const nonImageCount = paths.length - paths.filter(isImage).length;

  return (
    <div className="absolute inset-0 z-50 pointer-events-none flex items-center justify-center p-8 bg-[color:var(--claude-orange)]/10 backdrop-blur-sm">
      <div className="border-2 border-dashed border-[color:var(--claude-orange)] rounded-2xl px-8 py-6 bg-[color:var(--bg-panel)]/85 shadow-[0_0_60px_var(--claude-orange-soft)] max-w-[80%]">
        <div className="text-[color:var(--claude-orange)] text-sm font-semibold tracking-[0.15em] uppercase mb-3">
          Drop to insert path
        </div>
        {images.length > 0 && (
          <div className="flex gap-2 mb-3 flex-wrap">
            {images.map((p) => (
              <img
                key={p}
                src={convertFileSrc(p)}
                alt=""
                className="w-24 h-24 object-cover rounded-md border border-[color:var(--border-warm)]"
                draggable={false}
              />
            ))}
          </div>
        )}
        <ul className="text-xs text-[color:var(--text-primary)] space-y-1 max-h-40 overflow-hidden">
          {paths.slice(0, 8).map((p) => (
            <li key={p} className="truncate" title={p}>
              {basename(p)}
            </li>
          ))}
          {paths.length > 8 && (
            <li className="text-[color:var(--text-muted)]">
              +{paths.length - 8} more…
            </li>
          )}
        </ul>
        {nonImageCount > 0 && images.length > 0 && (
          <div className="text-[10px] text-[color:var(--text-muted)] mt-2">
            {nonImageCount} non-image file{nonImageCount === 1 ? "" : "s"}
          </div>
        )}
      </div>
    </div>
  );
}
