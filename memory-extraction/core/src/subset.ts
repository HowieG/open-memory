import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SourceId } from "./schema";
import { detectSource } from "./sources/detect";
import { listZipEntries, readZipEntryText } from "./zip";

/**
 * "Small copy" tool — pull the first N conversations from a real export into a
 * tiny fixture that mirrors the source's native layout, so dev/test never drags
 * a full multi-hundred-MB export around. Reusable across every current and
 * future source.
 *
 *   real export.zip ──[detect + read first shard/file]──> fixtures/<source>/<native.json>
 */

interface SourceLayout {
  /** matches the payload entry to read (lowest shard for ChatGPT) */
  pickEntry: (entries: string[]) => string | undefined;
  /** native filename to write the fixture as */
  outName: string;
}

const basename = (p: string): string => p.split("/").pop() ?? p;

const LAYOUTS: Record<SourceId, SourceLayout> = {
  chatgpt: {
    pickEntry: (entries) =>
      entries
        .filter((e) => /^conversations(-\d+)?\.json$/.test(basename(e)))
        .sort((a, b) => basename(a).localeCompare(basename(b)))[0],
    outName: "conversations-000.json",
  },
  claude: {
    pickEntry: (entries) => entries.find((e) => basename(e) === "conversations.json"),
    outName: "conversations.json",
  },
  gemini: {
    pickEntry: (entries) => entries.find((e) => /(^|\/)MyActivity\.json$/i.test(e)),
    outName: "MyActivity.json",
  },
};

export interface SubsetResult {
  source: SourceId;
  picked: number;
  available: number;
  outPath: string;
}

export interface SubsetOptions {
  zipPath: string;
  n: number;
  outDir: string;
  /** override the name used for prefix detection (defaults to the zip's basename) */
  filename?: string;
}

export async function subset(opts: SubsetOptions): Promise<SubsetResult> {
  const { zipPath, n, outDir } = opts;
  const filename = opts.filename ?? basename(zipPath);

  const entries = await listZipEntries(zipPath);
  const source = detectSource(filename, entries);

  const layout = LAYOUTS[source];
  if (!layout) throw new Error(`no subset layout for source "${source}"`);

  const entryPath = layout.pickEntry(entries);
  if (!entryPath) {
    throw new Error(`could not locate the conversation payload for source "${source}" in ${zipPath}`);
  }

  const text = await readZipEntryText(zipPath, (e) => e === entryPath);
  const parsed = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    throw new Error(`expected an array in ${entryPath} for source "${source}", got ${typeof parsed}`);
  }

  const picked = parsed.slice(0, Math.max(0, n)); // clamps when n > available
  const destDir = path.join(outDir, source);
  await mkdir(destDir, { recursive: true });
  const outPath = path.join(destDir, layout.outName);
  await writeFile(outPath, JSON.stringify(picked, null, 2), "utf8");

  return { source, picked: picked.length, available: parsed.length, outPath };
}
