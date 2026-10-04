import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { parentOf } from "../lib/paths";
export const MAX_DOCUMENT_BYTES = 1024 * 1024;
export type DocumentMode = "preview" | "source";
export type SnapshotOrigin = "selection" | "output" | "draft" | "scratch";
export interface DocumentRecord {
  id: string;
  kind: "file" | "snapshot";
  title: string;
  path: string | null;
  baseDir: string | null;
  source: string;
  origin: SnapshotOrigin | null;
  capturedAt: number | null;
  paneId?: string;
  revision: number;
  loading: boolean;
  error: string | null;
  loaded: boolean;
  mode: DocumentMode;
}
export function assertDocumentSize(source: string) {
  if (new TextEncoder().encode(source).length > MAX_DOCUMENT_BYTES)
    throw new Error("Document exceeds 1 MiB");
}
interface DocumentStore {
  documents: Record<string, DocumentRecord>;
  openFile: (path: string) => Promise<string>;
  restoreFile: (path: string, mode: DocumentMode) => string;
  snapshot: (
    source: string,
    origin: SnapshotOrigin,
    baseDir: string | null,
    title: string,
    path?: string | null,
    paneId?: string,
  ) => string;
  reload: (id: string) => Promise<void>;
  close: (id: string) => void;
  setMode: (id: string, mode: DocumentMode) => void;
}
const titleOf = (path: string) => path.split(/[\\/]/).pop() || path;
function fileRecord(path: string, mode: DocumentMode): DocumentRecord {
  return {
    id: crypto.randomUUID(),
    kind: "file",
    path,
    title: titleOf(path),
    baseDir: parentOf(path),
    source: "",
    origin: null,
    capturedAt: null,
    revision: 0,
    loading: false,
    error: null,
    loaded: false,
    mode,
  };
}
export const useDocumentStore = create<DocumentStore>((set, get) => ({
  documents: {},
  openFile: async (path) => {
    // Canonicalize before deduplication; failed paths still become retryable tabs.
    let canonical = path;
    try {
      canonical = await invoke<string>("fs_canonical_path", { path });
    } catch {
      /* reload reports the read error */
    }
    const existing = Object.values(get().documents).find(
      (d) => d.kind === "file" && d.path === canonical,
    );
    if (existing) return existing.id;
    const doc = fileRecord(canonical, "preview");
    set((s) => ({ documents: { ...s.documents, [doc.id]: doc } }));
    void get().reload(doc.id);
    return doc.id;
  },
  restoreFile: (path, mode) => {
    const existing = Object.values(get().documents).find(
      (d) => d.kind === "file" && d.path === path,
    );
    if (existing) return existing.id;
    const doc = fileRecord(path, mode);
    set((s) => ({ documents: { ...s.documents, [doc.id]: doc } }));
    return doc.id;
  },
  snapshot: (source, origin, baseDir, title, path = null, paneId) => {
    assertDocumentSize(source);
    if (!source.trim()) throw new Error("Select text and try again");
    const id = crypto.randomUUID();
    const doc: DocumentRecord = {
      id,
      kind: "snapshot",
      title,
      path,
      baseDir,
      source,
      origin,
      paneId,
      capturedAt: Date.now(),
      revision: 1,
      loading: false,
      loaded: true,
      error: null,
      mode: "preview",
    };
    set((s) => ({ documents: { ...s.documents, [id]: doc } }));
    return id;
  },
  reload: async (id) => {
    const doc = get().documents[id];
    if (!doc || doc.kind !== "file") return;
    const revision = doc.revision + 1;
    set((s) => ({
      documents: {
        ...s.documents,
        [id]: { ...doc, revision, loading: true, error: null },
      },
    }));
    try {
      const source = await invoke<string>("fs_read_text_file", {
        path: doc.path,
      });
      assertDocumentSize(source);
      const current = get().documents[id];
      if (!current || current.revision !== revision) return;
      set((s) => ({
        documents: {
          ...s.documents,
          [id]: {
            ...current,
            source,
            loaded: true,
            loading: false,
            error: null,
          },
        },
      }));
    } catch (error) {
      const current = get().documents[id];
      if (!current || current.revision !== revision) return;
      set((s) => ({
        documents: {
          ...s.documents,
          [id]: { ...current, loading: false, error: String(error) },
        },
      }));
    }
  },
  close: (id) =>
    set((s) => {
      const documents = { ...s.documents };
      delete documents[id];
      return { documents };
    }),
  setMode: (id, mode) =>
    set((s) =>
      s.documents[id]
        ? { documents: { ...s.documents, [id]: { ...s.documents[id], mode } } }
        : s,
    ),
}));
