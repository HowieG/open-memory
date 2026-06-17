import path from "node:path";
import type { CanonicalConversation } from "./schema";
import { detectSource } from "./sources/detect";
import { adapters } from "./sources/registry";
import { zipReader } from "./zip";

export interface IngestResult {
  source: string;
  conversations: CanonicalConversation[];
  failed: { id?: string; reason: string }[];
}

/**
 * Take a real export `.zip` end-to-end: detect the source, run its adapter,
 * return canonical conversations. Reads the JSON entries in place (no extraction).
 *
 *   ingestZip(zip) ──► detect ──► adapter.parse ──► { source, conversations, failed }
 *
 * This is the M1 backbone the Electron app calls. The per-conversation store and
 * the MemoryExtractionSource handoff layer on top of this result later.
 */
export async function ingestZip(
  zipPath: string,
  filename: string = path.basename(zipPath),
): Promise<IngestResult> {
  const reader = zipReader(zipPath, filename);
  const entries = await reader.entries();
  const source = detectSource(filename, entries);

  const adapter = adapters[source];
  if (!adapter) {
    throw new Error(
      `detected source "${source}" but no adapter is built yet (have: ${Object.keys(adapters).join(", ")})`,
    );
  }

  const outcome = await adapter.parse(reader);
  return { source, conversations: outcome.ok, failed: outcome.failed };
}
