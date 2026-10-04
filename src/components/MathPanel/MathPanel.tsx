import { openDocumentSnapshot, workspaceCwd } from "../../lib/workspace";
import { useState } from "react";
import { useMathStore } from "../../stores/mathStore";
import { useSettingsStore } from "../../stores/settingsStore";
import { sendTermCmd } from "../../lib/termBus";
import { kbd } from "../../lib/keys";
import MarkdownPreview from "../MarkdownPreview/MarkdownPreview";
import { useT } from "../../i18n";

const SAMPLE = `## 目标函数

$$\\min_{x} \\; \\sum_{i=1}^{n} c_i x_i \\quad \\text{s.t.} \\quad Ax \\le b,\\; x \\ge 0$$

其中 $x_i$ 是第 $i$ 个决策变量，$c_i$ 为其成本系数。
`;

export default function MathPanel() {
  const t = useT();
  const source = useMathStore((s) => s.source);
  const origin = useMathStore((s) => s.origin);
  const manualHold = useMathStore((s) => s.manualHold);
  const setSource = useMathStore((s) => s.setSource);
  const autoFollow = useSettingsStore((s) => s.mathAutoFollow);
  const [editing, setEditing] = useState(true);
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(source)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
      })
      .catch(() => {});
  };

  return (
    <div className="flex h-full flex-col text-[16px]">
      <div className="shrink-0 border-b border-edge px-3 pb-2 pt-3">
        <div className="flex items-center justify-between">
          <div className="text-[12px] font-semibold uppercase tracking-[0.18em] text-accent">
            {t("Math")}
          </div>
          <div className="-mr-1 flex flex-wrap items-center gap-0.5">
            <HeaderButton label={t("Read document")} title={t("Read document")} onClick={() => openDocumentSnapshot(source,"scratch", t("Math scratch"), workspaceCwd())} />
            <HeaderButton label={t("Read beside terminal")} title={t("Read beside terminal")} onClick={() => openDocumentSnapshot(source,"scratch", t("Math scratch"), workspaceCwd(), true)} />
            <HeaderButton
              label={t("From terminal")}
              title={t(
                "Render the terminal selection — falls back to the last command's output ({key})",
                { key: kbd("⌘⇧M") },
              )}
              onClick={() => sendTermCmd("send-selection")}
            />
            <HeaderButton
              label={editing ? t("Preview") : t("Source")}
              title={editing ? t("Hide the editor") : t("Show the editor")}
              onClick={() => setEditing((v) => !v)}
            />
            <HeaderButton
              label={copied ? t("Copied") : t("Copy")}
              title={t("Copy the LaTeX / markdown source")}
              onClick={copy}
            />
          </div>
        </div>
        <div className="mt-1 flex items-center gap-2 font-mono text-[12px] text-faint">
          <span className="truncate">
            {!source
              ? autoFollow
                ? t("waiting for a formula in the terminal…")
                : t("empty")
              : origin === "selection"
                ? t("from terminal selection")
                : origin === "output"
                  ? t("from last command output")
                  : origin === "auto"
                    ? t("auto — following terminal output")
                    : autoFollow && manualHold
                      ? t("edited here — auto-follow paused")
                      : autoFollow
                        ? t("scratch — the next formula replaces it")
                        : t("scratch — edited here")}
          </span>
          {autoFollow && manualHold && (
            <button
              className="shrink-0 rounded px-1 text-accent transition-colors hover:bg-accent/10"
              title={t("Drop this scratch and follow the terminal again")}
              onClick={() => setSource("", "auto")}
            >
              {t("resume")}
            </button>
          )}
        </div>
      </div>

      {editing && (
        <textarea
          className="h-32 shrink-0 resize-y border-b border-edge bg-transparent px-3 py-2 font-mono text-[11.5px] leading-relaxed text-ink/85 placeholder:text-faint focus:outline-none"
          spellCheck={false}
          value={source}
          placeholder={t(
            "$$E = mc^2$$ — LaTeX ($…$, $$…$$, \\[…\\]) and markdown both render below.",
          )}
          onChange={(e) => setSource(e.target.value, "manual")}
        />
      )}

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {source.trim() ? (
          <MarkdownPreview source={source} />
        ) : (
          <div className="space-y-3 text-[14px] text-faint">
            <p>
              {t(
                "Formulas printed in the terminal land here on their own; hover the underline in the output for a quick look. Or select any text and press {key} — or just type below.",
                { key: kbd("⌘⇧M") },
              )}
            </p>
            <button
              className="rounded-md border border-accent/35 px-2 py-1 text-[13px] text-accent transition-colors hover:bg-accent/10"
              onClick={() => setSource(SAMPLE, "manual")}
            >
              {t("Load an example")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function HeaderButton({
  label,
  title,
  onClick,
}: {
  label: string;
  title: string;
  onClick: () => void;
}) {
  return (
    <button
      className="rounded-md px-1.5 py-1 text-[12px] text-faint transition-colors hover:bg-ink/5 hover:text-accent"
      title={title}
      onClick={onClick}
    >
      {label}
    </button>
  );
}
