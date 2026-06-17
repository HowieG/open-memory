import type { CanonicalConversation, CanonicalMessage, Role } from "../../schema";
import type { ArchiveReader, ConversationParseOutcome, SourceAdapter } from "../types";

/**
 * ChatGPT adapter.
 *
 * ChatGPT conversations are a `mapping` node-TREE plus a `current_node`. The
 * canonical thread is the path from current_node up to the root via the
 * node-level `parent` pointer, reversed. Off-path branches (edits / regenerations)
 * are naturally excluded because they aren't on that path.
 *
 *   current_node ──parent──> ... ──parent──> root        (then reverse = chronological)
 *
 * Filtered out of `messages`: non-user/assistant roles (system, tool — browsing,
 * python, dalle), and `is_visually_hidden_from_conversation` turns. Text-only:
 * for `multimodal_text` we keep the string parts and drop image-pointer objects.
 */

const PAYLOAD = /^conversations(-\d+)?\.json$/;
const basename = (p: string): string => p.split("/").pop() ?? p;

/** The 11 conversation-level pills preserved losslessly in source_metadata. */
const PILLS = [
  "conversation_template_id",
  "default_model_slug",
  "is_archived",
  "is_do_not_remember",
  "is_read_only",
  "is_starred",
  "is_study_mode",
  "memory_scope",
  "pinned_time",
  "plugin_ids",
  "voice",
] as const;

interface RawMessage {
  author?: { role?: string };
  content?: unknown;
  create_time?: number | null;
  metadata?: { is_visually_hidden_from_conversation?: boolean };
}
interface RawNode {
  message?: RawMessage | null;
  parent?: string | null;
}
interface RawConversation {
  conversation_id?: string;
  id?: string;
  title?: string;
  create_time?: number;
  update_time?: number;
  current_node?: string;
  mapping?: Record<string, RawNode>;
  [key: string]: unknown;
}

/** Pull plain text out of a message's `content`, text-only. Handles the
 *  `text`/`multimodal_text` parts array (string parts only) and a `.text` fallback. */
function extractText(content: unknown): string {
  if (content == null) return "";
  if (typeof content === "string") return content.trim();
  const c = content as { parts?: unknown; text?: unknown };
  if (Array.isArray(c.parts)) {
    return c.parts
      .filter((p): p is string => typeof p === "string")
      .join("\n")
      .trim();
  }
  if (typeof c.text === "string") return c.text.trim();
  return "";
}

function flatten(conv: RawConversation): CanonicalConversation {
  const id = conv.conversation_id ?? conv.id;
  if (!id) throw new Error("conversation missing id");

  const mapping = conv.mapping ?? {};
  const chain: RawMessage[] = [];
  const seen = new Set<string>();
  let nodeId: string | null | undefined = conv.current_node;
  while (nodeId && !seen.has(nodeId)) {
    seen.add(nodeId);
    const node: RawNode | undefined = mapping[nodeId];
    if (!node) break;
    if (node.message) chain.push(node.message);
    nodeId = node.parent ?? null;
  }
  chain.reverse(); // root -> leaf (chronological)

  const messages: CanonicalMessage[] = [];
  for (const m of chain) {
    const role = m.author?.role;
    if (role !== "user" && role !== "assistant") continue; // drop system / tool / hidden roles
    if (m.metadata?.is_visually_hidden_from_conversation) continue;
    const content = extractText(m.content);
    if (!content) continue;
    const msg: CanonicalMessage = { role: role satisfies Role, content };
    if (typeof m.create_time === "number") msg.timestamp = m.create_time;
    messages.push(msg);
  }

  const source_metadata: Record<string, unknown> = {};
  for (const k of PILLS) if (k in conv) source_metadata[k] = conv[k];

  const out: CanonicalConversation = { id, source: "chatgpt", messages, source_metadata };
  if (typeof conv.title === "string") out.title = conv.title;
  if (typeof conv.create_time === "number") out.created_at = conv.create_time;
  if (typeof conv.update_time === "number") out.updated_at = conv.update_time;
  return out;
}

export const chatgptAdapter: SourceAdapter = {
  id: "chatgpt",
  async parse(reader: ArchiveReader): Promise<ConversationParseOutcome> {
    const entries = await reader.entries();
    const shards = entries
      .filter((e) => PAYLOAD.test(basename(e)))
      .sort((a, b) => basename(a).localeCompare(basename(b)));

    const failed: { id?: string; reason: string }[] = [];
    const byId = new Map<string, CanonicalConversation>(); // dedup by conversation_id, last wins

    for (const shard of shards) {
      let arr: unknown;
      try {
        arr = JSON.parse(await reader.readText((e) => e === shard));
      } catch (err) {
        failed.push({ reason: `shard ${basename(shard)}: ${(err as Error).message}` });
        continue;
      }
      if (!Array.isArray(arr)) {
        failed.push({ reason: `shard ${basename(shard)} is not an array` });
        continue;
      }
      for (const raw of arr) {
        try {
          const conv = flatten(raw as RawConversation);
          byId.set(conv.id, conv);
        } catch (err) {
          failed.push({ id: (raw as RawConversation)?.conversation_id, reason: (err as Error).message });
        }
      }
    }

    return { ok: [...byId.values()], failed };
  },
};

export const __test = { flatten, extractText };
