import type { CanonicalConversation, CanonicalMessage, Role } from "../../schema";
import type { ArchiveReader, ConversationParseOutcome, SourceAdapter } from "../types";

/**
 * Claude adapter — the simplest source.
 *
 * `conversations.json` is a flat array; each conversation has a linear
 * `chat_messages[]` with an explicit `sender` (human/assistant). No tree to
 * flatten. Content: prefer the top-level `.text`, fall back to joining the
 * `content[]` text blocks (`.text` is denormalized and has been in flux, so we
 * assert it rather than assume it). Timestamps are ISO strings -> epoch seconds.
 */

const isConversationsJson = (entry: string): boolean =>
  (entry.split("/").pop() ?? entry) === "conversations.json";

interface RawBlock {
  type?: string;
  text?: string;
}
interface RawChatMessage {
  sender?: string;
  text?: string;
  content?: RawBlock[];
  created_at?: string;
  parent_message_uuid?: string | null;
}
interface RawConversation {
  uuid?: string;
  name?: string;
  summary?: string;
  account?: unknown;
  created_at?: string;
  updated_at?: string;
  chat_messages?: RawChatMessage[];
}

const ROLE: Record<string, Role> = { human: "user", assistant: "assistant" };

/** epoch seconds from an ISO string, or undefined if unparseable */
function epochSeconds(iso: unknown): number | undefined {
  if (typeof iso !== "string") return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** prefer .text; fall back to joining content[] text blocks */
function messageText(m: RawChatMessage): string {
  if (typeof m.text === "string" && m.text.trim()) return m.text.trim();
  if (Array.isArray(m.content)) {
    return m.content
      .filter((b): b is RawBlock & { text: string } => b?.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
  return "";
}

function flatten(conv: RawConversation): CanonicalConversation {
  const id = conv.uuid;
  if (!id) throw new Error("conversation missing uuid");

  const messages: CanonicalMessage[] = [];
  for (const m of conv.chat_messages ?? []) {
    const role = m.sender ? ROLE[m.sender] : undefined;
    if (!role) continue; // skip unknown senders
    const content = messageText(m);
    if (!content) continue;
    const msg: CanonicalMessage = { role, content };
    const ts = epochSeconds(m.created_at);
    if (ts !== undefined) msg.timestamp = ts;
    messages.push(msg);
  }

  const source_metadata: Record<string, unknown> = {};
  if (conv.summary !== undefined) source_metadata.summary = conv.summary;
  if (conv.account !== undefined) source_metadata.account = conv.account;

  const out: CanonicalConversation = { id, source: "claude", messages, source_metadata };
  if (typeof conv.name === "string") out.title = conv.name;
  const created = epochSeconds(conv.created_at);
  if (created !== undefined) out.created_at = created;
  const updated = epochSeconds(conv.updated_at);
  if (updated !== undefined) out.updated_at = updated;
  return out;
}

export const claudeAdapter: SourceAdapter = {
  id: "claude",
  async parse(reader: ArchiveReader): Promise<ConversationParseOutcome> {
    let arr: unknown;
    try {
      arr = JSON.parse(await reader.readText(isConversationsJson));
    } catch (err) {
      return { ok: [], failed: [{ reason: `conversations.json: ${(err as Error).message}` }] };
    }
    if (!Array.isArray(arr)) {
      return { ok: [], failed: [{ reason: "conversations.json is not an array" }] };
    }

    const failed: { id?: string; reason: string }[] = [];
    const byId = new Map<string, CanonicalConversation>(); // dedup by uuid, last wins
    for (const raw of arr) {
      try {
        const conv = flatten(raw as RawConversation);
        byId.set(conv.id, conv);
      } catch (err) {
        failed.push({ id: (raw as RawConversation)?.uuid, reason: (err as Error).message });
      }
    }
    return { ok: [...byId.values()], failed };
  },
};

export const __test = { flatten, messageText, epochSeconds };
