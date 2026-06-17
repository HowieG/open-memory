import type { KnownSource, SourceId } from "../schema";

/**
 * Source detection — prefix-primary, signature-as-guard.
 *
 * open-memory controls the filename at intake (the upload UI knows which service
 * the user picked), so it assigns an OPENAI_EXPORT_ / CLAUDE_EXPORT_ / GEMINI_EXPORT_
 * prefix and we key off that. The content signature is a CHEAP GUARD: if the prefix
 * and the archive contents disagree, we throw rather than silently parsing a file as
 * the wrong source.
 *
 *   prefix present + signature agrees (or null)  -> prefix wins
 *   prefix present + signature disagrees          -> throw (mislabeled file)
 *   no prefix                                     -> fall back to signature
 *   neither                                       -> throw DetectionError
 */

export class DetectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DetectionError";
  }
}

const PREFIXES: Record<string, KnownSource> = {
  OPENAI_EXPORT_: "chatgpt",
  CLAUDE_EXPORT_: "claude",
  GEMINI_EXPORT_: "gemini",
};

export function sourceFromPrefix(filename: string): SourceId | null {
  const base = filename.split("/").pop() ?? filename;
  const upper = base.toUpperCase();
  for (const [prefix, source] of Object.entries(PREFIXES)) {
    if (upper.startsWith(prefix)) return source;
  }
  return null;
}

const basename = (p: string): string => p.split("/").pop() ?? p;

export function sourceFromSignature(entries: string[]): SourceId | null {
  const paths = entries.map((e) => e.replace(/\\/g, "/"));
  const names = paths.map(basename);

  const hasMyActivity = paths.some((p) => /(^|\/)MyActivity\.json$/i.test(p));
  if (hasMyActivity) return "gemini";

  const hasShard = names.some((n) => /^conversations-\d+\.json$/.test(n));
  const hasChatHtml = names.includes("chat.html");
  const hasConvJson = names.includes("conversations.json");
  const hasUserJson = names.includes("user.json"); // ChatGPT (singular)
  const hasUsersJson = names.includes("users.json"); // Claude (plural)
  const hasMemories = names.includes("memories.json"); // Claude

  // ChatGPT: sharded conversations, or single conversations.json alongside chat.html/user.json
  if (hasShard || hasChatHtml || (hasConvJson && hasUserJson)) return "chatgpt";
  // Claude: conversations.json alongside users.json / memories.json, no shards/chat.html
  if (hasConvJson && (hasUsersJson || hasMemories)) return "claude";

  return null;
}

export function detectSource(filename: string, entries: string[]): SourceId {
  const prefix = sourceFromPrefix(filename);
  const signature = sourceFromSignature(entries);

  if (prefix) {
    if (signature && signature !== prefix) {
      throw new DetectionError(
        `filename prefix says "${prefix}" but archive contents look like "${signature}" — refusing to parse a mislabeled export (${filename})`,
      );
    }
    return prefix;
  }

  if (signature) return signature;

  throw new DetectionError(
    `could not recognize export "${filename}" — no known prefix and no matching content signature`,
  );
}
