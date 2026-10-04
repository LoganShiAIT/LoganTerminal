import { usePtyStore } from "../../../stores/ptyStore";
import { useDocumentStore } from "../../../stores/documentStore";
import { useWorkspaceStore } from "../../../stores/workspaceStore";
import {
  activateWorkspace,
  closeFocusedSurface,
  returnToTerminal,
} from "../../../lib/workspace";
import { useUiStore } from "../../../stores/uiStore";
import { sendTermCmd } from "../../../lib/termBus";
import { t } from "../../../i18n";
import type { PaletteAction } from "./types";
export function documentActions(): PaletteAction[] {
  const w = useWorkspaceStore.getState(),
    docs = useDocumentStore.getState();
  const focus = w.focus;
  const current =
    focus?.kind === "document" ? docs.documents[focus.documentId] : undefined;
  const group = t("Documents");
  const actions: PaletteAction[] = [
    {
      id: "document-open",
      group,
      label: t("Open Markdown document — file finder"),
      keepFocus: true,
      run: () => useUiStore.getState().setFileSearchOpen(true),
    },
  ];
  w.entries
    .filter((e) => e.kind === "document")
    .forEach((e) =>
      actions.push({
        id: `document-${e.id}`,
        group,
        label: docs.documents[e.id]?.title || t("Document"),
        transient: true,
        active: w.activeId === e.id,
        run: () => activateWorkspace(e.id),
      }),
    );
  if (focus?.kind === "terminal")
    actions.push(
      {
        id: "document-capture",
        group,
        label: t("Read terminal selection / last output"),
        run: () => sendTermCmd("read-selection"),
      },
      {
        id: "document-capture-beside",
        group,
        label: t("Read terminal text beside terminal"),
        run: () => sendTermCmd("read-selection-beside"),
      },
    );
  if (current) {
    actions.push(
      {
        id: "document-mode",
        group,
        label: t("Toggle preview / source"),
        run: () =>
          docs.setMode(
            current.id,
            current.mode === "source" ? "preview" : "source",
          ),
      },
      {
        id: "document-outline",
        group,
        label: t("Toggle document outline"),
        run: () =>
          window.dispatchEvent(new CustomEvent("logan:reader-outline")),
      },
      {
        id: "document-return",
        group,
        label: t("Return to terminal"),
        run: returnToTerminal,
      },
      {
        id: "document-close",
        group,
        label: t("Close reader"),
        run: closeFocusedSurface,
      },
      {
        id: "document-beside",
        group,
        label: t("Read beside terminal"),
        run: () =>
          useWorkspaceStore
            .getState()
            .openDocument(current.id, usePtyStore.getState().activeTabId),
      },
    );
    if (current.kind === "file")
      actions.push({
        id: "document-reload",
        group,
        label: t("Reload document"),
        run: () => {
          void docs.reload(current.id);
        },
      });
  }
  return actions;
}
