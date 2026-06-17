import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { CanonicalConversation, ConversationIndexEntry } from "./schema";

/**
 * Disk-backed conversation store — the substrate the viewer and the (future)
 * memory extractor read from.
 *
 *   <baseDir>/index.json              tiny: [{id, source, title, created_at, file}]
 *   <baseDir>/conversations/<id>.json one CanonicalConversation per file
 *
 * The sidebar reads only the index (cheap); a conversation's messages load from
 * its file on demand (lazy). Conversations persist across restarts. Re-upload is
 * an upsert by id (newer wins). The in-memory index keeps `list()` synchronous.
 */

/** bounded-concurrency map — caps open file descriptors so a bulk write of
 *  thousands of conversations never hits EMFILE. */
async function pMap<T>(items: T[], fn: (item: T) => Promise<void>, concurrency: number): Promise<void> {
  const queue = [...items];
  const worker = async (): Promise<void> => {
    for (;;) {
      const item = queue.shift();
      if (item === undefined) return;
      await fn(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length || 1) }, worker));
}

const fileFor = (id: string): string => `${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`;

export class ConversationStore {
  private readonly convDir: string;
  private readonly indexPath: string;
  private index = new Map<string, ConversationIndexEntry>();

  constructor(private readonly baseDir: string) {
    this.convDir = path.join(baseDir, "conversations");
    this.indexPath = path.join(baseDir, "index.json");
  }

  /** Create the store dirs and load any existing index into memory. */
  async init(): Promise<void> {
    await mkdir(this.convDir, { recursive: true });
    try {
      const arr = JSON.parse(await readFile(this.indexPath, "utf8")) as ConversationIndexEntry[];
      this.index = new Map(arr.map((e) => [e.id, e]));
    } catch {
      this.index = new Map(); // no index yet
    }
  }

  /** Write each conversation to its own file and refresh the index (upsert by id). */
  async upsert(conversations: CanonicalConversation[]): Promise<void> {
    await pMap(
      conversations,
      async (c) => {
        const file = fileFor(c.id);
        await writeFile(path.join(this.convDir, file), JSON.stringify(c), "utf8");
        const prev = this.index.get(c.id);
        const entry: ConversationIndexEntry = { id: c.id, source: c.source, file };
        if (c.title !== undefined) entry.title = c.title;
        if (c.created_at !== undefined) entry.created_at = c.created_at;
        // preserve classify-pass annotations across re-upload
        if (prev?.sensitive !== undefined) entry.sensitive = prev.sensitive;
        if (prev?.category !== undefined) entry.category = prev.category;
        this.index.set(c.id, entry);
      },
      50,
    );
    await this.writeIndex();
  }

  private async writeIndex(): Promise<void> {
    await writeFile(this.indexPath, JSON.stringify([...this.index.values()], null, 2), "utf8");
  }

  /** Lightweight list for the sidebar/timeline, chronological. Reads only the index. */
  list(): ConversationIndexEntry[] {
    return [...this.index.values()].sort((a, b) => (a.created_at ?? 0) - (b.created_at ?? 0));
  }

  /** Merge classify-pass tags (sensitive/category) onto index entries, persisting once. */
  async applyTags(tags: { id: string; sensitive?: boolean; category?: string }[]): Promise<void> {
    let changed = false;
    for (const t of tags) {
      const entry = this.index.get(t.id);
      if (!entry) continue;
      const next = { ...entry };
      if (t.sensitive !== undefined) next.sensitive = t.sensitive;
      if (t.category !== undefined) next.category = t.category;
      this.index.set(t.id, next);
      changed = true;
    }
    if (changed) await this.writeIndex();
  }

  /** Wipe all conversations + the index from disk (the Settings "clear conversations"). */
  async clear(): Promise<void> {
    this.index = new Map();
    await rm(this.convDir, { recursive: true, force: true });
    await mkdir(this.convDir, { recursive: true });
    await this.writeIndex();
  }

  /** Load a single conversation's full content from disk (lazy). */
  async get(id: string): Promise<CanonicalConversation | null> {
    const entry = this.index.get(id);
    if (!entry) return null;
    try {
      return JSON.parse(await readFile(path.join(this.convDir, entry.file), "utf8")) as CanonicalConversation;
    } catch {
      return null;
    }
  }

  size(): number {
    return this.index.size;
  }
}
