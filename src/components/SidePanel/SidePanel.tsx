import { useEffect, useRef } from "react";
import FileTree from "../FileTree/FileTree";
import AssetPanel from "../AssetPanel/AssetPanel";
import ReviewPanel from "../ReviewPanel/ReviewPanel";
import DiffPanel from "../DiffPanel/DiffPanel";
import MathPanel from "../MathPanel/MathPanel";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore, SIDEBAR_TABS, type SidebarTab } from "../../stores/uiStore";
import { useT } from "../../i18n";

/** Slower than a hover transition on purpose: a whole surface is changing. */
const SWAP_MS = "calc(var(--anim-scale) * 320ms)";
const PILL_MS = "calc(var(--anim-scale) * 280ms)";
const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

/**
 * The single sidebar: the file tree and the four review surfaces behind one
 * five-segment switcher.
 *
 * The file tree stays mounted and is hidden with `display: none`, because it
 * carries browsing state — the folder you navigated to, the scroll position —
 * that should survive a look at the diff. The other four mount only while
 * visible; each of them polls git or the filesystem, and none of them holds
 * state worth the traffic. Hiding by `display: none` is also what replays the
 * entrance animation on the way back in: a display-none element runs no
 * animation, so it starts over when it is shown again.
 */
export default function SidePanel() {
  const t = useT();
  const tab = useUiStore((s) => s.sidebarTab);
  const setTab = useUiStore((s) => s.setSidebarTab);
  const attachmentCount = useReviewStore((s) => s.attachments.length);

  // Literal `t` calls, not a module-level map: the translation test only
  // sees keys spelled out at the call site, and this re-reads the locale.
  const label: Record<SidebarTab, string> = {
    files: t("Files"),
    assets: t("Assets"),
    review: t("Review"),
    diff: t("Diff"),
    math: t("Math"),
  };

  const index = Math.max(0, SIDEBAR_TABS.indexOf(tab));
  // Which way the incoming panel slides from. Read during render and updated
  // after, so the value is the direction of the move that caused this render.
  const previous = useRef(index);
  const forward = index >= previous.current;
  useEffect(() => {
    previous.current = index;
  }, [index]);

  const swapStyle = {
    "--panel-from": forward ? "18px" : "-18px",
    animationDuration: SWAP_MS,
  } as React.CSSProperties;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge p-2 shrink-0">
        <div className="relative grid h-7 grid-cols-5 rounded-lg bg-ink/[0.05] p-0.5">
          {/* Sliding pill behind the active segment. */}
          <span
            aria-hidden
            className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/5)] rounded-md bg-accent/15 border border-accent/30"
            style={{
              transform: `translateX(${index * 100}%)`,
              transition: `transform ${PILL_MS} ${EASE}`,
            }}
          />
          {SIDEBAR_TABS.map((id) => (
            <button
              key={id}
              className={`relative z-10 h-full truncate rounded-md text-[11px] font-semibold uppercase tracking-[0.06em] ${
                tab === id ? "text-accent" : "text-muted hover:text-ink"
              }`}
              style={{ transition: `color ${PILL_MS} ${EASE}` }}
              onClick={() => setTab(id)}
              title={
                id === "review" && attachmentCount > 0
                  ? t("{n} attached for review", { n: attachmentCount })
                  : undefined
              }
            >
              {label[id]}
              {/* Five segments leave no room for the count itself — the dot
                  says "something is attached", the panel says how much. */}
              {id === "review" && attachmentCount > 0 && (
                <span
                  aria-hidden
                  className="absolute top-1 right-1 h-1 w-1 rounded-full bg-accent"
                />
              )}
            </button>
          ))}
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          className={`panel-swap absolute inset-0 ${tab === "files" ? "" : "hidden"}`}
          style={swapStyle}
        >
          <FileTree />
        </div>
        {tab !== "files" && (
          <div key={tab} className="panel-swap absolute inset-0" style={swapStyle}>
            {tab === "assets" ? (
              <AssetPanel />
            ) : tab === "review" ? (
              <ReviewPanel />
            ) : tab === "diff" ? (
              <DiffPanel />
            ) : (
              <MathPanel />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
