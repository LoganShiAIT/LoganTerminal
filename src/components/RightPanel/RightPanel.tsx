import { useEffect, useRef } from "react";
import AssetPanel from "../AssetPanel/AssetPanel";
import ReviewPanel from "../ReviewPanel/ReviewPanel";
import DiffPanel from "../DiffPanel/DiffPanel";
import MathPanel from "../MathPanel/MathPanel";
import { useReviewStore } from "../../stores/reviewStore";
import { useUiStore, type RightPanelTab } from "../../stores/uiStore";
import { useT } from "../../i18n";

/** Left-to-right order of the segments — also the swap direction's basis. */
const TABS: RightPanelTab[] = ["assets", "review", "diff", "math"];

/** Slower than a hover transition on purpose: a whole surface is changing. */
const SWAP_MS = "calc(var(--anim-scale) * 320ms)";
const PILL_MS = "calc(var(--anim-scale) * 280ms)";
const EASE = "cubic-bezier(0.22, 0.61, 0.36, 1)";

export default function RightPanel() {
  const t = useT();
  const tab = useUiStore((s) => s.rightPanelTab);
  const setTab = useUiStore((s) => s.setRightPanelTab);
  const attachmentCount = useReviewStore((s) => s.attachments.length);

  const index = Math.max(0, TABS.indexOf(tab));
  // Which way the incoming panel slides from. Read during render and updated
  // after, so the value is the direction of the move that caused this render.
  const previous = useRef(index);
  const forward = index >= previous.current;
  useEffect(() => {
    previous.current = index;
  }, [index]);

  const btn = (active: boolean) =>
    `relative z-10 h-full rounded-md text-[13px] font-semibold uppercase tracking-[0.12em] ${
      active ? "text-accent" : "text-muted hover:text-ink"
    }`;
  const btnStyle = { transition: `color ${PILL_MS} ${EASE}` };

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-edge p-2 shrink-0">
        <div className="relative grid h-7 grid-cols-4 rounded-lg bg-ink/[0.05] p-0.5">
          {/* Sliding pill behind the active segment. */}
          <span
            aria-hidden
            className="absolute top-0.5 bottom-0.5 left-0.5 w-[calc((100%-4px)/4)] rounded-md bg-accent/15 border border-accent/30"
            style={{
              transform: `translateX(${index * 100}%)`,
              transition: `transform ${PILL_MS} ${EASE}`,
            }}
          />
          <button
            className={btn(tab === "assets")}
            style={btnStyle}
            onClick={() => setTab("assets")}
          >
            {t("Assets")}
          </button>
          <button
            className={btn(tab === "review")}
            style={btnStyle}
            onClick={() => setTab("review")}
          >
            {t("Review")}
            {attachmentCount > 0 && (
              <span className="ml-1.5 inline-block min-w-[16px] rounded-full bg-accent/20 px-1 font-mono text-[11px] leading-[14px] text-accent">
                {attachmentCount}
              </span>
            )}
          </button>
          <button
            className={btn(tab === "diff")}
            style={btnStyle}
            onClick={() => setTab("diff")}
          >
            {t("Diff")}
          </button>
          <button
            className={btn(tab === "math")}
            style={btnStyle}
            onClick={() => setTab("math")}
          >
            {t("Math")}
          </button>
        </div>
      </div>
      {/* Keyed on the tab so the animation replays per swap. Only the visible
          panel is mounted — the other three would keep polling git and the
          filesystem for a surface nobody is looking at. */}
      <div
        key={tab}
        className="panel-swap min-h-0 flex-1"
        style={
          {
            "--panel-from": forward ? "18px" : "-18px",
            animationDuration: SWAP_MS,
          } as React.CSSProperties
        }
      >
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
    </div>
  );
}
