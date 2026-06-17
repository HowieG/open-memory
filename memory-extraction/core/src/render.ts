import { marked } from "marked";
import type { CanonicalConversation } from "./schema";

/**
 * Throwaway eye-test renderer — canonical conversations -> a self-contained HTML
 * page (markdown-in-divs). Open it next to a source's own renderer (ChatGPT's
 * chat.html) and Cmd-F a title to confirm turn order, content, and pills match.
 *
 * NOT the M2 viewer (that's assistant-ui). No HTML sanitization here — it renders
 * your own local data into a local file; sanitize-html lands with the real viewer.
 */

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const fmtTime = (epoch?: number): string =>
  typeof epoch === "number" ? new Date(epoch * 1000).toISOString().slice(0, 16).replace("T", " ") : "";

function pills(meta: Record<string, unknown>): string {
  const chips = Object.entries(meta)
    .filter(([, v]) => v !== null && v !== undefined && v !== false && !(Array.isArray(v) && v.length === 0))
    .map(([k, v]) => `<span class="pill">${esc(k)}${v === true ? "" : `: ${esc(String(v))}`}</span>`);
  return chips.join("");
}

function renderConversation(c: CanonicalConversation): string {
  const head = `<div class="conv-head">
    <h2>${esc(c.title ?? "(untitled)")}</h2>
    <div class="meta">${esc(c.source)} · ${esc(c.id)} · ${fmtTime(c.created_at)} · ${c.messages.length} msgs</div>
    <div class="pills">${pills(c.source_metadata)}</div>
  </div>`;
  const msgs = c.messages
    .map(
      (m) =>
        `<div class="msg ${m.role}"><div class="role">${m.role}</div><div class="bubble">${marked.parse(m.content) as string}</div></div>`,
    )
    .join("\n");
  return `<section class="conv">${head}${msgs}</section>`;
}

export function renderConversationsHtml(
  convs: CanonicalConversation[],
  opts: { source: string; failed?: number; header?: boolean },
): string {
  const body = convs.map(renderConversation).join("\n<hr/>\n");
  const header =
    opts.header === false
      ? ""
      : `<p class="meta">${esc(opts.source)} · ${convs.length} conversations${opts.failed ? ` · ${opts.failed} failed` : ""}</p>`;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(opts.source)} preview</title>
<style>
  body{font:15px/1.5 -apple-system,system-ui,sans-serif;max-width:820px;margin:0 auto;padding:24px;color:#16171A;background:#EDEBE4}
  .conv-head h2{margin:0 0 4px;font-size:20px}
  .meta{color:#888;font:12px ui-monospace,monospace;margin-bottom:6px}
  .pills{margin-bottom:14px}
  .pill{display:inline-block;background:#16171A;color:#EDEBE4;border-radius:10px;padding:2px 8px;margin:2px 4px 2px 0;font:11px ui-monospace,monospace}
  .msg{margin:10px 0;display:flex;flex-direction:column}
  .msg.user{align-items:flex-end}
  .role{font:11px ui-monospace,monospace;color:#999;margin-bottom:2px}
  .bubble{background:#fff;border:1px solid #ddd;border-radius:12px;padding:8px 14px;max-width:90%}
  .msg.user .bubble{background:#16171A;color:#EDEBE4}
  .bubble pre{background:#0d0d0d;color:#eee;padding:10px;border-radius:8px;overflow:auto}
  .msg.user .bubble pre{background:#000}
  hr{border:none;border-top:2px dashed #ccc;margin:32px 0}
</style></head><body>
${header}
${body}
</body></html>`;
}
